import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TicketPaymentContractError } from './ticket-checkout';
import { createRuntimeTicketPaymentCheckout } from './ticket-checkout.runtime.server';

const mocks = vi.hoisted(() => ({
  getPaymentGateway: vi.fn(),
  repository: {
    prepareTicketAttempt: vi.fn(),
    bindCallbackNonce: vi.fn(),
    claimTicketAttempt: vi.fn(),
    finalizeTicketAttempt: vi.fn(),
    claimTicketRefund: vi.fn(),
    finalizeTicketRefund: vi.fn(),
  },
}));

vi.mock('../supabase/service', () => ({
  createServiceClient: () => ({ rpc: vi.fn() }),
}));
vi.mock('./runtime-gateway', () => ({
  getPaymentGateway: mocks.getPaymentGateway,
}));
vi.mock('./ticket-checkout.server', () => ({
  createTicketPaymentAttemptRepository: () => mocks.repository,
}));

describe('createRuntimeTicketPaymentCheckout', () => {
  beforeEach(() => {
    mocks.getPaymentGateway.mockReset();
    for (const fn of Object.values(mocks.repository)) fn.mockReset();
  });

  it('신규 provider가 OFF여도 DB가 legacy로 판정한 Toss 취소는 fallback까지 도달한다', async () => {
    mocks.getPaymentGateway.mockImplementation(() => {
      throw new Error('payment gateway unavailable');
    });
    mocks.repository.claimTicketRefund.mockResolvedValue({ status: 'legacy' });

    const checkout = createRuntimeTicketPaymentCheckout();

    await expect(checkout.refund({
      requestId: '40000000-0000-4000-8000-000000000206',
      userId: '00000000-0000-4000-8000-000000000206',
      reason: '사용자 티켓 예매 취소',
    })).rejects.toMatchObject<TicketPaymentContractError>({
      code: 'legacy_payment',
    });
    expect(mocks.getPaymentGateway).not.toHaveBeenCalled();
  });

  it('provider-neutral 환급 claim이 생긴 뒤에만 runtime gateway를 resolve한다', async () => {
    const attempt = {
      id: '30000000-0000-4000-8000-000000000206',
      provider: 'korpay' as const,
      purpose: 'ticket' as const,
      refId: '20000000-0000-4000-8000-000000000206',
      amount: 44_000,
      currency: 'KRW',
      idempotencyKey: 'ticket:20000000-0000-4000-8000-000000000206',
      providerOrderId: 'T30000000000040008000000000000206',
      providerProductCode: 'P30000000000040008000000000000206',
      expiresAt: '2099-08-13T10:10:00.000Z',
    };
    const refund = vi.fn().mockResolvedValue({
      attemptId: attempt.id,
      provider: 'korpay',
      outcome: 'approved',
      refundedAmount: attempt.amount,
    });
    mocks.getPaymentGateway.mockReturnValue({ refund });
    mocks.repository.claimTicketRefund.mockResolvedValue({
      status: 'claimed',
      attempt,
      claimToken: '50000000-0000-4000-8000-000000000206',
    });
    mocks.repository.finalizeTicketRefund.mockResolvedValue({
      attemptId: attempt.id,
      provider: 'korpay',
      outcome: 'approved',
      refundedAmount: attempt.amount,
    });

    const checkout = createRuntimeTicketPaymentCheckout();
    expect(mocks.getPaymentGateway).not.toHaveBeenCalled();

    await expect(checkout.refund({
      requestId: '40000000-0000-4000-8000-000000000206',
      userId: '00000000-0000-4000-8000-000000000206',
      reason: '사용자 티켓 예매 취소',
    })).resolves.toMatchObject({ outcome: 'approved' });
    expect(mocks.getPaymentGateway).toHaveBeenCalledTimes(1);
    expect(refund).toHaveBeenCalledTimes(1);
  });
});
