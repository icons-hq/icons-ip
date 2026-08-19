import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  reconcileOrderCancellation,
  type CancellationReconciliationContext,
  type CancellationReconciliationDependencies,
} from './cancellation-orchestrator.server';

const defaultMocks = vi.hoisted(() => ({
  fetchPayment: vi.fn(),
  cancelPayment: vi.fn(),
  rpc: vi.fn(),
  request: null as Record<string, unknown> | null,
  payments: [] as Array<Record<string, unknown>>,
  filters: [] as Array<{ table: string; column: string; value: unknown }>,
}));

vi.mock('../payments/toss-api', () => ({
  fetchTossPayment: defaultMocks.fetchPayment,
  cancelTossPayment: defaultMocks.cancelPayment,
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

function providerPayment(input: {
  paymentKey?: string;
  orderId?: string;
  amount?: number;
  state: 'uncanceled' | 'fully_canceled' | 'partial';
}) {
  const amount = input.amount ?? 42000;
  const shared = {
    paymentKey: input.paymentKey ?? PAYMENT_KEY,
    orderId: input.orderId ?? `order_${ORDER_ID}`,
    totalAmount: amount,
    type: 'NORMAL',
    currency: 'KRW',
    method: '카드',
  };

  if (input.state === 'fully_canceled') {
    return {
      ...shared,
      status: 'CANCELED',
      balanceAmount: 0,
      cancels: [{ cancelAmount: amount, cancelStatus: 'DONE' }],
    };
  }
  if (input.state === 'partial') {
    return {
      ...shared,
      status: 'PARTIAL_CANCELED',
      balanceAmount: amount / 2,
      cancels: [{ cancelAmount: amount / 2, cancelStatus: 'DONE' }],
    };
  }
  return {
    ...shared,
    status: 'DONE',
    balanceAmount: amount,
    cancels: null,
  };
}

function dependencies(
  override: Partial<CancellationReconciliationDependencies> = {},
): CancellationReconciliationDependencies {
  return {
    loadContext: vi.fn(async () => context()),
    reconcileExpiredPreparedGoods: vi.fn(async () => 'not_applicable' as const),
    fetchPayment: vi.fn(async () => ({
      ok: true as const,
      body: providerPayment({ state: 'fully_canceled' }),
    })),
    cancelPayment: vi.fn(async () => ({
      ok: true as const,
      body: providerPayment({ state: 'fully_canceled' }),
    })),
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
    defaultMocks.fetchPayment.mockResolvedValue({
      ok: true,
      body: providerPayment({ state: 'fully_canceled' }),
    });
    defaultMocks.rpc.mockImplementation(async (name: string) => ({
      data: name === 'reconcile_expired_prepared_goods_cancellation'
        ? 'not_applicable'
        : null,
      error: null,
    }));
  });

  it('default 취소 조회는 Toss 행만 읽어 다른 provider key를 Toss API에 전달하지 않는다', async () => {
    await expect(reconcileOrderCancellation({
      requestId: REQUEST_ID,
      actorId: ACTOR_ID,
    })).resolves.toEqual({ ok: true, status: 'completed' });

    expect(defaultMocks.filters).toContainEqual({
      table: 'payments',
      column: 'provider',
      value: 'toss',
    });
  });

  it('이미 완료된 요청은 provider와 DB 완료 처리를 다시 호출하지 않는다', async () => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({ status: 'completed' })),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: true, status: 'already_completed' });

    expect(deps.fetchPayment).not.toHaveBeenCalled();
    expect(deps.cancelPayment).not.toHaveBeenCalled();
    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).not.toHaveBeenCalled();
  });

  it('processing 이외 상태는 provider 호출 없이 거절한다', async () => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({ status: 'requested' })),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: false, code: 'request_not_ready' });

    expect(deps.fetchPayment).not.toHaveBeenCalled();
    expect(deps.cancelPayment).not.toHaveBeenCalled();
  });

  it('fresh prepared Korpay 세션은 in_progress로 유지하고 Toss 완료나 needs_review를 호출하지 않는다', async () => {
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
    expect(deps.fetchPayment).not.toHaveBeenCalled();
    expect(deps.cancelPayment).not.toHaveBeenCalled();
    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).not.toHaveBeenCalled();
  });

  it('expired prepared Korpay 세션을 원자 완료하면 Toss provider 경로를 건너뛴다', async () => {
    const deps = dependencies({
      reconcileExpiredPreparedGoods: vi.fn(async () => 'completed' as const),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: true, status: 'completed' });

    expect(deps.fetchPayment).not.toHaveBeenCalled();
    expect(deps.cancelPayment).not.toHaveBeenCalled();
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

    expect(deps.fetchPayment).not.toHaveBeenCalled();
    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).not.toHaveBeenCalled();
  });

  it('needs_review 요청이 prepared Korpay 대상이 아니면 legacy Toss provider를 호출하지 않는다', async () => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({ status: 'needs_review' })),
      reconcileExpiredPreparedGoods: vi.fn(async () => 'not_applicable' as const),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: false, code: 'request_not_ready' });

    expect(deps.fetchPayment).not.toHaveBeenCalled();
    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).not.toHaveBeenCalled();
  });

  it('prepared Korpay 상태 조회 실패는 Toss empty-payment fallback이나 needs_review로 확장하지 않는다', async () => {
    const deps = dependencies({
      reconcileExpiredPreparedGoods: vi.fn(async () => {
        throw new Error('private db detail');
      }),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: false, code: 'local_state_unavailable' });

    expect(deps.fetchPayment).not.toHaveBeenCalled();
    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).not.toHaveBeenCalled();
  });

  it('fresh GET이 이미 전액 취소를 증명하면 POST 없이 로컬 요청을 완료한다', async () => {
    const deps = dependencies();

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: true, status: 'completed' });

    expect(deps.fetchPayment).toHaveBeenCalledWith(PAYMENT_KEY);
    expect(deps.cancelPayment).not.toHaveBeenCalled();
    expect(deps.completeRequest).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      actorId: ACTOR_ID,
      verifiedPaymentKeys: [PAYMENT_KEY],
    });
  });

  it('로컬 terminal 결제도 fresh GET의 전액 취소 증거를 요구한다', async () => {
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
    )).resolves.toEqual({ ok: true, status: 'completed' });

    expect(deps.fetchPayment).toHaveBeenCalledWith(PAYMENT_KEY);
    expect(deps.cancelPayment).not.toHaveBeenCalled();
    expect(deps.completeRequest).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      actorId: ACTOR_ID,
      verifiedPaymentKeys: [PAYMENT_KEY],
    });
  });

  it('로컬 terminal 결제에 payment key가 없으면 운영 검토로 전환한다', async () => {
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

    expect(deps.fetchPayment).not.toHaveBeenCalled();
    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      actorId: ACTOR_ID,
      code: 'payment_evidence_invalid',
    });
  });

  it('과거 failed 결제는 no-capture terminal로 건너뛰고 provider 증거에 포함하지 않는다', async () => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({
        payments: [
          { id: 'payment-1', status: 'failed', amount: 39000, paymentKey: null },
          { id: 'payment-2', status: 'refunded', amount: 42000, paymentKey: PAYMENT_KEY },
        ],
      })),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: true, status: 'completed' });

    expect(deps.fetchPayment).toHaveBeenCalledWith(PAYMENT_KEY);
    expect(deps.cancelPayment).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).not.toHaveBeenCalled();
    expect(deps.completeRequest).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      actorId: ACTOR_ID,
      verifiedPaymentKeys: [PAYMENT_KEY],
    });
  });

  it('미취소 결제는 고정 멱등키로 전액 취소한 뒤 POST 응답과 무관하게 다시 GET한다', async () => {
    const fetchPayment = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, body: providerPayment({ state: 'uncanceled' }) })
      .mockResolvedValueOnce({ ok: true as const, body: providerPayment({ state: 'fully_canceled' }) });
    const deps = dependencies({ fetchPayment });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: true, status: 'completed' });

    expect(deps.cancelPayment).toHaveBeenCalledWith({
      paymentKey: PAYMENT_KEY,
      cancelReason: '관리자 승인 주문 취소',
      idempotencyKey: `cancel-${PAYMENT_KEY}`,
    });
    expect(fetchPayment).toHaveBeenCalledTimes(2);
    expect(deps.completeRequest).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['timeout', { status: 0, code: 'TIMEOUT' }],
    ['server error', { status: 500, code: 'FAILED_INTERNAL_SYSTEM_PROCESSING' }],
    ['idempotency conflict', { status: 409, code: 'IDEMPOTENT_REQUEST_PROCESSING' }],
  ])('POST %s도 재조회가 전액 취소를 증명하면 성공으로 수렴한다', async (_label, failure) => {
    const fetchPayment = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, body: providerPayment({ state: 'uncanceled' }) })
      .mockResolvedValueOnce({ ok: true as const, body: providerPayment({ state: 'fully_canceled' }) });
    const deps = dependencies({
      fetchPayment,
      cancelPayment: vi.fn(async () => ({
        ok: false as const,
        ...failure,
        message: `provider failure for ${PAYMENT_KEY}`,
      })),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: true, status: 'completed' });

    expect(fetchPayment).toHaveBeenCalledTimes(2);
    expect(deps.markNeedsReview).not.toHaveBeenCalled();
  });

  it('POST 타임아웃 뒤에도 미취소이면 needs_review로 남기고 결제 식별자를 반환하지 않는다', async () => {
    const fetchPayment = vi.fn(async () => ({
      ok: true as const,
      body: providerPayment({ state: 'uncanceled' }),
    }));
    const deps = dependencies({
      fetchPayment,
      cancelPayment: vi.fn(async () => ({
        ok: false as const,
        status: 0,
        code: 'TIMEOUT',
        message: `timeout for ${PAYMENT_KEY}`,
      })),
    });

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

  it.each([
    ['identity mismatch', providerPayment({ paymentKey: 'other-key', state: 'fully_canceled' }), 'provider_mismatch'],
    ['partial cancellation', providerPayment({ state: 'partial' }), 'provider_cancellation_incomplete'],
  ])('%s는 완료하지 않고 needs_review로 격리한다', async (_label, body, code) => {
    const deps = dependencies({
      fetchPayment: vi.fn(async () => ({ ok: true as const, body })),
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: false, code });

    expect(deps.cancelPayment).not.toHaveBeenCalled();
    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      actorId: ACTOR_ID,
      code,
    });
  });

  it('다중 결제 중 하나만 취소되면 완료하지 않고 재시도 때 이미 취소된 결제는 POST를 건너뛴다', async () => {
    const secondKey = 'second-payment-secret';
    const multiContext = context({
      payments: [
        { id: 'payment-1', status: 'paid', amount: 42000, paymentKey: PAYMENT_KEY },
        { id: 'payment-2', status: 'paid', amount: 12000, paymentKey: secondKey },
      ],
    });
    const fetchPayment = vi.fn(async (paymentKey: string) => {
      if (paymentKey === PAYMENT_KEY) {
        return { ok: true as const, body: providerPayment({ state: 'fully_canceled' }) };
      }
      return {
        ok: true as const,
        body: providerPayment({
          paymentKey: secondKey,
          amount: 12000,
          state: 'partial',
        }),
      };
    });
    const deps = dependencies({
      loadContext: vi.fn(async () => multiContext),
      fetchPayment,
    });

    await expect(reconcileOrderCancellation(
      { requestId: REQUEST_ID, actorId: ACTOR_ID },
      deps,
    )).resolves.toEqual({ ok: false, code: 'provider_cancellation_incomplete' });

    expect(deps.cancelPayment).not.toHaveBeenCalledWith(expect.objectContaining({
      paymentKey: PAYMENT_KEY,
    }));
    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).toHaveBeenCalledTimes(1);
  });

  it('로컬 완료 RPC 실패는 needs_review로 남기고 안전한 코드만 반환한다', async () => {
    const deps = dependencies({
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
