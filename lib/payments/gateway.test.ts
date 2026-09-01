import { describe, expect, it } from 'vitest';
import {
  PAYMENT_OUTCOMES,
  type ConfirmOutcome,
  type PaymentAttempt,
  type PaymentProvider,
  type PaymentReturnInput,
  type PreparedCheckout,
  type RefundOutcome,
} from './gateway';
import {
  FakePaymentGateway,
  PaymentGatewayIdempotencyConflictError,
} from './fake-payment-gateway';

const ATTEMPT_ID = '30000000-0000-4000-8000-000000000901';

function attempt(overrides: Partial<PaymentAttempt> = {}): PaymentAttempt {
  return {
    id: ATTEMPT_ID,
    provider: 'korpay',
    purpose: 'order',
    refId: '20000000-0000-4000-8000-000000000901',
    amount: 31_000,
    currency: 'KRW',
    idempotencyKey: 'checkout-order-901',
    providerOrderId: 'O30000000000040008000000000000901',
    providerProductCode: 'P30000000000040008000000000000901',
    expiresAt: '2026-08-13T10:10:00.000Z',
    ...overrides,
  };
}

function checkout(attemptId = ATTEMPT_ID): PreparedCheckout {
  return {
    attemptId,
    provider: 'korpay',
    action: {
      kind: 'form_post',
      url: 'https://payments.example.test/authenticate',
      fields: { orderNumber: 'O30000000000040008000000000000901' },
    },
    callbackNonce: 'opaque-single-use-nonce',
    expiresAt: '2026-08-13T10:10:00.000Z',
  };
}

function returnInput(overrides: Partial<PaymentReturnInput> = {}): PaymentReturnInput {
  return {
    attempt: attempt(),
    idempotencyKey: 'confirm-order-901',
    providerOrderId: 'O30000000000040008000000000000901',
    callbackNonce: 'opaque-single-use-nonce',
    providerPayload: { resultCode: '0000' },
    ...overrides,
  };
}

// 유니온이 DB enum과 어긋나면 컴파일 단계에서 걸린다: 값이 빠지면 초과 속성으로,
// 값이 늘면 누락 속성으로 이 Record가 실패한다.
const PAYMENT_PROVIDERS: Record<PaymentProvider, true> = {
  toss: true,
  korpay: true,
  bank_transfer: true,
};

describe('PaymentProvider', () => {
  it('원장 provider 축은 DB enum public.payment_provider 3종과 일치한다', () => {
    expect(Object.keys(PAYMENT_PROVIDERS).sort()).toEqual([
      'bank_transfer',
      'korpay',
      'toss',
    ]);
  });
});

describe('FakePaymentGateway', () => {
  it.each(PAYMENT_OUTCOMES)('공통 confirm outcome %s를 공개 계약으로 반환한다', async (outcome) => {
    const expected: ConfirmOutcome = {
      attemptId: ATTEMPT_ID,
      provider: 'korpay',
      outcome,
      reasonCode: `fake_${outcome}`,
    };
    const gateway = new FakePaymentGateway({ confirm: [expected] });

    await expect(gateway.confirm(returnInput())).resolves.toEqual(expected);
  });

  it('prepare 재시도는 같은 멱등 키와 입력에 최초 checkout을 재생한다', async () => {
    const first = checkout();
    const second = checkout('30000000-0000-4000-8000-000000000902');
    const gateway = new FakePaymentGateway({ prepare: [first, second] });

    await expect(gateway.prepare(attempt())).resolves.toEqual(first);
    await expect(gateway.prepare(attempt())).resolves.toEqual(first);
    await expect(gateway.prepare(attempt({
      id: '30000000-0000-4000-8000-000000000902',
      idempotencyKey: 'checkout-order-902',
    }))).resolves.toEqual(second);
  });

  it('같은 prepare 멱등 키가 다른 결제 입력에 재사용되면 conflict로 닫는다', async () => {
    const gateway = new FakePaymentGateway({ prepare: [checkout()] });
    await gateway.prepare(attempt());

    await expect(gateway.prepare(attempt({ amount: 32_000 })))
      .rejects.toBeInstanceOf(PaymentGatewayIdempotencyConflictError);
  });

  it('confirm callback 중복은 provider 결과가 바뀌어도 최초 결과를 재생한다', async () => {
    const approved: ConfirmOutcome = {
      attemptId: ATTEMPT_ID,
      provider: 'korpay',
      outcome: 'approved',
    };
    const declined: ConfirmOutcome = {
      attemptId: ATTEMPT_ID,
      provider: 'korpay',
      outcome: 'declined',
    };
    const gateway = new FakePaymentGateway({ confirm: [approved, declined] });

    await expect(gateway.confirm(returnInput())).resolves.toEqual(approved);
    await expect(gateway.confirm(returnInput())).resolves.toEqual(approved);
    await expect(gateway.confirm(returnInput({
      idempotencyKey: 'confirm-order-902',
      callbackNonce: 'another-single-use-nonce',
    }))).resolves.toEqual(declined);
  });

  it('reconcile은 같은 attempt의 provider 상태 변화를 순서대로 관찰할 수 있다', async () => {
    const unknown: ConfirmOutcome = {
      attemptId: ATTEMPT_ID,
      provider: 'korpay',
      outcome: 'unknown',
    };
    const approved: ConfirmOutcome = {
      attemptId: ATTEMPT_ID,
      provider: 'korpay',
      outcome: 'approved',
    };
    const gateway = new FakePaymentGateway({ reconcile: [unknown, approved] });

    await expect(gateway.reconcile(attempt())).resolves.toEqual(unknown);
    await expect(gateway.reconcile(attempt())).resolves.toEqual(approved);
  });

  it('refund 재시도는 같은 멱등 키와 입력에 최초 결과를 재생한다', async () => {
    const paid: RefundOutcome = {
      attemptId: ATTEMPT_ID,
      provider: 'korpay',
      outcome: 'approved',
      refundedAmount: 31_000,
    };
    const gateway = new FakePaymentGateway({ refund: [paid] });
    const request = {
      attempt: attempt(),
      idempotencyKey: 'refund-order-901',
      amount: 31_000,
      reason: 'customer_request',
    } as const;

    await expect(gateway.refund(request)).resolves.toEqual(paid);
    await expect(gateway.refund(request)).resolves.toEqual(paid);
  });
});
