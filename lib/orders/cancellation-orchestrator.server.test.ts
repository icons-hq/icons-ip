import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  reconcileOrderCancellation,
  type CancellationReconciliationContext,
  type CancellationReconciliationDependencies,
} from './cancellation-orchestrator.server';

const defaultMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  request: null as Record<string, unknown> | null,
  payments: [] as Array<Record<string, unknown>>,
  filters: [] as Array<{ table: string; column: string; value: unknown }>,
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
        maybeSingle: vi.fn(async () => ({ data: defaultMocks.request, error: null })),
        order: vi.fn(async () => ({ data: defaultMocks.payments, error: null })),
      };
      return query;
    },
  }),
}));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';
const PAYMENT_KEY = 'payment-secret-key';

function context(
  override: Partial<CancellationReconciliationContext> = {},
): CancellationReconciliationContext {
  return {
    requestId: REQUEST_ID,
    orderId: ORDER_ID,
    status: 'processing',
    payments: [{
      id: 'payment-1',
      status: 'paid',
      amount: 42000,
      paymentKey: PAYMENT_KEY,
    }],
    ...override,
  };
}

function dependencies(
  override: Partial<CancellationReconciliationDependencies> = {},
): CancellationReconciliationDependencies {
  return {
    loadContext: vi.fn(async () => context()),
    reconcileExpiredPreparedGoods: vi.fn(async () => 'not_applicable' as const),
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
    defaultMocks.rpc.mockImplementation(async (name: string) => ({
      data: name === 'reconcile_expired_prepared_goods_cancellation'
        ? 'not_applicable'
        : null,
      error: null,
    }));
  });

  it('default 조회는 legacy Toss 행만 읽고, 잔존 유상 캡처는 수동 검토로 승격한다', async () => {
    await expect(reconcileOrderCancellation({
      requestId: REQUEST_ID,
      actorId: ACTOR_ID,
    })).resolves.toEqual({ ok: false, code: 'provider_unavailable' });

    expect(defaultMocks.filters).toContainEqual({
      table: 'payments',
      column: 'provider',
      value: 'toss',
    });
    expect(defaultMocks.rpc).toHaveBeenCalledWith(
      'mark_order_cancellation_needs_review',
      expect.objectContaining({ p_error_code: 'provider_unavailable' }),
    );
  });

  it('legacy 원장 행이 없는 주문(Korpay 등)은 provider 증거 없이 로컬 완료한다', async () => {
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

  it('fresh prepared Korpay 세션은 in_progress로 유지하고 완료나 needs_review를 호출하지 않는다', async () => {
    const deps = dependencies({
      reconcileExpiredPreparedGoods: vi.fn(async () => 'in_progress' as const),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: true, status: 'in_progress' });

    expect(deps.reconcileExpiredPreparedGoods).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      actorId: ACTOR_ID,
    });
    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).not.toHaveBeenCalled();
  });

  it('expired prepared Korpay 세션을 원자 완료하면 잔여 결제 검사를 건너뛴다', async () => {
    const deps = dependencies({
      reconcileExpiredPreparedGoods: vi.fn(async () => 'completed' as const),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: true, status: 'completed' });

    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).not.toHaveBeenCalled();
  });

  it('needs_review prepared Korpay 요청도 전용 no-capture 경로에서만 재확인한다', async () => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({ status: 'needs_review' })),
      reconcileExpiredPreparedGoods: vi.fn(async () => 'in_progress' as const),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: true, status: 'in_progress' });

    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).not.toHaveBeenCalled();
  });

  it('needs_review 요청이 prepared Korpay 대상이 아니면 processing 복원 없이는 진행하지 않는다', async () => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({ status: 'needs_review' })),
      reconcileExpiredPreparedGoods: vi.fn(async () => 'not_applicable' as const),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: false, code: 'request_not_ready' });

    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).not.toHaveBeenCalled();
  });

  it('prepared Korpay 상태 조회 실패는 needs_review로 확장하지 않는다', async () => {
    const deps = dependencies({
      reconcileExpiredPreparedGoods: vi.fn(async () => {
        throw new Error('private db detail');
      }),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: false, code: 'local_state_unavailable' });

    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).not.toHaveBeenCalled();
  });

  it('유상 캡처가 남아 있으면 완료하지 않고 수동 검토로 승격하며 결제 식별자를 반환하지 않는다', async () => {
    const deps = dependencies();

    const result = await reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    );

    expect(result).toEqual({ ok: false, code: 'provider_unavailable' });
    expect(JSON.stringify(result)).not.toContain(PAYMENT_KEY);
    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      actorId: ACTOR_ID,
      code: 'provider_unavailable',
    });
  });

  it('로컬 terminal(refunded) 결제도 원격 재검증이 불가능하므로 수동 검토로 승격한다', async () => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({
        payments: [{
          id: 'payment-1',
          status: 'refunded',
          amount: 42000,
          paymentKey: PAYMENT_KEY,
        }],
      })),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: false, code: 'provider_unavailable' });

    expect(deps.completeRequest).not.toHaveBeenCalled();
  });

  it('로컬 terminal 결제에 payment key가 없으면 증거 불량으로 전환한다', async () => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({
        payments: [{
          id: 'payment-1',
          status: 'canceled',
          amount: 42000,
          paymentKey: null,
        }],
      })),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: false, code: 'payment_evidence_invalid' });

    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      actorId: ACTOR_ID,
      code: 'payment_evidence_invalid',
    });
  });

  it('failed 결제만 남은 주문은 no-capture terminal로 로컬 완료한다', async () => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({
        payments: [
          { id: 'payment-1', status: 'failed', amount: 39000, paymentKey: null },
        ],
      })),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: true, status: 'completed' });

    expect(deps.markNeedsReview).not.toHaveBeenCalled();
    expect(deps.completeRequest).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      actorId: ACTOR_ID,
      verifiedPaymentKeys: [],
    });
  });

  it('failed 결제와 유상 캡처가 섞이면 캡처 쪽 판정(수동 검토)이 우선한다', async () => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({
        payments: [
          { id: 'payment-1', status: 'failed', amount: 39000, paymentKey: null },
          { id: 'payment-2', status: 'paid', amount: 42000, paymentKey: PAYMENT_KEY },
        ],
      })),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: false, code: 'provider_unavailable' });

    expect(deps.completeRequest).not.toHaveBeenCalled();
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
