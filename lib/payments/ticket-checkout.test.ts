import { describe, expect, it } from 'vitest';
import { FakePaymentGateway } from './fake-payment-gateway';
import type {
  ConfirmOutcome,
  PaymentAttempt,
  PaymentProvider,
  PreparedCheckout,
  RefundOutcome,
} from './gateway';
import {
  TicketPaymentConfirmationInProgressError,
  TicketPaymentContractError,
  TicketRefundInProgressError,
  createTicketPaymentCheckout,
  type TicketPaymentAttemptClaim,
  type TicketPaymentAttemptRepository,
  type TicketPaymentFinalization,
  type TicketRefundClaim,
  type TicketRefundFinalization,
} from './ticket-checkout';

const USER_ID = '00000000-0000-4000-8000-000000000206';
const ORDER_ID = '20000000-0000-4000-8000-000000000206';
const ATTEMPT_ID = '30000000-0000-4000-8000-000000000206';
const REQUEST_ID = '40000000-0000-4000-8000-000000000206';
const PROVIDER_ORDER_ID = 'T30000000000040008000000000000206';
const CALLBACK_NONCE = 'opaque-ticket-callback-nonce-206';

function attempt(overrides: Partial<PaymentAttempt> = {}): PaymentAttempt {
  return {
    id: ATTEMPT_ID,
    provider: 'korpay',
    purpose: 'ticket',
    refId: ORDER_ID,
    amount: 44_000,
    currency: 'KRW',
    idempotencyKey: `ticket:${ORDER_ID}`,
    providerOrderId: PROVIDER_ORDER_ID,
    providerProductCode: 'P30000000000040008000000000000206',
    expiresAt: '2099-08-13T10:10:00.000Z',
    ...overrides,
  };
}

function prepared(overrides: Partial<PreparedCheckout> = {}): PreparedCheckout {
  return {
    attemptId: ATTEMPT_ID,
    provider: 'korpay',
    action: {
      kind: 'form_post',
      url: 'https://payments.example.test/authenticate',
      fields: { orderNumber: PROVIDER_ORDER_ID },
    },
    callbackNonce: CALLBACK_NONCE,
    expiresAt: '2099-08-13T10:10:00.000Z',
    ...overrides,
  };
}

function confirmOutcome(
  value: ConfirmOutcome['outcome'],
  overrides: Partial<ConfirmOutcome> = {},
): ConfirmOutcome {
  return {
    attemptId: ATTEMPT_ID,
    provider: 'korpay',
    outcome: value,
    reasonCode: `fake_${value}`,
    ...overrides,
  };
}

function refundOutcome(
  value: RefundOutcome['outcome'],
  overrides: Partial<RefundOutcome> = {},
): RefundOutcome {
  return {
    attemptId: ATTEMPT_ID,
    provider: 'korpay',
    outcome: value,
    reasonCode: `fake_refund_${value}`,
    ...(value === 'approved' ? { refundedAmount: 44_000 } : {}),
    ...overrides,
  };
}

type FakeTicketState = {
  capacity: 'reserved' | 'released';
  order: 'pending' | 'paid' | 'canceled';
  qrCount: number;
  refundCount: number;
  cancellation: 'none' | 'processing' | 'needs_review' | 'completed';
};

class MemoryTicketPaymentAttemptRepository implements TicketPaymentAttemptRepository {
  readonly attempts = new Map<string, PaymentAttempt>();
  readonly nonceDigests = new Map<string, string>();
  readonly outcomes = new Map<string, ConfirmOutcome>();
  readonly claims = new Map<string, string>();
  readonly refundOutcomes = new Map<string, RefundOutcome>();
  readonly state: FakeTicketState = {
    capacity: 'reserved',
    order: 'pending',
    qrCount: 0,
    refundCount: 0,
    cancellation: 'none',
  };
  confirmationClaimMode: TicketPaymentAttemptClaim['status'] | null = null;
  refundClaimMode: TicketRefundClaim['status'] | null = null;
  finalizations: TicketPaymentFinalization[] = [];
  refundFinalizations: TicketRefundFinalization[] = [];

  async prepareTicketAttempt(input: {
    userId: string;
    ticketOrderId: string;
    provider: PaymentProvider;
  }) {
    if (
      input.userId !== USER_ID
      || input.ticketOrderId !== ORDER_ID
      || input.provider !== 'korpay'
      || this.state.capacity !== 'reserved'
      || this.state.order !== 'pending'
    ) {
      throw new TicketPaymentContractError('ticket_order_not_payable');
    }
    const existing = this.attempts.get(input.ticketOrderId);
    if (existing) return existing;
    const created = attempt();
    this.attempts.set(input.ticketOrderId, created);
    return created;
  }

  async bindCallbackNonce(input: { attemptId: string; callbackNonceDigest: string }) {
    const existing = this.nonceDigests.get(input.attemptId);
    if (existing && existing !== input.callbackNonceDigest) {
      throw new TicketPaymentContractError('callback_nonce_conflict');
    }
    this.nonceDigests.set(input.attemptId, input.callbackNonceDigest);
  }

  async claimTicketAttempt(input: {
    provider: PaymentProvider;
    providerOrderId: string;
    callbackNonceDigest: string;
    claimToken: string;
  }): Promise<TicketPaymentAttemptClaim> {
    const target = [...this.attempts.values()].find((entry) => (
      entry.provider === input.provider && entry.providerOrderId === input.providerOrderId
    ));
    if (!target || this.nonceDigests.get(target.id) !== input.callbackNonceDigest) {
      throw new TicketPaymentContractError('invalid_callback');
    }
    const replay = this.outcomes.get(target.id);
    if (replay) return { status: 'terminal', attempt: target, outcome: replay };
    if (this.confirmationClaimMode === 'in_progress' || this.claims.has(target.id)) {
      return { status: 'in_progress', attempt: target };
    }
    this.claims.set(target.id, input.claimToken);
    return { status: 'claimed', attempt: target, claimToken: input.claimToken };
  }

  async finalizeTicketAttempt(input: TicketPaymentFinalization) {
    if (this.claims.get(input.attemptId) !== input.claimToken) {
      throw new TicketPaymentContractError('claim_mismatch');
    }
    const replay = this.outcomes.get(input.attemptId);
    if (replay) return replay;

    this.finalizations.push(input);
    this.outcomes.set(input.attemptId, input.outcome);
    if (input.outcome.outcome === 'approved') {
      this.state.order = 'paid';
      this.state.qrCount = 2;
    } else if (input.outcome.outcome === 'declined' || input.outcome.outcome === 'canceled') {
      this.state.order = 'canceled';
      this.state.capacity = 'released';
    }
    return input.outcome;
  }

  async claimTicketRefund(input: {
    requestId: string;
    userId: string;
    claimToken: string;
  }): Promise<TicketRefundClaim> {
    if (input.requestId !== REQUEST_ID || input.userId !== USER_ID) {
      throw new TicketPaymentContractError('refund_not_found');
    }
    const target = this.attempts.get(ORDER_ID);
    if (!target) return { status: 'legacy' };
    const replay = this.refundOutcomes.get(input.requestId);
    if (replay) return { status: 'terminal', attempt: target, outcome: replay };
    if (this.refundClaimMode === 'in_progress') {
      return { status: 'in_progress', attempt: target };
    }
    if (this.outcomes.get(target.id)?.outcome !== 'approved') {
      const result = refundOutcome('needs_review', { reasonCode: 'payment_not_refundable' });
      this.refundOutcomes.set(input.requestId, result);
      this.state.cancellation = 'needs_review';
      return { status: 'terminal', attempt: target, outcome: result };
    }
    this.state.cancellation = 'processing';
    return { status: 'claimed', attempt: target, claimToken: input.claimToken };
  }

  async finalizeTicketRefund(input: TicketRefundFinalization) {
    const replay = this.refundOutcomes.get(input.requestId);
    if (replay) return replay;
    this.refundFinalizations.push(input);
    this.refundOutcomes.set(input.requestId, input.outcome);
    if (input.outcome.outcome === 'approved') {
      this.state.order = 'canceled';
      this.state.capacity = 'released';
      this.state.qrCount = 0;
      this.state.refundCount = 1;
      this.state.cancellation = 'completed';
    } else {
      this.state.cancellation = 'needs_review';
    }
    return input.outcome;
  }
}

function checkoutFixture(input: {
  confirm?: readonly ConfirmOutcome[];
  refund?: readonly RefundOutcome[];
} = {}) {
  const repository = new MemoryTicketPaymentAttemptRepository();
  const gateway = new FakePaymentGateway({
    prepare: [prepared()],
    confirm: input.confirm ?? [confirmOutcome('approved')],
    refund: input.refund ?? [refundOutcome('approved')],
  });
  const checkout = createTicketPaymentCheckout({
    provider: 'korpay',
    gateway,
    repository,
    createClaimToken: () => '50000000-0000-4000-8000-000000000206',
  });
  return { checkout, repository };
}

const callback = {
  providerOrderId: PROVIDER_ORDER_ID,
  callbackNonce: CALLBACK_NONCE,
  providerPayload: { resultCode: '0000' },
} as const;

describe('TicketPaymentCheckout', () => {
  it('같은 예매 준비를 하나의 provider-neutral attempt와 checkout으로 재생한다', async () => {
    const { checkout, repository } = checkoutFixture();

    await expect(checkout.prepare({ userId: USER_ID, ticketOrderId: ORDER_ID }))
      .resolves.toEqual(prepared());
    await expect(checkout.prepare({ userId: USER_ID, ticketOrderId: ORDER_ID }))
      .resolves.toEqual(prepared());

    expect(repository.attempts.size).toBe(1);
    expect(repository.nonceDigests.size).toBe(1);
  });

  it('승인 finalization만 예매를 paid로 만들고 QR을 발급한다', async () => {
    const approved = confirmOutcome('approved');
    const { checkout, repository } = checkoutFixture({ confirm: [approved] });
    await checkout.prepare({ userId: USER_ID, ticketOrderId: ORDER_ID });

    await expect(checkout.confirm(callback)).resolves.toEqual(approved);
    expect(repository.state).toMatchObject({
      capacity: 'reserved',
      order: 'paid',
      qrCount: 2,
    });
  });

  it.each(['declined', 'canceled'] as const)(
    '%s 확정 결과는 QR 없이 정원 선점을 정확히 한 번 해제한다',
    async (paymentOutcome) => {
      const expected = confirmOutcome(paymentOutcome);
      const { checkout, repository } = checkoutFixture({ confirm: [expected] });
      await checkout.prepare({ userId: USER_ID, ticketOrderId: ORDER_ID });

      await expect(checkout.confirm(callback)).resolves.toEqual(expected);
      await expect(checkout.confirm(callback)).resolves.toEqual(expected);
      expect(repository.state).toMatchObject({
        capacity: 'released',
        order: 'canceled',
        qrCount: 0,
      });
      expect(repository.finalizations).toHaveLength(1);
    },
  );

  it.each(['unknown', 'needs_review'] as const)(
    '%s 확정 결과는 QR과 자동 재시도를 막고 정원 선점을 보존한다',
    async (paymentOutcome) => {
      const expected = confirmOutcome(paymentOutcome);
      const { checkout, repository } = checkoutFixture({ confirm: [expected] });
      await checkout.prepare({ userId: USER_ID, ticketOrderId: ORDER_ID });

      await expect(checkout.confirm(callback)).resolves.toEqual(expected);
      await expect(checkout.confirm(callback)).resolves.toEqual(expected);
      expect(repository.state).toMatchObject({
        capacity: 'reserved',
        order: 'pending',
        qrCount: 0,
      });
      expect(repository.finalizations).toHaveLength(1);
    },
  );

  it('동시에 claim된 callback은 provider confirm을 중복 호출하지 않는다', async () => {
    const { checkout, repository } = checkoutFixture();
    await checkout.prepare({ userId: USER_ID, ticketOrderId: ORDER_ID });
    repository.confirmationClaimMode = 'in_progress';

    await expect(checkout.confirm(callback))
      .rejects.toBeInstanceOf(TicketPaymentConfirmationInProgressError);
    expect(repository.finalizations).toHaveLength(0);
  });

  it('terminal replay의 attempt 정체성이 다르면 provider 재호출 없이 fail closed한다', async () => {
    const { checkout, repository } = checkoutFixture();
    await checkout.prepare({ userId: USER_ID, ticketOrderId: ORDER_ID });
    repository.outcomes.set(ATTEMPT_ID, confirmOutcome('approved', {
      attemptId: '30000000-0000-4000-8000-000000000999',
    }));

    await expect(checkout.confirm(callback)).rejects.toMatchObject({
      code: 'invalid_terminal_outcome',
    });
    expect(repository.finalizations).toHaveLength(0);
  });

  it('gateway timeout을 unknown으로 고정하고 자동 재결제·QR 발급을 막는다', async () => {
    const repository = new MemoryTicketPaymentAttemptRepository();
    const gateway = new FakePaymentGateway({ prepare: [prepared()] });
    const checkout = createTicketPaymentCheckout({
      provider: 'korpay',
      gateway,
      repository,
      createClaimToken: () => '50000000-0000-4000-8000-000000000206',
    });
    await checkout.prepare({ userId: USER_ID, ticketOrderId: ORDER_ID });

    await expect(checkout.confirm(callback)).resolves.toMatchObject({
      attemptId: ATTEMPT_ID,
      provider: 'korpay',
      outcome: 'unknown',
      reasonCode: 'provider_unavailable',
    });
    expect(repository.state).toMatchObject({
      capacity: 'reserved',
      order: 'pending',
      qrCount: 0,
    });
    expect(repository.finalizations).toHaveLength(1);
  });

  it('gateway가 attempt 정체성을 바꾸면 승인·QR 대신 needs_review로 고정한다', async () => {
    const mismatched = confirmOutcome('approved', {
      attemptId: '30000000-0000-4000-8000-000000000999',
    });
    const { checkout, repository } = checkoutFixture({ confirm: [mismatched] });
    await checkout.prepare({ userId: USER_ID, ticketOrderId: ORDER_ID });

    await expect(checkout.confirm(callback)).resolves.toMatchObject({
      attemptId: ATTEMPT_ID,
      provider: 'korpay',
      outcome: 'needs_review',
      reasonCode: 'provider_identity_mismatch',
    });
    expect(repository.state).toMatchObject({ order: 'pending', qrCount: 0 });
  });

  it('승인된 예매를 공통 gateway로 전액 환불하고 정원·QR을 한 번만 닫는다', async () => {
    const refunded = refundOutcome('approved');
    const { checkout, repository } = checkoutFixture({ refund: [refunded] });
    await checkout.prepare({ userId: USER_ID, ticketOrderId: ORDER_ID });
    await checkout.confirm(callback);

    const request = { requestId: REQUEST_ID, userId: USER_ID, reason: '사용자 티켓 예매 취소' };
    await expect(checkout.refund(request)).resolves.toEqual(refunded);
    await expect(checkout.refund(request)).resolves.toEqual(refunded);
    expect(repository.state).toEqual({
      capacity: 'released',
      order: 'canceled',
      qrCount: 0,
      refundCount: 1,
      cancellation: 'completed',
    });
    expect(repository.refundFinalizations).toHaveLength(1);
  });

  it('모호하거나 금액이 다른 환불은 QR 노출을 fence하고 정원을 자동 해제하지 않는다', async () => {
    for (const providerRefund of [
      refundOutcome('unknown'),
      refundOutcome('approved', { refundedAmount: 1 }),
    ]) {
      const { checkout, repository } = checkoutFixture({ refund: [providerRefund] });
      await checkout.prepare({ userId: USER_ID, ticketOrderId: ORDER_ID });
      await checkout.confirm(callback);

      await expect(checkout.refund({
        requestId: REQUEST_ID,
        userId: USER_ID,
        reason: '사용자 티켓 예매 취소',
      })).resolves.toMatchObject({ outcome: 'needs_review' });
      expect(repository.state).toMatchObject({
        capacity: 'reserved',
        order: 'paid',
        qrCount: 2,
        cancellation: 'needs_review',
      });
    }
  });

  it('다른 환급 처리권이 있으면 gateway를 재호출하지 않는다', async () => {
    const { checkout, repository } = checkoutFixture();
    await checkout.prepare({ userId: USER_ID, ticketOrderId: ORDER_ID });
    await checkout.confirm(callback);
    repository.refundClaimMode = 'in_progress';

    await expect(checkout.refund({
      requestId: REQUEST_ID,
      userId: USER_ID,
      reason: '사용자 티켓 예매 취소',
    })).rejects.toBeInstanceOf(TicketRefundInProgressError);
    expect(repository.refundFinalizations).toHaveLength(0);
  });

  it('terminal 환급 replay가 전액 승인 계약을 어기면 완료로 가장하지 않는다', async () => {
    const { checkout, repository } = checkoutFixture();
    await checkout.prepare({ userId: USER_ID, ticketOrderId: ORDER_ID });
    await checkout.confirm(callback);
    repository.refundOutcomes.set(REQUEST_ID, refundOutcome('approved', { refundedAmount: 1 }));

    await expect(checkout.refund({
      requestId: REQUEST_ID,
      userId: USER_ID,
      reason: '사용자 티켓 예매 취소',
    })).rejects.toMatchObject({ code: 'invalid_terminal_refund' });
    expect(repository.refundFinalizations).toHaveLength(0);
  });

  it('legacy Toss 예매는 신규 gateway가 가로채지 않고 known-only 취소 경계로 넘긴다', async () => {
    const { checkout, repository } = checkoutFixture();

    await expect(checkout.refund({
      requestId: REQUEST_ID,
      userId: USER_ID,
      reason: '사용자 티켓 예매 취소',
    })).rejects.toMatchObject({ code: 'legacy_payment' });
    expect(repository.state.capacity).toBe('reserved');
  });
});
