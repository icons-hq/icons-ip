import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConfirmOutcome, PaymentAttempt } from './gateway';
import { createRuntimeGoodsPaymentCheckout } from './goods-checkout.runtime.server';

/* Composition root 배선 검증 — deep module은 진짜를 쓰고 경계만 대체한다.
 * 여기서 확인하려는 것은 checkout 로직이 아니라 "승인 확정이 주문 확인 메일
 * 훅(#239·D8)까지 실제로 이어지는가"와 provider 인자가 게이트웨이 선택까지
 * 흐르는가다. 기본 provider는 toss(에픽 #384), korpay는 콜백 drain용 명시 인자. */

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

function attemptFor(provider: 'toss' | 'korpay'): PaymentAttempt {
  return {
    id: ATTEMPT_ID,
    provider,
    purpose: 'order',
    refId: ORDER_ID,
    amount: 31_000,
    currency: 'KRW',
    idempotencyKey: `goods:${ORDER_ID}`,
    providerOrderId: 'O30000000000040008000000000000207',
    providerProductCode: 'P30000000000040008000000000000207',
    expiresAt: '2099-08-13T10:10:00.000Z',
  };
}

function outcomeFor(
  provider: 'toss' | 'korpay',
  value: ConfirmOutcome['outcome'],
): ConfirmOutcome {
  return { attemptId: ATTEMPT_ID, provider, outcome: value };
}

function stubConfirmedPayment(provider: 'toss' | 'korpay', value: ConfirmOutcome['outcome']) {
  mocks.getPaymentGateway.mockReturnValue({
    confirm: vi.fn().mockResolvedValue(outcomeFor(provider, value)),
  });
  mocks.repository.claimOrderAttempt.mockResolvedValue({
    status: 'claimed',
    attempt: attemptFor(provider),
    claimToken: '50000000-0000-4000-8000-000000000207',
  });
  mocks.repository.finalizeOrderAttempt.mockImplementation(
    async (input: { outcome: ConfirmOutcome }) => input.outcome,
  );
}

const callback = {
  providerOrderId: 'O30000000000040008000000000000207',
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

  it('기본 provider는 toss이고 승인 확정은 주문 확인 메일 훅을 주문 id로 부른다', async () => {
    stubConfirmedPayment('toss', 'approved');

    await expect(createRuntimeGoodsPaymentCheckout().confirm(callback))
      .resolves.toMatchObject({ outcome: 'approved' });

    expect(mocks.getPaymentGateway).toHaveBeenCalledWith('toss');
    expect(mocks.sendOrderConfirmationEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendOrderConfirmationEmail).toHaveBeenCalledWith(ORDER_ID);
  });

  it('korpay를 명시하면 drain 조립도 같은 메일 훅으로 종결된다', async () => {
    stubConfirmedPayment('korpay', 'approved');

    await expect(createRuntimeGoodsPaymentCheckout('korpay').confirm(callback))
      .resolves.toMatchObject({ outcome: 'approved' });

    expect(mocks.getPaymentGateway).toHaveBeenCalledWith('korpay');
    expect(mocks.sendOrderConfirmationEmail).toHaveBeenCalledWith(ORDER_ID);
  });

  it('승인이 아닌 종결은 메일 훅에 닿지 않는다', async () => {
    stubConfirmedPayment('toss', 'declined');

    await expect(createRuntimeGoodsPaymentCheckout().confirm(callback))
      .resolves.toMatchObject({ outcome: 'declined' });

    expect(mocks.sendOrderConfirmationEmail).not.toHaveBeenCalled();
  });
});
