import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefundOutcome } from '../payments/gateway';
import {
  reconcileOrderCancellation,
  type CancellationReconciliationContext,
  type CancellationReconciliationDependencies,
} from './cancellation-orchestrator.server';

const defaultMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  gatewayRefund: vi.fn(),
  request: null as Record<string, unknown> | null,
  payments: [] as Array<Record<string, unknown>>,
  refunds: [] as Array<Record<string, unknown>>,
  attempt: null as Record<string, unknown> | null,
  filters: [] as Array<{ table: string; column: string; value: unknown }>,
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
        eq: vi.fn((column: string, value: unknown) => {
          defaultMocks.filters.push({ table, column, value });
          return query;
        }),
        in: vi.fn((column: string, value: unknown) => {
          defaultMocks.filters.push({ table, column, value });
          return query;
        }),
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
const PAYMENT_KEY = 'payment-secret-key';

function approvedRefund(overrides: Partial<RefundOutcome> = {}): RefundOutcome {
  return {
    attemptId: '44444444-4444-4444-8444-444444444444',
    provider: 'toss',
    outcome: 'approved',
    reasonCode: 'provider_cancel_confirmed',
    refundedAmount: 42000,
    // 게이트웨이는 취소를 검증한 fresh 조회의 paymentKey를 증거로 싣는다 —
    // 오케스트레이터가 로컬 원장 키와 대조하는 값이다.
    evidence: { providerPaymentKey: PAYMENT_KEY },
    ...overrides,
  };
}

function context(
  override: Partial<CancellationReconciliationContext> = {},
): CancellationReconciliationContext {
  return {
    requestId: REQUEST_ID,
    orderId: ORDER_ID,
    status: 'processing',
    payments: [{
      id: 'payment-1',
      provider: 'toss',
      status: 'paid',
      amount: 42000,
      paymentKey: PAYMENT_KEY,
      bankTransferRefundFiled: false,
    }],
    ...override,
  };
}

function dependencies(
  override: Partial<CancellationReconciliationDependencies> = {},
): CancellationReconciliationDependencies {
  return {
    loadContext: vi.fn(async () => context()),
    preflightReconciliation: vi.fn(async () => 'allowed' as const),
    reconcileExpiredPreparedGoods: vi.fn(async () => 'not_applicable' as const),
    refundTossPayment: vi.fn(async () => approvedRefund()),
    completeRequest: vi.fn(async () => undefined),
    markNeedsReview: vi.fn(async () => undefined),
    ...override,
  };
}

describe('reconcileOrderCancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultMocks.filters = [];
    defaultMocks.request = {
      id: REQUEST_ID,
      order_id: ORDER_ID,
      status: 'processing',
    };
    defaultMocks.payments = [{
      id: 'payment-1',
      provider: 'toss',
      status: 'paid',
      amount: 42000,
      payment_key: PAYMENT_KEY,
    }];
    defaultMocks.refunds = [];
    defaultMocks.attempt = null;
    defaultMocks.gatewayRefund.mockResolvedValue(approvedRefund());
    defaultMocks.rpc.mockImplementation(async (name: string) => ({
      data: name === 'reconcile_expired_prepared_goods_cancellation'
        ? 'not_applicable'
        : name === 'assert_order_cancellation_reconciliation_allowed' ? 'allowed' : null,
      error: null,
    }));
  });

  it('default 조회는 카드 provider 원장을 읽고, 게이트웨이가 닫혀 있으면 수동 검토로 승격한다', async () => {
    // TOSS env가 없는 테스트 환경 — default refundTossPayment는 attempt 부재로
    // throw하고, 오케스트레이터는 추측 종결 없이 수동 검토로 넘긴다.
    await expect(reconcileOrderCancellation({
      requestId: REQUEST_ID,
      actorId: ACTOR_ID,
    })).resolves.toEqual({ ok: false, code: 'provider_unavailable' });

    expect(defaultMocks.filters).toContainEqual({
      table: 'payments',
      column: 'provider',
      value: ['toss', 'korpay'],
    });
    expect(defaultMocks.rpc).toHaveBeenCalledWith(
      'mark_order_cancellation_needs_review',
      expect.objectContaining({ p_error_code: 'provider_unavailable' }),
    );
  });

  it('카드 원장 행이 없는 주문(무통장 등)은 provider 증거 없이 로컬 완료한다', async () => {
    defaultMocks.payments = [];

    await expect(reconcileOrderCancellation({
      requestId: REQUEST_ID,
      actorId: ACTOR_ID,
    })).resolves.toEqual({ ok: true, status: 'completed' });

    expect(defaultMocks.rpc).toHaveBeenCalledWith(
      'complete_order_cancellation_request',
      expect.objectContaining({ p_provider_payment_keys: [] }),
    );
  });

  it('이미 완료된 요청은 DB 완료 처리를 다시 호출하지 않는다', async () => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({ status: 'completed' })),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: true, status: 'already_completed' });

    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).not.toHaveBeenCalled();
    expect(deps.preflightReconciliation).not.toHaveBeenCalled();
  });

  it('processing 이외 상태는 상태 전이 없이 거절한다', async () => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({ status: 'requested' })),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: false, code: 'request_not_ready' });

    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).not.toHaveBeenCalled();
  });

  it('발주확인 또는 미회수로 DB가 거절하면 PG와 로컬 완료를 시작하지 않는다', async () => {
    const deps = dependencies({
      preflightReconciliation: vi.fn(async () => 'not_allowed' as const),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: false, code: 'request_not_ready' });

    expect(deps.refundTossPayment).not.toHaveBeenCalled();
    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.reconcileExpiredPreparedGoods).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).not.toHaveBeenCalled();
  });

  it('사전 검사 통신 오류에서는 기존 원장을 바꾸거나 환불을 추측 실행하지 않는다', async () => {
    const deps = dependencies({
      preflightReconciliation: vi.fn(async () => {
        throw new Error(`database detail ${PAYMENT_KEY}`);
      }),
    });

    const result = await reconcileOrderCancellation({ requestId: REQUEST_ID, actorId: ACTOR_ID }, deps);

    expect(result).toEqual({ ok: false, code: 'local_state_unavailable' });
    expect(JSON.stringify(result)).not.toContain(PAYMENT_KEY);
    expect(deps.refundTossPayment).not.toHaveBeenCalled();
    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.reconcileExpiredPreparedGoods).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).not.toHaveBeenCalled();
  });

  it('조회 뒤 다른 실행이 완료한 요청은 사전 검사 결과로 멱등 종료한다', async () => {
    const deps = dependencies({
      preflightReconciliation: vi.fn(async () => 'completed' as const),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID }, deps,
    )).resolves.toEqual({ ok: true, status: 'already_completed' });

    expect(deps.refundTossPayment).not.toHaveBeenCalled();
    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.reconcileExpiredPreparedGoods).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).not.toHaveBeenCalled();
  });

  it.each([
    'claim_collections_incomplete',
    'cancellation_request_not_processing',
    'claim_on_hold',
    'order_not_cancelable',
    'staff required',
    'cancellation_request_not_found',
  ])('service 사전 검사 거절(%s)은 PG와 완료 RPC에 도달하지 않는다', async (message) => {
    defaultMocks.rpc.mockResolvedValue({ data: null, error: { message } });

    await expect(reconcileOrderCancellation({
      requestId: REQUEST_ID, actorId: ACTOR_ID,
    })).resolves.toEqual({ ok: false, code: 'request_not_ready' });

    expect(defaultMocks.rpc.mock.calls).toEqual([[
      'assert_order_cancellation_reconciliation_allowed',
      { p_request_id: REQUEST_ID, p_actor_id: ACTOR_ID },
    ]]);
    expect(defaultMocks.gatewayRefund).not.toHaveBeenCalled();
    expect(defaultMocks.filters.some((filter) => filter.table === 'payment_attempts')).toBe(false);
  });

  it.each([
    { data: null, error: { message: `connection detail ${PAYMENT_KEY}` } },
    { data: null, error: null },
    { data: true, error: null },
    { data: 'allowed ', error: null },
  ])('service 사전 검사 오류·계약 불일치는 안전하게 중단한다 (%j)', async (response) => {
    defaultMocks.rpc.mockResolvedValue(response);

    const result = await reconcileOrderCancellation({ requestId: REQUEST_ID, actorId: ACTOR_ID });

    expect(result).toEqual({ ok: false, code: 'local_state_unavailable' });
    expect(JSON.stringify(result)).not.toContain(PAYMENT_KEY);
    expect(defaultMocks.rpc.mock.calls.map(([name]) => name)).toEqual([
      'assert_order_cancellation_reconciliation_allowed',
    ]);
    expect(defaultMocks.gatewayRefund).not.toHaveBeenCalled();
  });

  it('service 사전 검사를 통과한 승인 건은 기존 PG 전액 환불·완료 계약을 유지한다', async () => {
    defaultMocks.attempt = {
      id: '44444444-4444-4444-8444-444444444444',
      provider: 'toss', purpose: 'order', ref_id: ORDER_ID, amount: 42000, currency: 'KRW',
      idempotency_key: 'approved-order-attempt', provider_order_id: 'approved-order',
      provider_product_code: 'goods', expires_at: '2026-09-01T00:00:00.000Z',
    };

    await expect(reconcileOrderCancellation({
      requestId: REQUEST_ID, actorId: ACTOR_ID,
    })).resolves.toEqual({ ok: true, status: 'completed' });

    expect(defaultMocks.gatewayRefund).toHaveBeenCalledWith(expect.objectContaining({ amount: 42000 }));
    expect(defaultMocks.rpc).toHaveBeenCalledWith('complete_order_cancellation_request', {
      p_request_id: REQUEST_ID, p_actor_id: ACTOR_ID, p_provider_payment_keys: [PAYMENT_KEY],
    });
  });

  it('fresh prepared 세션은 in_progress로 유지하고 완료나 needs_review를 호출하지 않는다', async () => {
    const deps = dependencies({
      reconcileExpiredPreparedGoods: vi.fn(async () => 'in_progress' as const),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: true, status: 'in_progress' });

    expect(deps.refundTossPayment).not.toHaveBeenCalled();
    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).not.toHaveBeenCalled();
  });

  it('expired prepared 세션을 원자 완료하면 잔여 결제 검사를 건너뛴다', async () => {
    const deps = dependencies({
      reconcileExpiredPreparedGoods: vi.fn(async () => 'completed' as const),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: true, status: 'completed' });

    expect(deps.refundTossPayment).not.toHaveBeenCalled();
    expect(deps.completeRequest).not.toHaveBeenCalled();
  });

  it('needs_review 요청이 prepared 대상이 아니면 processing 복원 없이는 진행하지 않는다', async () => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({ status: 'needs_review' })),
      reconcileExpiredPreparedGoods: vi.fn(async () => 'not_applicable' as const),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: false, code: 'request_not_ready' });

    expect(deps.refundTossPayment).not.toHaveBeenCalled();
    expect(deps.completeRequest).not.toHaveBeenCalled();
  });

  it('toss 유상 캡처는 자동 취소가 검증되면 검증 키로 완료한다', async () => {
    const deps = dependencies();

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: true, status: 'completed' });

    expect(deps.refundTossPayment).toHaveBeenCalledWith({
      paymentId: 'payment-1',
      amount: 42000,
      reason: 'ICONS 주문 취소',
    });
    expect(deps.completeRequest).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      actorId: ACTOR_ID,
      verifiedPaymentKeys: [PAYMENT_KEY],
    });
    expect(deps.markNeedsReview).not.toHaveBeenCalled();
  });

  it('로컬 terminal(refunded) 결제도 fresh 조회 수렴(이미 전액 취소)으로 완료한다', async () => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({
        payments: [{
          id: 'payment-1',
          provider: 'toss',
          status: 'refunded',
          amount: 42000,
          paymentKey: PAYMENT_KEY,
          bankTransferRefundFiled: false,
        }],
      })),
      refundTossPayment: vi.fn(async () => approvedRefund({
        reasonCode: 'provider_already_fully_canceled',
      })),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: true, status: 'completed' });
  });

  it('korpay 유상 캡처는 자동 취소 없이 수동 검토(수동 복구 seam 경로)로 승격한다', async () => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({
        payments: [{
          id: 'payment-1',
          provider: 'korpay',
          status: 'paid',
          amount: 42000,
          paymentKey: PAYMENT_KEY,
          bankTransferRefundFiled: false,
        }],
      })),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: false, code: 'provider_unavailable' });

    expect(deps.refundTossPayment).not.toHaveBeenCalled();
    expect(deps.completeRequest).not.toHaveBeenCalled();
  });

  it('취소 거절(needs_review)은 provider_cancel_failed로, 모호(unknown)는 provider_unavailable로 격리한다', async () => {
    const rejected = dependencies({
      refundTossPayment: vi.fn(async () => approvedRefund({
        outcome: 'needs_review',
        reasonCode: 'provider_cancel_rejected',
        refundedAmount: undefined,
      })),
    });
    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      rejected,
    )).resolves.toEqual({ ok: false, code: 'provider_cancel_failed' });
    expect(rejected.completeRequest).not.toHaveBeenCalled();

    const ambiguous = dependencies({
      refundTossPayment: vi.fn(async () => approvedRefund({
        outcome: 'unknown',
        reasonCode: 'provider_cancel_ambiguous',
        refundedAmount: undefined,
      })),
    });
    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      ambiguous,
    )).resolves.toEqual({ ok: false, code: 'provider_unavailable' });
    expect(ambiguous.completeRequest).not.toHaveBeenCalled();
  });

  it('approved여도 provider 증거 키가 로컬 원장 키와 다르면 완료 RPC를 부르지 않는다', async () => {
    const deps = dependencies({
      refundTossPayment: vi.fn(async () => approvedRefund({
        evidence: { providerPaymentKey: 'other-provider-payment-key' },
      })),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: false, code: 'provider_mismatch' });

    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      actorId: ACTOR_ID,
      code: 'provider_mismatch',
    });
  });

  it('approved에 provider 증거 키가 아예 없으면 일치의 근거가 없으므로 격리한다', async () => {
    for (const evidence of [undefined, { resultCode: 'CANCELED' }]) {
      const deps = dependencies({
        refundTossPayment: vi.fn(async () => approvedRefund({ evidence })),
      });

      await expect(reconcileOrderCancellation(
        { requestId: REQUEST_ID, actorId: ACTOR_ID },
        deps,
      )).resolves.toEqual({ ok: false, code: 'provider_mismatch' });

      expect(deps.completeRequest).not.toHaveBeenCalled();
    }
  });

  it('계좌 송금으로 접수된 toss 결제는 취소 API를 발행하지 않고 격리한다', async () => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({
        payments: [{
          id: 'payment-1',
          provider: 'toss',
          status: 'paid',
          amount: 42000,
          paymentKey: PAYMENT_KEY,
          bankTransferRefundFiled: true,
        }],
      })),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: false, code: 'bank_transfer_refund_filed' });

    expect(deps.refundTossPayment).not.toHaveBeenCalled();
    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      actorId: ACTOR_ID,
      code: 'bank_transfer_refund_filed',
    });
  });

  it('default 조회는 환불 원장 수단을 함께 읽어 계좌 송금 접수를 컨텍스트에 싣는다', async () => {
    defaultMocks.refunds = [{ payment_id: 'payment-1', method: 'bank_transfer' }];

    await expect(reconcileOrderCancellation({
      requestId: REQUEST_ID,
      actorId: ACTOR_ID,
    })).resolves.toEqual({ ok: false, code: 'bank_transfer_refund_filed' });

    expect(defaultMocks.filters).toContainEqual({
      table: 'refunds',
      column: 'payment_id',
      value: ['payment-1'],
    });
    expect(defaultMocks.rpc).toHaveBeenCalledWith(
      'mark_order_cancellation_needs_review',
      expect.objectContaining({ p_error_code: 'bank_transfer_refund_filed' }),
    );
    expect(defaultMocks.rpc).not.toHaveBeenCalledWith(
      'complete_order_cancellation_request',
      expect.anything(),
    );
  });

  it('환불 원장이 pg_cancel이거나 수단 미기록이면 자동 취소 경로를 막지 않는다', async () => {
    for (const refunds of [
      [],
      [{ payment_id: 'payment-1', method: null }],
      [{ payment_id: 'payment-1', method: 'pg_cancel' }],
      // 다른 결제의 계좌 송금 기록은 이 결제를 막지 않는다.
      [{ payment_id: 'payment-2', method: 'bank_transfer' }],
    ]) {
      vi.clearAllMocks();
      defaultMocks.rpc.mockImplementation(async (name: string) => ({
        data: name === 'reconcile_expired_prepared_goods_cancellation'
          ? 'not_applicable'
          : name === 'assert_order_cancellation_reconciliation_allowed' ? 'allowed' : null,
        error: null,
      }));
      defaultMocks.refunds = refunds;

      // TOSS env가 없어 default refundTossPayment는 throw한다 — 게이트를 통과해
      // 취소 발행까지 갔다는 뜻이다(bank_transfer_refund_filed가 아니다).
      await expect(reconcileOrderCancellation({
        requestId: REQUEST_ID,
        actorId: ACTOR_ID,
      })).resolves.toEqual({ ok: false, code: 'provider_unavailable' });
    }
  });

  it('approved여도 환불 금액이 캡처 금액과 다르면 완료하지 않는다', async () => {
    const deps = dependencies({
      refundTossPayment: vi.fn(async () => approvedRefund({ refundedAmount: 41000 })),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: false, code: 'provider_cancel_failed' });

    expect(deps.completeRequest).not.toHaveBeenCalled();
  });

  it('refund 경로 자체가 throw하면(attempt 부재 등) 수동 검토로 승격하고 상세를 노출하지 않는다', async () => {
    const deps = dependencies({
      refundTossPayment: vi.fn(async () => {
        throw new Error(`private detail ${PAYMENT_KEY}`);
      }),
    });

    const result = await reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    );

    expect(result).toEqual({ ok: false, code: 'provider_unavailable' });
    expect(JSON.stringify(result)).not.toContain(PAYMENT_KEY);
  });

  it('로컬 terminal 결제에 payment key가 없으면 증거 불량으로 전환한다', async () => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({
        payments: [{
          id: 'payment-1',
          provider: 'toss',
          status: 'canceled',
          amount: 42000,
          paymentKey: null,
          bankTransferRefundFiled: false,
        }],
      })),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: false, code: 'payment_evidence_invalid' });

    expect(deps.refundTossPayment).not.toHaveBeenCalled();
    expect(deps.completeRequest).not.toHaveBeenCalled();
  });

  it('failed 결제만 남은 주문은 no-capture terminal로 로컬 완료한다', async () => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({
        payments: [
          { id: 'payment-1', provider: 'toss', status: 'failed', amount: 39000, paymentKey: null, bankTransferRefundFiled: false },
        ],
      })),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: true, status: 'completed' });

    expect(deps.refundTossPayment).not.toHaveBeenCalled();
    expect(deps.completeRequest).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      actorId: ACTOR_ID,
      verifiedPaymentKeys: [],
    });
  });

  it('failed 결제와 toss 캡처가 섞이면 캡처만 자동 취소하고 완료한다', async () => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({
        payments: [
          { id: 'payment-1', provider: 'toss', status: 'failed', amount: 39000, paymentKey: null, bankTransferRefundFiled: false },
          { id: 'payment-2', provider: 'toss', status: 'paid', amount: 42000, paymentKey: PAYMENT_KEY, bankTransferRefundFiled: false },
        ],
      })),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: true, status: 'completed' });

    expect(deps.refundTossPayment).toHaveBeenCalledTimes(1);
    expect(deps.refundTossPayment).toHaveBeenCalledWith({
      paymentId: 'payment-2',
      amount: 42000,
      reason: 'ICONS 주문 취소',
    });
    expect(deps.completeRequest).toHaveBeenCalledWith(
      expect.objectContaining({ verifiedPaymentKeys: [PAYMENT_KEY] }),
    );
  });

  it('로컬 완료 RPC 실패는 needs_review로 남기고 안전한 코드만 반환한다', async () => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({ payments: [] })),
      completeRequest: vi.fn(async () => {
        throw new Error(`failed for ${PAYMENT_KEY}`);
      }),
    });

    const result = await reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    );

    expect(result).toEqual({ ok: false, code: 'local_finalize_failed' });
    expect(JSON.stringify(result)).not.toContain(PAYMENT_KEY);
    expect(deps.markNeedsReview).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      actorId: ACTOR_ID,
      code: 'local_finalize_failed',
    });
  });
});
