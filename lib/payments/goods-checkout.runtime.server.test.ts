import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfirmOutcome, PaymentAttempt } from './gateway';
import { createRuntimeGoodsPaymentCheckout } from './goods-checkout.runtime.server';

/* Composition root 배선 검증 — deep module은 진짜를 쓰고 경계만 대체한다.
 * 여기서 확인하려는 것은 checkout 로직이 아니라 "Korpay 승인 확정이
 * 주문 확인 메일 훅(#239·D8)까지 실제로 이어지는가"다. */

const ORDER_ID = '20000000-0000-4000-8000-000000000207';
const ATTEMPT_ID = '30000000-0000-4000-8000-000000000207';

const mocks = vi.hoisted(() => ({
  getPaymentGateway: vi.fn(),
  sendOrderConfirmationEmail: vi.fn(),
  repository: {
    prepareOrderAttempt: vi.fn(),
    bindCallbackNonce: vi.fn(),
    claimOrderAttempt: vi.fn(),
    finalizeOrderAttempt: vi.fn(),
  },
}));

vi.mock('../supabase/service', () => ({
  createServiceClient: () => ({ rpc: vi.fn() }),
}));
vi.mock('./runtime-gateway', () => ({
  getPaymentGateway: mocks.getPaymentGateway,
}));
vi.mock('./goods-checkout.server', () => ({
  createGoodsPaymentAttemptRepository: () => mocks.repository,
}));
vi.mock('../email/transactional.server', () => ({
  sendOrderConfirmationEmail: mocks.sendOrderConfirmationEmail,
}));

const attempt: PaymentAttempt = {
  id: ATTEMPT_ID,
  provider: 'korpay',
  purpose: 'order',
  refId: ORDER_ID,
  amount: 31_000,
  currency: 'KRW',
  idempotencyKey: `goods:${ORDER_ID}`,
  providerOrderId: 'O30000000000040008000000000000207',
  providerProductCode: 'P30000000000040008000000000000207',
  expiresAt: '2099-08-13T10:10:00.000Z',
};

function outcome(value: ConfirmOutcome['outcome']): ConfirmOutcome {
  return { attemptId: ATTEMPT_ID, provider: 'korpay', outcome: value };
}

function stubConfirmedPayment(value: ConfirmOutcome['outcome']) {
  mocks.getPaymentGateway.mockReturnValue({
    confirm: vi.fn().mockResolvedValue(outcome(value)),
  });
  mocks.repository.claimOrderAttempt.mockResolvedValue({
    status: 'claimed',
    attempt,
    claimToken: '50000000-0000-4000-8000-000000000207',
  });
  mocks.repository.finalizeOrderAttempt.mockImplementation(
    async (input: { outcome: ConfirmOutcome }) => input.outcome,
  );
}

const callback = {
  providerOrderId: attempt.providerOrderId,
  callbackNonce: 'opaque-callback-nonce-207',
  providerPayload: { resultCode: '0000' },
} as const;

describe('createRuntimeGoodsPaymentCheckout', () => {
  beforeEach(() => {
    mocks.getPaymentGateway.mockReset();
    mocks.sendOrderConfirmationEmail.mockReset();
    mocks.sendOrderConfirmationEmail.mockResolvedValue({ status: 'sent' });
    for (const fn of Object.values(mocks.repository)) fn.mockReset();
  });

  it('Korpay 승인 확정은 주문 확인 메일 훅을 주문 id로 부른다', async () => {
    stubConfirmedPayment('approved');

    await expect(createRuntimeGoodsPaymentCheckout().confirm(callback))
      .resolves.toMatchObject({ outcome: 'approved' });

    expect(mocks.sendOrderConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendOrderConfirmationEmail).toHaveBeenCalledWith(ORDER_ID);
  });

  it('승인이 아닌 종결은 메일 훅에 닿지 않는다', async () => {
    stubConfirmedPayment('declined');

    await expect(createRuntimeGoodsPaymentCheckout().confirm(callback))
      .resolves.toMatchObject({ outcome: 'declined' });

    expect(mocks.sendOrderConfirmationEmail).not.toHaveBeenCalled();
  });
});
