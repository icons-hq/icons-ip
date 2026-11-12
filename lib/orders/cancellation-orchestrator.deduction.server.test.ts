import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefundOutcome } from '../payments/gateway';
import {
  parseCancellationRefundDeduction,
  reconcileOrderCancellation,
  type CancellationReconciliationContext,
  type CancellationReconciliationDependencies,
  type CancellationRefundDeduction,
} from './cancellation-orchestrator.server';

/*
 * 반품배송비 차감(ADR-0031). 결정은 환불 접수 때 DB가 정하고, 오케스트레이터는 그 결정대로 결제사 부분 취소를 발행한다.
 * 결정이 없으면 지금 그대로 전액 취소다(스위치 OFF 불변 — 기존 cancellation-orchestrator.server.test.ts가 그대로 통과한다).
 */

const defaultMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  gatewayRefund: vi.fn(),
  request: null as Record<string, unknown> | null,
  payments: [] as Array<Record<string, unknown>>,
  refunds: [] as Array<Record<string, unknown>>,
  attempt: null as Record<string, unknown> | null,
}));

vi.mock('../payments/runtime-gateway', () => ({
  getPaymentGateway: () => ({ refund: defaultMocks.gatewayRefund }),
}));

vi.mock('../supabase/service', () => ({
  createServiceClient: () => ({
    rpc: defaultMocks.rpc,
    from: (table: string) => {
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        in: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({
          data: table === 'payment_attempts' ? defaultMocks.attempt : defaultMocks.request,
          error: null,
        })),
        order: vi.fn(async () => ({
          data: table === 'refunds' ? defaultMocks.refunds : defaultMocks.payments,
          error: null,
        })),
      };
      return query;
    },
  }),
}));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';
const ATTEMPT_ID = '44444444-4444-4444-8444-444444444444';
const PAYMENT_KEY = 'payment-secret-key';

const planned: CancellationRefundDeduction = {
  paymentId: 'payment-1',
  state: 'planned',
  paymentAmount: 30000,
  deductionAmount: 3000,
  refundAmount: 27000,
};

function approvedRefund(overrides: Partial<RefundOutcome> = {}): RefundOutcome {
  return {
    attemptId: ATTEMPT_ID,
    provider: 'toss',
    outcome: 'approved',
    reasonCode: 'provider_cancel_confirmed',
    refundedAmount: 30000,
    evidence: { providerPaymentKey: PAYMENT_KEY },
    ...overrides,
  };
}

function partialRefund(overrides: Partial<RefundOutcome> = {}): RefundOutcome {
  return approvedRefund({
    reasonCode: 'provider_partial_cancel_confirmed',
    refundedAmount: 27000,
    balanceAfter: 3000,
    evidence: { providerPaymentKey: PAYMENT_KEY, providerTransactionId: 'TX-PARTIAL-1', resultCode: 'PARTIAL_CANCELED' },
    ...overrides,
  });
}

function context(): CancellationReconciliationContext {
  return {
    requestId: REQUEST_ID,
    orderId: ORDER_ID,
    status: 'processing',
    payments: [{
      id: 'payment-1', provider: 'toss', status: 'paid', amount: 30000, paymentKey: PAYMENT_KEY, bankTransferRefundFiled: false,
    }],
  };
}

function deductionDependencies(load: () => Promise<CancellationRefundDeduction | null>) {
  return {
    load: vi.fn(load),
    recordPartialRefund: vi.fn(async () => undefined),
    fallbackToFullRefund: vi.fn(async () => undefined),
  };
}

function dependencies(
  override: Partial<CancellationReconciliationDependencies> = {},
): CancellationReconciliationDependencies {
  return {
    loadContext: vi.fn(async () => context()),
    preflightReconciliation: vi.fn(async () => 'allowed' as const),
    reconcileExpiredPreparedGoods: vi.fn(async () => 'not_applicable' as const),
    refundProviderPayment: vi.fn(async () => approvedRefund()),
    completeRequest: vi.fn(async () => undefined),
    markNeedsReview: vi.fn(async () => undefined),
    ...override,
  };
}

const FULL_REFUND_CALL = {
  paymentId: 'payment-1', provider: 'toss', amount: 30000, reason: 'ICONS 주문 취소', paymentKey: PAYMENT_KEY,
};

describe('reconcileOrderCancellation — 반품배송비 차감', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('결정이 없으면 지금과 같은 전액 취소다', async () => {
    const refundDeduction = deductionDependencies(async () => null);
    const deps = dependencies({ refundDeduction });

    await expect(reconcileOrderCancellation({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps))
      .resolves.toEqual({ ok: true, status: 'completed' });

    expect(deps.refundProviderPayment).toHaveBeenCalledTimes(1);
    expect(deps.refundProviderPayment).toHaveBeenCalledWith(FULL_REFUND_CALL);
    expect(refundDeduction.recordPartialRefund).not.toHaveBeenCalled();
    expect(refundDeduction.fallbackToFullRefund).not.toHaveBeenCalled();
    expect(deps.completeRequest).toHaveBeenCalledWith({
      requestId: REQUEST_ID, actorId: ACTOR_ID, verifiedPaymentKeys: [PAYMENT_KEY],
    });
  });

  it('전액 환불로 돌린 결정(not_applied)도 지금과 같은 전액 취소다', async () => {
    const refundDeduction = deductionDependencies(async () => ({ ...planned, state: 'not_applied' }));
    const deps = dependencies({ refundDeduction });

    await expect(reconcileOrderCancellation({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps))
      .resolves.toEqual({ ok: true, status: 'completed' });
    expect(deps.refundProviderPayment).toHaveBeenCalledWith(FULL_REFUND_CALL);
    expect(refundDeduction.fallbackToFullRefund).not.toHaveBeenCalled();
  });

  it('planned 결정은 결제사 부분 취소로 환불액만 돌려주고 확인을 적은 뒤 완료한다', async () => {
    const refundDeduction = deductionDependencies(async () => planned);
    const deps = dependencies({ refundDeduction, refundProviderPayment: vi.fn(async () => partialRefund()) });

    await expect(reconcileOrderCancellation({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps))
      .resolves.toEqual({ ok: true, status: 'completed' });

    expect(deps.refundProviderPayment).toHaveBeenCalledTimes(1);
    expect(deps.refundProviderPayment).toHaveBeenCalledWith({
      paymentId: 'payment-1', provider: 'toss', amount: 30000, reason: 'ICONS 반품 환불(반품배송비 차감)',
      paymentKey: PAYMENT_KEY, partial: { refundAmount: 27000, requestId: REQUEST_ID },
    });
    expect(refundDeduction.recordPartialRefund).toHaveBeenCalledWith({
      requestId: REQUEST_ID, actorId: ACTOR_ID, paymentId: 'payment-1', refundedAmount: 27000,
      paymentKey: PAYMENT_KEY, transactionKey: 'TX-PARTIAL-1',
    });
    expect(refundDeduction.recordPartialRefund.mock.invocationCallOrder[0])
      .toBeLessThan((deps.completeRequest as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]);
    expect(deps.completeRequest).toHaveBeenCalledWith({
      requestId: REQUEST_ID, actorId: ACTOR_ID, verifiedPaymentKeys: [PAYMENT_KEY],
    });
    expect(deps.markNeedsReview).not.toHaveBeenCalled();
  });

  it('부분 취소 결과의 금액이 결정과 다르면 확정하지 않는다', async () => {
    const refundDeduction = deductionDependencies(async () => planned);
    const deps = dependencies({
      refundDeduction,
      refundProviderPayment: vi.fn(async () => partialRefund({ refundedAmount: 30000 })),
    });

    await expect(reconcileOrderCancellation({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps))
      .resolves.toEqual({ ok: false, code: 'provider_cancel_failed' });
    expect(refundDeduction.recordPartialRefund).not.toHaveBeenCalled();
    expect(deps.completeRequest).not.toHaveBeenCalled();
  });

  it('결제사가 취소한 결제의 키가 원장 키와 다르면 확인을 적지 않는다', async () => {
    const refundDeduction = deductionDependencies(async () => planned);
    const deps = dependencies({
      refundDeduction,
      refundProviderPayment: vi.fn(async () => partialRefund({ evidence: { providerPaymentKey: 'other-key' } })),
    });

    await expect(reconcileOrderCancellation({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps))
      .resolves.toEqual({ ok: false, code: 'provider_mismatch' });
    expect(refundDeduction.recordPartialRefund).not.toHaveBeenCalled();
    expect(deps.completeRequest).not.toHaveBeenCalled();
  });

  it('부분 취소를 받지 않는 결제는 돈이 움직이기 전에 전액 환불로 돌린 뒤 전액 취소한다', async () => {
    const refundDeduction = deductionDependencies(async () => planned);
    const refundProviderPayment = vi.fn()
      .mockResolvedValueOnce({
        attemptId: ATTEMPT_ID, provider: 'toss', outcome: 'declined',
        reasonCode: 'provider_partial_cancel_unavailable',
        evidence: { providerPaymentKey: PAYMENT_KEY, resultCode: 'partial_cancel_not_allowed' },
      } satisfies RefundOutcome)
      .mockResolvedValueOnce(approvedRefund());
    const deps = dependencies({ refundDeduction, refundProviderPayment });

    await expect(reconcileOrderCancellation({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps))
      .resolves.toEqual({ ok: true, status: 'completed' });

    expect(refundDeduction.fallbackToFullRefund).toHaveBeenCalledWith({
      requestId: REQUEST_ID, actorId: ACTOR_ID, paymentId: 'payment-1',
    });
    expect(refundProviderPayment).toHaveBeenNthCalledWith(2, FULL_REFUND_CALL);
    expect(refundDeduction.fallbackToFullRefund.mock.invocationCallOrder[0])
      .toBeLessThan(refundProviderPayment.mock.invocationCallOrder[1]);
    expect(refundDeduction.recordPartialRefund).not.toHaveBeenCalled();
    expect(deps.completeRequest).toHaveBeenCalledWith({
      requestId: REQUEST_ID, actorId: ACTOR_ID, verifiedPaymentKeys: [PAYMENT_KEY],
    });
  });

  it('전액 환불로 돌리는 기록이 실패하면 전액 취소를 발행하지 않는다', async () => {
    const refundDeduction = deductionDependencies(async () => planned);
    refundDeduction.fallbackToFullRefund.mockRejectedValueOnce(new Error('db'));
    const refundProviderPayment = vi.fn().mockResolvedValueOnce({
      attemptId: ATTEMPT_ID, provider: 'toss', outcome: 'declined', reasonCode: 'provider_partial_cancel_unavailable',
    } satisfies RefundOutcome);
    const deps = dependencies({ refundDeduction, refundProviderPayment });

    await expect(reconcileOrderCancellation({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps))
      .resolves.toEqual({ ok: false, code: 'local_finalize_failed' });
    expect(refundProviderPayment).toHaveBeenCalledTimes(1);
    expect(deps.completeRequest).not.toHaveBeenCalled();
  });

  it('잔액이 기대와 다르면 게이트웨이 사유 그대로 결제확인필요로 남기고 전액 환불로 돌리지 않는다', async () => {
    const refundDeduction = deductionDependencies(async () => planned);
    const deps = dependencies({
      refundDeduction,
      refundProviderPayment: vi.fn(async () => ({
        attemptId: ATTEMPT_ID, provider: 'toss', outcome: 'needs_review', reasonCode: 'provider_balance_mismatch',
      } satisfies RefundOutcome)),
    });

    await expect(reconcileOrderCancellation({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps))
      .resolves.toEqual({ ok: false, code: 'provider_balance_mismatch' });
    expect(refundDeduction.fallbackToFullRefund).not.toHaveBeenCalled();
    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).toHaveBeenCalledWith({ requestId: REQUEST_ID, actorId: ACTOR_ID, code: 'provider_balance_mismatch' });
  });

  it('부분 취소 확인 기록이 실패하면 완료하지 않는다(재시도는 결제사 조회로 수렴한다)', async () => {
    const refundDeduction = deductionDependencies(async () => planned);
    refundDeduction.recordPartialRefund.mockRejectedValueOnce(new Error('db'));
    const deps = dependencies({ refundDeduction, refundProviderPayment: vi.fn(async () => partialRefund()) });

    await expect(reconcileOrderCancellation({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps))
      .resolves.toEqual({ ok: false, code: 'local_finalize_failed' });
    expect(deps.completeRequest).not.toHaveBeenCalled();
  });

  it('이미 부분 취소를 확인해 적은 결정은 다시 취소하지 않고 완료한다', async () => {
    const refundDeduction = deductionDependencies(async () => ({ ...planned, state: 'provider_confirmed' }));
    const deps = dependencies({ refundDeduction });

    await expect(reconcileOrderCancellation({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps))
      .resolves.toEqual({ ok: true, status: 'completed' });
    expect(deps.refundProviderPayment).not.toHaveBeenCalled();
    expect(deps.completeRequest).toHaveBeenCalledWith({
      requestId: REQUEST_ID, actorId: ACTOR_ID, verifiedPaymentKeys: [PAYMENT_KEY],
    });
  });

  it('결정을 읽지 못하면 결제사 호출 전에 멈춘다', async () => {
    const refundDeduction = deductionDependencies(async () => { throw new Error('db'); });
    const deps = dependencies({ refundDeduction });

    await expect(reconcileOrderCancellation({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps))
      .resolves.toEqual({ ok: false, code: 'local_state_unavailable' });
    expect(deps.refundProviderPayment).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).not.toHaveBeenCalled();
  });

  it.each([
    { name: '다른 결제', decision: { ...planned, paymentId: 'payment-x' } },
    { name: '다른 결제 금액', decision: { ...planned, paymentAmount: 33000, refundAmount: 30000 } },
  ])('결정이 이 주문의 결제와 맞지 않으면($name) 추측하지 않는다', async ({ decision }) => {
    const deps = dependencies({ refundDeduction: deductionDependencies(async () => decision) });
    await expect(reconcileOrderCancellation({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps))
      .resolves.toEqual({ ok: false, code: 'payment_evidence_invalid' });
    expect(deps.refundProviderPayment).not.toHaveBeenCalled();
  });
});

describe('parseCancellationRefundDeduction', () => {
  it('없음은 null, 모양이 맞으면 그대로, 금액 합이 어긋나면 throw', () => {
    expect(parseCancellationRefundDeduction(null)).toBeNull();
    expect(parseCancellationRefundDeduction({ claimId: REQUEST_ID, provider: 'toss', ...planned })).toEqual(planned);
    expect(() => parseCancellationRefundDeduction({ ...planned, refundAmount: 28000 })).toThrow();
    expect(() => parseCancellationRefundDeduction({ ...planned, state: 'done' })).toThrow();
    expect(() => parseCancellationRefundDeduction({ ...planned, deductionAmount: 0, refundAmount: 30000 })).toThrow();
    expect(() => parseCancellationRefundDeduction('planned')).toThrow();
  });
});

describe('기본 의존성 — 차감 결정 RPC와 게이트웨이 요청', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultMocks.request = { id: REQUEST_ID, order_id: ORDER_ID, status: 'processing' };
    defaultMocks.payments = [{ id: 'payment-1', provider: 'toss', status: 'paid', amount: 30000, payment_key: PAYMENT_KEY }];
    defaultMocks.refunds = [];
    defaultMocks.attempt = {
      id: ATTEMPT_ID, provider: 'toss', purpose: 'order', ref_id: ORDER_ID, amount: 30000, currency: 'KRW',
      idempotency_key: 'approved-order-attempt', provider_order_id: 'approved-order',
      provider_product_code: 'goods', expires_at: '2026-09-01T00:00:00.000Z',
    };
  });

  function rpcWith(deduction: unknown) {
    defaultMocks.rpc.mockImplementation(async (name: string) => ({
      data: name === 'reconcile_expired_prepared_goods_cancellation' ? 'not_applicable'
        : name === 'assert_order_cancellation_reconciliation_allowed' ? 'allowed'
          : name === 'service_order_claim_refund_deduction' ? deduction
            : name === 'service_record_order_claim_partial_refund' ? 'provider_confirmed'
              : name === 'service_fallback_order_claim_refund_deduction' ? 'not_applied' : null,
      error: null,
    }));
  }

  it('차감 결정이 있으면 차감 결정마다 다른 멱등키와 잔액 기대값으로 부분 취소하고 확인을 service RPC로 적는다', async () => {
    rpcWith({ claimId: REQUEST_ID, provider: 'toss', ...planned });
    defaultMocks.gatewayRefund.mockResolvedValue(partialRefund());

    await expect(reconcileOrderCancellation({ requestId: REQUEST_ID, actorId: ACTOR_ID }))
      .resolves.toEqual({ ok: true, status: 'completed' });

    expect(defaultMocks.gatewayRefund).toHaveBeenCalledTimes(1);
    expect(defaultMocks.gatewayRefund).toHaveBeenCalledWith({
      attempt: expect.objectContaining({ id: ATTEMPT_ID, amount: 30000 }),
      idempotencyKey: `refund:${ATTEMPT_ID}:deduction:${REQUEST_ID}`,
      amount: 27000,
      reason: 'ICONS 반품 환불(반품배송비 차감)',
      providerPaymentKey: PAYMENT_KEY,
      partial: { expectedBalanceBefore: 30000 },
    });
    expect(defaultMocks.rpc).toHaveBeenCalledWith('service_record_order_claim_partial_refund', {
      p_request_id: REQUEST_ID, p_payment_id: 'payment-1', p_refunded_amount: 27000,
      p_provider_payment_key: PAYMENT_KEY, p_provider_transaction_key: 'TX-PARTIAL-1', p_actor_id: ACTOR_ID,
    });
    expect(defaultMocks.rpc).toHaveBeenCalledWith('complete_order_cancellation_request', {
      p_request_id: REQUEST_ID, p_actor_id: ACTOR_ID, p_provider_payment_keys: [PAYMENT_KEY],
    });
  });

  it('부분 취소를 받지 않으면 전액 환불 기록 뒤 전액 취소 키(refund:{attemptId})로 전액 취소한다', async () => {
    rpcWith({ claimId: REQUEST_ID, provider: 'toss', ...planned });
    defaultMocks.gatewayRefund
      .mockResolvedValueOnce({ attemptId: ATTEMPT_ID, provider: 'toss', outcome: 'declined', reasonCode: 'provider_partial_cancel_unavailable' })
      .mockResolvedValueOnce(approvedRefund());

    await expect(reconcileOrderCancellation({ requestId: REQUEST_ID, actorId: ACTOR_ID }))
      .resolves.toEqual({ ok: true, status: 'completed' });

    expect(defaultMocks.rpc).toHaveBeenCalledWith('service_fallback_order_claim_refund_deduction', {
      p_request_id: REQUEST_ID, p_payment_id: 'payment-1', p_actor_id: ACTOR_ID,
    });
    expect(defaultMocks.gatewayRefund).toHaveBeenNthCalledWith(2, {
      attempt: expect.objectContaining({ id: ATTEMPT_ID }),
      idempotencyKey: `refund:${ATTEMPT_ID}`,
      amount: 30000,
      reason: 'ICONS 주문 취소',
      providerPaymentKey: PAYMENT_KEY,
    });
  });

  it('정기배송(billing) 결제의 부분 취소 거절도 돈이 움직이지 않은 채 전액 환불로 돌아간다', async () => {
    rpcWith({ claimId: REQUEST_ID, provider: 'toss', ...planned });
    // attempt 래퍼가 billing 바인딩 결제의 partial 요청에 돌려주는 결과(증거 없음)
    defaultMocks.gatewayRefund
      .mockResolvedValueOnce({ attemptId: ATTEMPT_ID, provider: 'toss', outcome: 'declined', reasonCode: 'provider_partial_cancel_unavailable' })
      .mockResolvedValueOnce(approvedRefund());

    await expect(reconcileOrderCancellation({ requestId: REQUEST_ID, actorId: ACTOR_ID }))
      .resolves.toEqual({ ok: true, status: 'completed' });
    expect(defaultMocks.rpc).not.toHaveBeenCalledWith('service_record_order_claim_partial_refund', expect.anything());
    expect(defaultMocks.rpc).toHaveBeenCalledWith('service_fallback_order_claim_refund_deduction', expect.anything());
  });

  it('차감 결정 응답의 모양이 어긋나면 결제사 호출 전에 멈춘다', async () => {
    rpcWith({ ...planned, refundAmount: 28000 });

    await expect(reconcileOrderCancellation({ requestId: REQUEST_ID, actorId: ACTOR_ID }))
      .resolves.toEqual({ ok: false, code: 'local_state_unavailable' });
    expect(defaultMocks.gatewayRefund).not.toHaveBeenCalled();
  });
});
