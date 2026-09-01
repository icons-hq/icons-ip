import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TicketPaymentContractError,
  TicketRefundInProgressError,
} from './ticket-checkout';
import { createRuntimeTicketPaymentCheckout } from './ticket-checkout.runtime.server';

const mocks = vi.hoisted(() => ({
  getPaymentGateway: vi.fn(),
  repository: {
    prepareTicketAttempt: vi.fn(),
    bindCallbackNonce: vi.fn(),
    claimTicketAttempt: vi.fn(),
    finalizeTicketAttempt: vi.fn(),
    claimTicketReconciliation: vi.fn(),
    finalizeTicketReconciliation: vi.fn(),
    claimTicketRefund: vi.fn(),
    finalizeTicketRefund: vi.fn(),
    claimTicketRefundReconciliation: vi.fn(),
    finalizeTicketRefundReconciliation: vi.fn(),
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
    })).rejects.toMatchObject({
      code: 'legacy_payment',
    } satisfies Partial<TicketPaymentContractError>);
    expect(mocks.getPaymentGateway).not.toHaveBeenCalled();
  });

  it('provider-neutral 환급 claim이 생긴 뒤에만 runtime gateway를 resolve한다', async () => {
    const attempt = {
      id: '30000000-0000-4000-8000-000000000206',
      provider: 'toss' as const,
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
      provider: 'toss',
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
      provider: 'toss',
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

  it('prepared provider session의 취소 요청은 callback/TTL을 기다리고 refund provider를 호출하지 않는다', async () => {
    const attempt = {
      id: '30000000-0000-4000-8000-000000000206',
      provider: 'toss' as const,
      purpose: 'ticket' as const,
      refId: '20000000-0000-4000-8000-000000000206',
      amount: 44_000,
      currency: 'KRW',
      idempotencyKey: 'ticket:20000000-0000-4000-8000-000000000206',
      providerOrderId: 'T30000000000040008000000000000206',
      providerProductCode: 'P30000000000040008000000000000206',
      expiresAt: '2099-08-13T10:10:00.000Z',
    };
    mocks.repository.claimTicketRefund.mockResolvedValue({
      status: 'in_progress',
      attempt,
    });

    const checkout = createRuntimeTicketPaymentCheckout();
    await expect(checkout.refund({
      requestId: '40000000-0000-4000-8000-000000000206',
      userId: '00000000-0000-4000-8000-000000000206',
      reason: '사용자 티켓 예매 취소',
    })).rejects.toBeInstanceOf(TicketRefundInProgressError);
    expect(mocks.getPaymentGateway).not.toHaveBeenCalled();
  });

  it('명시적 reconciliation claim 뒤에만 runtime gateway 조회를 resolve한다', async () => {
    const attempt = {
      id: '30000000-0000-4000-8000-000000000206',
      provider: 'toss' as const,
      purpose: 'ticket' as const,
      refId: '20000000-0000-4000-8000-000000000206',
      amount: 44_000,
      currency: 'KRW',
      idempotencyKey: 'ticket:20000000-0000-4000-8000-000000000206',
      providerOrderId: 'T30000000000040008000000000000206',
      providerProductCode: 'P30000000000040008000000000000206',
      expiresAt: '2099-08-13T10:10:00.000Z',
    };
    const reconcile = vi.fn().mockResolvedValue({
      attemptId: attempt.id,
      provider: 'toss',
      outcome: 'approved',
    });
    mocks.getPaymentGateway.mockReturnValue({ reconcile });
    mocks.repository.claimTicketReconciliation.mockResolvedValue({
      status: 'claimed',
      attempt,
      claimToken: '50000000-0000-4000-8000-000000000206',
    });
    mocks.repository.finalizeTicketReconciliation.mockResolvedValue({
      attemptId: attempt.id,
      provider: 'toss',
      outcome: 'approved',
    });

    const checkout = createRuntimeTicketPaymentCheckout();
    expect(mocks.getPaymentGateway).not.toHaveBeenCalled();

    await expect(checkout.reconcilePayment({
      attemptId: attempt.id,
      caseRef: 'case_ticket_opaque_206',
    }))
      .resolves.toMatchObject({ outcome: 'approved' });
    expect(mocks.repository.claimTicketReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        caseRef: 'case_ticket_opaque_206',
      }),
    );
    expect(mocks.getPaymentGateway).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith(attempt);
  });

  it('refund reconciliation도 전용 request claim 뒤에서만 provider 조회한다', async () => {
    const attempt = {
      id: '30000000-0000-4000-8000-000000000206',
      provider: 'toss' as const,
      purpose: 'ticket' as const,
      refId: '20000000-0000-4000-8000-000000000206',
      amount: 44_000,
      currency: 'KRW',
      idempotencyKey: 'ticket:20000000-0000-4000-8000-000000000206',
      providerOrderId: 'T30000000000040008000000000000206',
      providerProductCode: 'P30000000000040008000000000000206',
      expiresAt: '2099-08-13T10:10:00.000Z',
    };
    const reconcile = vi.fn().mockResolvedValue({
      attemptId: attempt.id,
      provider: 'toss',
      outcome: 'canceled',
    });
    mocks.getPaymentGateway.mockReturnValue({ reconcile });
    mocks.repository.claimTicketRefundReconciliation.mockResolvedValue({
      status: 'claimed',
      attempt,
      claimToken: '50000000-0000-4000-8000-000000000206',
    });
    mocks.repository.finalizeTicketRefundReconciliation.mockResolvedValue({
      attemptId: attempt.id,
      provider: 'toss',
      outcome: 'approved',
      refundedAmount: attempt.amount,
    });

    const checkout = createRuntimeTicketPaymentCheckout();
    await expect(checkout.reconcileRefund({
      requestId: '40000000-0000-4000-8000-000000000206',
      caseRef: 'case_refund_opaque_206',
    })).resolves.toMatchObject({ outcome: 'approved', refundedAmount: 44_000 });
    expect(mocks.repository.claimTicketRefundReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        caseRef: 'case_refund_opaque_206',
      }),
    );
    expect(mocks.getPaymentGateway).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith(attempt);
  });
});
