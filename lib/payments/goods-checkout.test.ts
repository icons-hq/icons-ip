import { describe, expect, it, vi } from 'vitest';
import type {
  ConfirmOutcome,
  PaymentAttempt,
  PaymentProvider,
  PreparedCheckout,
} from './gateway';
import { FakePaymentGateway } from './fake-payment-gateway';
import {
  GoodsPaymentConfirmationInProgressError,
  GoodsPaymentContractError,
  GoodsPaymentReconciliationInProgressError,
  createGoodsPaymentCheckout,
  type GoodsPaymentAttemptClaim,
  type GoodsPaymentAttemptRepository,
  type GoodsPaymentFinalization,
} from './goods-checkout';

const USER_ID = '00000000-0000-4000-8000-000000000205';
const ORDER_ID = '20000000-0000-4000-8000-000000000205';
const ATTEMPT_ID = '30000000-0000-4000-8000-000000000205';
const PROVIDER_ORDER_ID = 'O30000000000040008000000000000205';
const CALLBACK_NONCE = 'opaque-callback-nonce-205';

function attempt(overrides: Partial<PaymentAttempt> = {}): PaymentAttempt {
  return {
    id: ATTEMPT_ID,
    provider: 'korpay',
    purpose: 'order',
    refId: ORDER_ID,
    amount: 31_000,
    currency: 'KRW',
    idempotencyKey: `goods:${ORDER_ID}`,
    providerOrderId: PROVIDER_ORDER_ID,
    providerProductCode: 'P30000000000040008000000000000205',
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

class MemoryGoodsPaymentAttemptRepository implements GoodsPaymentAttemptRepository {
  readonly attempts = new Map<string, PaymentAttempt>();
  readonly nonceDigests = new Map<string, string>();
  readonly outcomes = new Map<string, ConfirmOutcome>();
  readonly claims = new Map<string, string>();
  prepareCount = 0;
  finalizations: GoodsPaymentFinalization[] = [];
  claimMode: GoodsPaymentAttemptClaim['status'] | null = null;
  /** DB finalization guard 재현 — gateway 결과와 다른 종결을 되돌린다. */
  finalizeOutcomeOverride: ConfirmOutcome['outcome'] | null = null;

  async prepareOrderAttempt(input: {
    userId: string;
    orderId: string;
    provider: PaymentProvider;
  }) {
    this.prepareCount += 1;
    if (input.userId !== USER_ID || input.orderId !== ORDER_ID || input.provider !== 'korpay') {
      throw new GoodsPaymentContractError('order_contract_mismatch');
    }
    const existing = this.attempts.get(input.orderId);
    if (existing) return existing;
    const created = attempt();
    this.attempts.set(input.orderId, created);
    return created;
  }

  async bindCallbackNonce(input: { attemptId: string; callbackNonceDigest: string }) {
    const existing = this.nonceDigests.get(input.attemptId);
    if (existing && existing !== input.callbackNonceDigest) {
      throw new GoodsPaymentContractError('callback_nonce_conflict');
    }
    this.nonceDigests.set(input.attemptId, input.callbackNonceDigest);
  }

  async claimOrderAttempt(input: {
    provider: PaymentProvider;
    providerOrderId: string;
    callbackNonceDigest: string;
    claimToken: string;
  }): Promise<GoodsPaymentAttemptClaim> {
    const target = [...this.attempts.values()].find((entry) => (
      entry.provider === input.provider && entry.providerOrderId === input.providerOrderId
    ));
    if (!target || this.nonceDigests.get(target.id) !== input.callbackNonceDigest) {
      throw new GoodsPaymentContractError('invalid_callback');
    }
    const replay = this.outcomes.get(target.id);
    if (replay) return { status: 'terminal', attempt: target, outcome: replay };
    if (this.claimMode === 'in_progress' || this.claims.has(target.id)) {
      return { status: 'in_progress', attempt: target };
    }
    this.claims.set(target.id, input.claimToken);
    return { status: 'claimed', attempt: target, claimToken: input.claimToken };
  }

  async finalizeOrderAttempt(input: GoodsPaymentFinalization) {
    if (this.claims.get(input.attemptId) !== input.claimToken) {
      throw new GoodsPaymentContractError('claim_mismatch');
    }
    this.finalizations.push(input);
    const finalized = this.finalizeOutcomeOverride
      ? {
          ...input.outcome,
          outcome: this.finalizeOutcomeOverride,
          reasonCode: 'database_finalization_guard',
        }
      : input.outcome;
    this.outcomes.set(input.attemptId, finalized);
    return finalized;
  }

  /* DB 재정합 claim 계약 재현 — approved·declined·canceled만 terminal 재생이고
     unknown·needs_review 종결은 다시 claim할 수 있다(#390). */
  async claimOrderReconciliation(input: {
    attemptId: string;
    claimToken: string;
    caseRef: string;
  }): Promise<GoodsPaymentAttemptClaim> {
    const target = [...this.attempts.values()].find((entry) => entry.id === input.attemptId);
    if (!target) throw new GoodsPaymentContractError('attempt_not_found');
    const replay = this.outcomes.get(target.id);
    if (replay && ['approved', 'declined', 'canceled'].includes(replay.outcome)) {
      return { status: 'terminal', attempt: target, outcome: replay };
    }
    if (this.claimMode === 'in_progress') {
      return { status: 'in_progress', attempt: target };
    }
    this.claims.set(target.id, input.claimToken);
    return { status: 'claimed', attempt: target, claimToken: input.claimToken };
  }

  async finalizeOrderReconciliation(input: GoodsPaymentFinalization) {
    return this.finalizeOrderAttempt(input);
  }
}

function outcome(value: ConfirmOutcome['outcome'], overrides: Partial<ConfirmOutcome> = {}): ConfirmOutcome {
  return {
    attemptId: ATTEMPT_ID,
    provider: 'korpay',
    outcome: value,
    reasonCode: `fake_${value}`,
    ...overrides,
  };
}

function checkoutFixture(
  confirm: readonly ConfirmOutcome[] = [outcome('approved')],
  onApproved?: (attempt: PaymentAttempt) => Promise<unknown>,
  reconcile: readonly ConfirmOutcome[] = [],
) {
  const repository = new MemoryGoodsPaymentAttemptRepository();
  const gateway = new FakePaymentGateway({ prepare: [prepared()], confirm, reconcile });
  const checkout = createGoodsPaymentCheckout({
    provider: 'korpay',
    gateway,
    repository,
    createClaimToken: () => '40000000-0000-4000-8000-000000000205',
    onApproved,
  });
  return { checkout, repository };
}

const CALLBACK = {
  providerOrderId: PROVIDER_ORDER_ID,
  callbackNonce: CALLBACK_NONCE,
  providerPayload: { resultCode: '0000' },
} as const;

describe('GoodsPaymentCheckout', () => {
  it('같은 굿즈 주문 준비를 하나의 provider-neutral attempt와 checkout으로 재생한다', async () => {
    const { checkout, repository } = checkoutFixture();

    await expect(checkout.prepare({ userId: USER_ID, orderId: ORDER_ID })).resolves.toEqual(prepared());
    await expect(checkout.prepare({ userId: USER_ID, orderId: ORDER_ID })).resolves.toEqual(prepared());

    expect(repository.attempts.size).toBe(1);
    expect(repository.nonceDigests.size).toBe(1);
  });

  it('키 모드가 있는 배포의 prepare는 체크아웃을 돌려주기 전에 시도에 키 모드를 남긴다', async () => {
    const recordKeyMode = vi.fn(async () => undefined);
    const repository = new MemoryGoodsPaymentAttemptRepository();
    const checkout = createGoodsPaymentCheckout({
      provider: 'korpay',
      gateway: new FakePaymentGateway({ prepare: [prepared()] }),
      repository,
      providerKeyMode: () => 'test',
      recordKeyMode,
    });

    await expect(checkout.prepare({ userId: USER_ID, orderId: ORDER_ID })).resolves.toEqual(prepared());
    expect(recordKeyMode).toHaveBeenCalledWith({ attemptId: ATTEMPT_ID, keyMode: 'test' });
  });

  it('키 모드를 남기지 못하면 체크아웃을 돌려주지 않는다(결제창 전 fail closed)', async () => {
    const checkout = createGoodsPaymentCheckout({
      provider: 'korpay',
      gateway: new FakePaymentGateway({ prepare: [prepared()] }),
      repository: new MemoryGoodsPaymentAttemptRepository(),
      providerKeyMode: () => 'test',
      recordKeyMode: async () => { throw new Error('rpc failed'); },
    });

    await expect(checkout.prepare({ userId: USER_ID, orderId: ORDER_ID })).rejects.toThrow('rpc failed');
  });

  it('키 모드가 없는 배포(로컬·preview)는 기록하지 않고, 기록기 없이 키 모드만 있으면 계약 오류다', async () => {
    const recordKeyMode = vi.fn(async () => undefined);
    const local = createGoodsPaymentCheckout({
      provider: 'korpay',
      gateway: new FakePaymentGateway({ prepare: [prepared()] }),
      repository: new MemoryGoodsPaymentAttemptRepository(),
      providerKeyMode: () => null,
      recordKeyMode,
    });
    await expect(local.prepare({ userId: USER_ID, orderId: ORDER_ID })).resolves.toEqual(prepared());
    expect(recordKeyMode).not.toHaveBeenCalled();

    const unwired = createGoodsPaymentCheckout({
      provider: 'korpay',
      gateway: new FakePaymentGateway({ prepare: [prepared()] }),
      repository: new MemoryGoodsPaymentAttemptRepository(),
      providerKeyMode: () => 'live',
    });
    await expect(unwired.prepare({ userId: USER_ID, orderId: ORDER_ID }))
      .rejects.toMatchObject({ code: 'key_mode_recorder_missing' });
  });

  it.each(['approved', 'declined', 'canceled', 'unknown', 'needs_review'] as const)(
    'Fake gateway의 %s 결과를 공통 ConfirmOutcome으로 끝까지 확정한다',
    async (paymentOutcome) => {
      const expected = outcome(paymentOutcome);
      const { checkout, repository } = checkoutFixture([expected]);
      await checkout.prepare({ userId: USER_ID, orderId: ORDER_ID });

      await expect(checkout.confirm({
        providerOrderId: PROVIDER_ORDER_ID,
        callbackNonce: CALLBACK_NONCE,
        providerPayload: { resultCode: paymentOutcome },
      })).resolves.toEqual({ ...expected, orderId: ORDER_ID });

      expect(repository.finalizations).toEqual([
        expect.objectContaining({ attemptId: ATTEMPT_ID, outcome: expected }),
      ]);
    },
  );

  it('완료된 callback 중복은 gateway를 다시 부르지 않고 최초 결과를 재생한다', async () => {
    const approved = outcome('approved');
    const { checkout } = checkoutFixture([approved]);
    await checkout.prepare({ userId: USER_ID, orderId: ORDER_ID });
    const callback = {
      providerOrderId: PROVIDER_ORDER_ID,
      callbackNonce: CALLBACK_NONCE,
      providerPayload: { resultCode: '0000' },
    } as const;

    /* 결과는 시도 원장의 주문을 함께 싣는다 — 콜백 라우트가 완료 화면으로 보낼 때 쓴다(D12). */
    await expect(checkout.confirm(callback)).resolves.toEqual({ ...approved, orderId: ORDER_ID });
    await expect(checkout.confirm(callback)).resolves.toEqual({ ...approved, orderId: ORDER_ID });
  });

  it('unknown order 또는 nonce는 provider 호출 전에 거부한다', async () => {
    const { checkout, repository } = checkoutFixture();
    const confirmSpy = vi.spyOn(FakePaymentGateway.prototype, 'confirm');
    await checkout.prepare({ userId: USER_ID, orderId: ORDER_ID });

    await expect(checkout.confirm({
      providerOrderId: 'Offfffffffff4fff8fffffffffffffff',
      callbackNonce: CALLBACK_NONCE,
      providerPayload: {},
    })).rejects.toMatchObject({ code: 'invalid_callback' });
    await expect(checkout.confirm({
      providerOrderId: PROVIDER_ORDER_ID,
      callbackNonce: 'wrong-opaque-nonce',
      providerPayload: {},
    })).rejects.toMatchObject({ code: 'invalid_callback' });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(repository.finalizations).toHaveLength(0);
    confirmSpy.mockRestore();
  });

  it('다른 callback이 이미 claim한 attempt는 자동 재승인하지 않는다', async () => {
    const { checkout, repository } = checkoutFixture();
    await checkout.prepare({ userId: USER_ID, orderId: ORDER_ID });
    repository.claimMode = 'in_progress';

    await expect(checkout.confirm({
      providerOrderId: PROVIDER_ORDER_ID,
      callbackNonce: CALLBACK_NONCE,
      providerPayload: {},
    })).rejects.toBeInstanceOf(GoodsPaymentConfirmationInProgressError);
  });

  it('gateway가 attempt 정체성을 바꾸면 승인 대신 needs_review로 fail closed한다', async () => {
    const mismatched = outcome('approved', {
      attemptId: '30000000-0000-4000-8000-000000000999',
    });
    const { checkout, repository } = checkoutFixture([mismatched]);
    await checkout.prepare({ userId: USER_ID, orderId: ORDER_ID });

    await expect(checkout.confirm({
      providerOrderId: PROVIDER_ORDER_ID,
      callbackNonce: CALLBACK_NONCE,
      providerPayload: {},
    })).resolves.toMatchObject({
      attemptId: ATTEMPT_ID,
      provider: 'korpay',
      outcome: 'needs_review',
      reasonCode: 'provider_identity_mismatch',
    });
    expect(repository.outcomes.get(ATTEMPT_ID)?.outcome).toBe('needs_review');
  });

  it('provider confirm 호출이 모호하게 실패하면 자동 재시도하지 않고 unknown으로 고정한다', async () => {
    class ThrowingConfirmGateway extends FakePaymentGateway {
      override async confirm(): Promise<ConfirmOutcome> {
        throw new Error('provider response contained a secret');
      }
    }

    const repository = new MemoryGoodsPaymentAttemptRepository();
    const checkout = createGoodsPaymentCheckout({
      provider: 'korpay',
      gateway: new ThrowingConfirmGateway({ prepare: [prepared()] }),
      repository,
      createClaimToken: () => '40000000-0000-4000-8000-000000000205',
    });
    await checkout.prepare({ userId: USER_ID, orderId: ORDER_ID });

    await expect(checkout.confirm({
      providerOrderId: PROVIDER_ORDER_ID,
      callbackNonce: CALLBACK_NONCE,
      providerPayload: {},
    })).resolves.toEqual({
      attemptId: ATTEMPT_ID,
      provider: 'korpay',
      outcome: 'unknown',
      reasonCode: 'provider_confirm_error',
      orderId: ORDER_ID,
    });
    expect(repository.finalizations).toHaveLength(1);
    expect(repository.finalizations[0]?.outcome.outcome).toBe('unknown');
  });

  it('approved 확정은 onApproved에 주문 attempt를 넘겨 알린다', async () => {
    const onApproved = vi.fn().mockResolvedValue(undefined);
    const { checkout } = checkoutFixture([outcome('approved')], onApproved);
    await checkout.prepare({ userId: USER_ID, orderId: ORDER_ID });

    await expect(checkout.confirm(CALLBACK)).resolves.toMatchObject({ outcome: 'approved' });

    expect(onApproved).toHaveBeenCalledTimes(1);
    expect(onApproved).toHaveBeenCalledWith(
      expect.objectContaining({ id: ATTEMPT_ID, refId: ORDER_ID, purpose: 'order' }),
    );
  });

  it.each(['declined', 'canceled', 'unknown', 'needs_review'] as const)(
    '%s 종결은 onApproved를 부르지 않는다',
    async (paymentOutcome) => {
      const onApproved = vi.fn().mockResolvedValue(undefined);
      const { checkout } = checkoutFixture([outcome(paymentOutcome)], onApproved);
      await checkout.prepare({ userId: USER_ID, orderId: ORDER_ID });

      await checkout.confirm(CALLBACK);
      expect(onApproved).not.toHaveBeenCalled();
    },
  );

  it('approved terminal replay도 onApproved를 다시 불러 유실된 알림을 복구한다', async () => {
    const onApproved = vi.fn().mockResolvedValue(undefined);
    const { checkout } = checkoutFixture([outcome('approved')], onApproved);
    await checkout.prepare({ userId: USER_ID, orderId: ORDER_ID });

    await checkout.confirm(CALLBACK);
    await checkout.confirm(CALLBACK);

    // 중복 발송 억제는 hook 구현(email_deliveries 클레임)의 몫이다.
    expect(onApproved).toHaveBeenCalledTimes(2);
  });

  it('DB finalization guard가 approved를 뒤집으면 onApproved를 부르지 않는다', async () => {
    const onApproved = vi.fn().mockResolvedValue(undefined);
    const { checkout, repository } = checkoutFixture([outcome('approved')], onApproved);
    repository.finalizeOutcomeOverride = 'needs_review';
    await checkout.prepare({ userId: USER_ID, orderId: ORDER_ID });

    await expect(checkout.confirm(CALLBACK)).resolves.toMatchObject({
      outcome: 'needs_review',
      reasonCode: 'database_finalization_guard',
    });
    expect(onApproved).not.toHaveBeenCalled();
  });

  it('onApproved가 던져도 확정 결과는 그대로 돌아온다', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onApproved = vi.fn().mockRejectedValue(new Error('mail provider exploded'));
    const { checkout } = checkoutFixture([outcome('approved')], onApproved);
    await checkout.prepare({ userId: USER_ID, orderId: ORDER_ID });

    await expect(checkout.confirm(CALLBACK)).resolves.toMatchObject({ outcome: 'approved' });
    expect(onApproved).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  describe('reconcilePayment', () => {
    const CASE_REF = 'goods-webhook-case-ref-000390';

    it('unknown 종결을 조회 결과로 재정합하고, 승인 확정이면 알림 훅을 태운다', async () => {
      const onApproved = vi.fn(async () => undefined);
      const { checkout, repository } = checkoutFixture(
        [outcome('unknown')],
        onApproved,
        [outcome('approved', { reasonCode: 'provider_reconciled_approved' })],
      );
      await checkout.prepare({ userId: USER_ID, orderId: ORDER_ID });
      await checkout.confirm(CALLBACK);
      expect(onApproved).not.toHaveBeenCalled();

      const reconciled = await checkout.reconcilePayment({
        attemptId: ATTEMPT_ID,
        caseRef: CASE_REF,
      });

      expect(reconciled.outcome).toBe('approved');
      expect(repository.outcomes.get(ATTEMPT_ID)?.outcome).toBe('approved');
      expect(onApproved).toHaveBeenCalledTimes(1);
    });

    it('approved terminal 재생은 provider를 다시 부르지 않고 알림 훅만 멱등 재발화한다', async () => {
      const onApproved = vi.fn(async () => undefined);
      const { checkout } = checkoutFixture([outcome('approved')], onApproved);
      await checkout.prepare({ userId: USER_ID, orderId: ORDER_ID });
      await checkout.confirm(CALLBACK);
      expect(onApproved).toHaveBeenCalledTimes(1);

      // reconcile 스크립트가 비어 있어도 terminal 재생은 provider에 닿지 않는다.
      const replay = await checkout.reconcilePayment({
        attemptId: ATTEMPT_ID,
        caseRef: CASE_REF,
      });

      expect(replay.outcome).toBe('approved');
      expect(onApproved).toHaveBeenCalledTimes(2);
    });

    it('다른 재정합 리스가 살아 있으면 진행 중 예외로 알린다', async () => {
      const { checkout, repository } = checkoutFixture(
        [outcome('unknown')],
        undefined,
        [outcome('approved')],
      );
      await checkout.prepare({ userId: USER_ID, orderId: ORDER_ID });
      await checkout.confirm(CALLBACK);
      repository.claimMode = 'in_progress';

      await expect(checkout.reconcilePayment({ attemptId: ATTEMPT_ID, caseRef: CASE_REF }))
        .rejects.toBeInstanceOf(GoodsPaymentReconciliationInProgressError);
    });

    it('provider 조회가 throw하면 unknown으로 보존해 다음 재정합에 맡긴다', async () => {
      const { checkout, repository } = checkoutFixture([outcome('unknown')]);
      await checkout.prepare({ userId: USER_ID, orderId: ORDER_ID });
      await checkout.confirm(CALLBACK);

      // reconcile 스크립트 소진 상태 — Fake가 throw한다.
      const reconciled = await checkout.reconcilePayment({
        attemptId: ATTEMPT_ID,
        caseRef: CASE_REF,
      });

      expect(reconciled.outcome).toBe('unknown');
      expect(repository.outcomes.get(ATTEMPT_ID)?.outcome).toBe('unknown');
    });

    it('caseRef 형식 위반은 저장소에 닿기 전에 계약 오류다', async () => {
      const { checkout } = checkoutFixture();
      await expect(checkout.reconcilePayment({ attemptId: ATTEMPT_ID, caseRef: 'short' }))
        .rejects.toBeInstanceOf(GoodsPaymentContractError);
    });

    it.each([['webhook-payment-key-hint'], [undefined]])(
      '웹훅 paymentKey 힌트(%s)는 게이트웨이 조회 힌트로만 넘기고, 없으면 힌트 인자 없이 부른다',
      async (hint) => {
        const repository = new MemoryGoodsPaymentAttemptRepository();
        const gateway = new FakePaymentGateway({
          prepare: [prepared()],
          confirm: [outcome('unknown')],
          reconcile: [outcome('approved', { reasonCode: 'provider_reconciled_approved' })],
        });
        const reconcileSpy = vi.spyOn(gateway, 'reconcile');
        const checkout = createGoodsPaymentCheckout({
          provider: 'korpay',
          gateway,
          repository,
          createClaimToken: () => '40000000-0000-4000-8000-000000000205',
        });
        await checkout.prepare({ userId: USER_ID, orderId: ORDER_ID });
        await checkout.confirm(CALLBACK);

        const reconciled = await checkout.reconcilePayment({
          attemptId: ATTEMPT_ID,
          caseRef: CASE_REF,
          ...(hint ? { providerPaymentKeyHint: hint } : {}),
        });

        expect(reconciled.outcome).toBe('approved');
        expect(reconcileSpy).toHaveBeenCalledTimes(1);
        const [attemptArg, ...rest] = reconcileSpy.mock.calls[0]!;
        expect(attemptArg.id).toBe(ATTEMPT_ID);
        expect(rest).toEqual(hint ? [{ providerPaymentKey: hint }] : []);
      },
    );
  });
});

describe('가상계좌 입금 대기(ADR-0049)', () => {
  const VA_EVIDENCE = {
    providerPaymentKey: 'va-payment-key',
    resultCode: 'WAITING_FOR_DEPOSIT',
    paymentMethod: '가상계좌',
    virtualAccount: {
      bankCode: '20',
      accountNumber: 'X6505636518308',
      dueAt: '2026-11-24T03:00:00.000Z',
      useEscrow: false,
      refundReceiveAccount: null,
    },
  } as const;

  function vaFixture(confirm: readonly ConfirmOutcome[], reconcile: readonly ConfirmOutcome[] = []) {
    const repository = new MemoryGoodsPaymentAttemptRepository();
    const releaseVirtualAccount = vi.fn(async () => undefined);
    const gateway = Object.assign(new FakePaymentGateway({ prepare: [prepared()], confirm, reconcile }), {
      releaseVirtualAccount,
    });
    const onApproved = vi.fn(async () => undefined);
    const onAwaitingDeposit = vi.fn(async () => undefined);
    const checkout = createGoodsPaymentCheckout({
      provider: 'korpay',
      gateway,
      repository,
      createClaimToken: () => '40000000-0000-4000-8000-000000000205',
      onApproved,
      onAwaitingDeposit,
    });
    return { checkout, repository, gateway, releaseVirtualAccount, onApproved, onAwaitingDeposit };
  }

  it('DB가 입금 대기를 확정하면 입금 안내 알림만 보내고 계좌를 반납하지 않는다', async () => {
    const { checkout, releaseVirtualAccount, onApproved, onAwaitingDeposit } = vaFixture([
      outcome('awaiting_deposit', { evidence: VA_EVIDENCE }),
    ]);
    await checkout.prepare({ userId: USER_ID, orderId: ORDER_ID });

    const result = await checkout.confirm(CALLBACK);

    expect(result.outcome).toBe('awaiting_deposit');
    expect(result.orderId).toBe(ORDER_ID);
    expect(onAwaitingDeposit).toHaveBeenCalledTimes(1);
    expect(onApproved).not.toHaveBeenCalled();
    expect(releaseVirtualAccount).not.toHaveBeenCalled();
  });

  it('DB가 입금 대기를 거부하면(needs_review) 발급된 계좌를 같은 요청에서 반납한다 — 알림은 보내지 않는다', async () => {
    const { checkout, repository, releaseVirtualAccount, onAwaitingDeposit } = vaFixture([
      outcome('awaiting_deposit', { evidence: VA_EVIDENCE }),
    ]);
    repository.finalizeOutcomeOverride = 'needs_review';
    await checkout.prepare({ userId: USER_ID, orderId: ORDER_ID });

    const result = await checkout.confirm(CALLBACK);

    expect(result.outcome).toBe('needs_review');
    expect(releaseVirtualAccount).toHaveBeenCalledWith(expect.objectContaining({ id: ATTEMPT_ID }), 'va-payment-key');
    expect(onAwaitingDeposit).not.toHaveBeenCalled();
  });

  it('반납 실패는 확정 결과를 바꾸지 않는다(뒤따르는 웹훅·재정합이 조회로 닫는다)', async () => {
    const { checkout, repository, releaseVirtualAccount } = vaFixture([
      outcome('awaiting_deposit', { evidence: VA_EVIDENCE }),
    ]);
    repository.finalizeOutcomeOverride = 'needs_review';
    releaseVirtualAccount.mockRejectedValueOnce(new Error('network'));
    await checkout.prepare({ userId: USER_ID, orderId: ORDER_ID });

    await expect(checkout.confirm(CALLBACK)).resolves.toMatchObject({ outcome: 'needs_review' });
  });

  it('입금 전 취소의 재정합은 반납 힌트를 게이트웨이에 넘긴다', async () => {
    const { checkout, repository, gateway } = vaFixture(
      [outcome('unknown')],
      [outcome('declined', { reasonCode: 'provider_virtual_account_released' })],
    );
    await checkout.prepare({ userId: USER_ID, orderId: ORDER_ID });
    await checkout.confirm(CALLBACK);
    const reconcile = vi.spyOn(gateway, 'reconcile');

    const result = await checkout.reconcilePayment({
      attemptId: ATTEMPT_ID,
      caseRef: 'cancel-release-0123456789',
      providerPaymentKeyHint: 'va-payment-key',
      releaseVirtualAccount: true,
    });

    expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({ id: ATTEMPT_ID }), {
      providerPaymentKey: 'va-payment-key',
      releaseVirtualAccount: true,
    });
    expect(result.outcome).toBe('declined');
    expect(repository.finalizations.at(-1)?.outcome.reasonCode).toBe('provider_virtual_account_released');
  });
});
