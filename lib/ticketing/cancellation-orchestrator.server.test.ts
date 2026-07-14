import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  reconcileTicketCancellation,
  type TicketCancellationContext,
  type TicketCancellationDependencies,
} from './cancellation-orchestrator.server';

const defaultMocks = vi.hoisted(() => ({
  fetchPayment: vi.fn(),
  cancelPayment: vi.fn(),
  rpc: vi.fn(),
  request: null as Record<string, unknown> | null,
  order: null as Record<string, unknown> | null,
  payments: [] as Array<Record<string, unknown>>,
}));

vi.mock('server-only', () => ({}));
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
        eq: vi.fn(() => query),
        maybeSingle: vi.fn(async () => ({
          data: table === 'ticket_cancellation_requests'
            ? defaultMocks.request
            : defaultMocks.order,
          error: null,
        })),
        order: vi.fn(async () => ({ data: defaultMocks.payments, error: null })),
      };
      return query;
    },
  }),
}));

const REQUEST_ID = '11111111-1111-4111-8111-111111111111';
const TICKET_ORDER_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const ATTEMPT_TOKEN = '44444444-4444-4444-8444-444444444444';
const PAYMENT_ID = '55555555-5555-4555-8555-555555555555';
const PAYMENT_KEY = 'ticket-payment-secret';

function context(
  override: Partial<TicketCancellationContext> = {},
): TicketCancellationContext {
  return {
    requestId: REQUEST_ID,
    ticketOrderId: TICKET_ORDER_ID,
    requestedBy: USER_ID,
    requestStatus: 'processing',
    orderStatus: 'paid',
    payments: [{
      id: PAYMENT_ID,
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
  method?: string | null;
  type?: string;
  currency?: string;
  state: 'uncanceled' | 'fully_canceled' | 'partial';
}) {
  const amount = input.amount ?? 42000;
  const shared = {
    paymentKey: input.paymentKey ?? PAYMENT_KEY,
    orderId: input.orderId ?? `ticket_${TICKET_ORDER_ID}`,
    totalAmount: amount,
    type: input.type ?? 'NORMAL',
    currency: input.currency ?? 'KRW',
    method: input.method === undefined ? '카드' : input.method,
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
  override: Partial<TicketCancellationDependencies> = {},
): TicketCancellationDependencies {
  return {
    loadContext: vi.fn(async () => context()),
    fetchPayment: vi.fn(async () => ({
      ok: true as const,
      body: providerPayment({ state: 'fully_canceled' }),
    })),
    cancelPayment: vi.fn(async () => ({
      ok: true as const,
      body: providerPayment({ state: 'fully_canceled' }),
    })),
    recordEvidence: vi.fn(async () => undefined),
    completeRequest: vi.fn(async () => undefined),
    markNeedsReview: vi.fn(async () => undefined),
    ...override,
  };
}

const input = {
  requestId: REQUEST_ID,
  userId: USER_ID,
  attemptToken: ATTEMPT_TOKEN,
};

describe('reconcileTicketCancellation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    defaultMocks.request = {
      id: REQUEST_ID,
      ticket_order_id: TICKET_ORDER_ID,
      requested_by: USER_ID,
      status: 'processing',
    };
    defaultMocks.order = {
      id: TICKET_ORDER_ID,
      user_id: USER_ID,
      status: 'paid',
    };
    defaultMocks.payments = [{
      id: PAYMENT_ID,
      status: 'paid',
      amount: 42000,
      payment_key: PAYMENT_KEY,
    }];
    defaultMocks.rpc.mockResolvedValue({ error: null });
  });

  it('fresh GET이 전액 취소를 증명하면 POST 없이 증거를 기록하고 요청을 완료한다', async () => {
    const providerRaw = {
      ...providerPayment({ state: 'fully_canceled' }),
      privateProviderTrace: 'must-not-leak',
    };
    const deps = dependencies({
      fetchPayment: vi.fn(async () => ({ ok: true as const, body: providerRaw })),
    });

    const result = await reconcileTicketCancellation(input, deps);

    expect(result).toEqual({
      ok: true,
      status: 'completed',
    });

    expect(deps.fetchPayment).toHaveBeenCalledWith(PAYMENT_KEY);
    expect(deps.cancelPayment).not.toHaveBeenCalled();
    expect(deps.recordEvidence).toHaveBeenCalledWith({
      ticketOrderId: TICKET_ORDER_ID,
      reason: '사용자 티켓 예매 취소',
      paymentKey: PAYMENT_KEY,
      providerRaw,
      refundConfirmed: true,
    });
    expect(deps.completeRequest).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      attemptToken: ATTEMPT_TOKEN,
      verifiedPaymentKeys: [PAYMENT_KEY],
    });
    expect(JSON.stringify(result)).not.toMatch(/must-not-leak|ticket-payment-secret/);
  });

  it('provider 결제가 남은 pending 예매도 fresh 증거로 취소를 정합화한다', async () => {
    const providerRaw = providerPayment({ state: 'fully_canceled' });
    const deps = dependencies({
      loadContext: vi.fn(async () => context({ orderStatus: 'pending' })),
      fetchPayment: vi.fn(async () => ({ ok: true as const, body: providerRaw })),
    });

    await expect(reconcileTicketCancellation(input, deps)).resolves.toEqual({
      ok: true,
      status: 'completed',
    });
    expect(deps.recordEvidence).toHaveBeenCalledWith(expect.objectContaining({
      providerRaw,
      refundConfirmed: true,
    }));
    expect(deps.completeRequest).toHaveBeenCalledTimes(1);
  });

  it('미취소 결제는 요청·결제별 멱등키로 취소하고 POST 결과와 무관하게 fresh GET을 다시 한다', async () => {
    const beforeRaw = providerPayment({ state: 'uncanceled' });
    const afterRaw = {
      ...providerPayment({ state: 'fully_canceled' }),
      freshAfterCancel: true,
    };
    const fetchPayment = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        body: beforeRaw,
      })
      .mockResolvedValueOnce({
        ok: true as const,
        body: afterRaw,
      });
    const deps = dependencies({
      fetchPayment,
      cancelPayment: vi.fn(async () => ({
        ok: false as const,
        status: 0,
        code: 'TIMEOUT',
        message: `private timeout for ${PAYMENT_KEY}`,
      })),
    });

    await expect(reconcileTicketCancellation(input, deps)).resolves.toEqual({
      ok: true,
      status: 'completed',
    });

    expect(deps.cancelPayment).toHaveBeenCalledWith({
      paymentKey: PAYMENT_KEY,
      cancelReason: '사용자 티켓 예매 취소',
      idempotencyKey: `ticket-cancel-${REQUEST_ID}-${PAYMENT_ID}`,
    });
    expect(fetchPayment).toHaveBeenCalledTimes(2);
    expect(deps.recordEvidence).toHaveBeenCalledWith({
      ticketOrderId: TICKET_ORDER_ID,
      reason: '사용자 티켓 예매 취소',
      paymentKey: PAYMENT_KEY,
      providerRaw: afterRaw,
      refundConfirmed: true,
    });
  });

  it.each([
    ['가상계좌', '가상계좌'],
    ['미승인 결제', null],
  ])('전액 취소된 %s는 환불 확정 증거로 승격하지 않는다', async (_label, method) => {
    const deps = dependencies({
      fetchPayment: vi.fn(async () => ({
        ok: true as const,
        body: providerPayment({ state: 'fully_canceled', method }),
      })),
    });

    await expect(reconcileTicketCancellation(input, deps)).resolves.toEqual({
      ok: false,
      code: 'unsupported_payment_method',
    });
    expect(deps.recordEvidence).not.toHaveBeenCalled();
    expect(deps.completeRequest).not.toHaveBeenCalled();
  });

  it('default RPC에도 fresh raw와 환불 확정 플래그를 전달하고 반환값에는 노출하지 않는다', async () => {
    const providerRaw = {
      ...providerPayment({ state: 'fully_canceled' }),
      privateProviderTrace: 'default-must-not-leak',
    };
    defaultMocks.fetchPayment.mockResolvedValue({ ok: true, body: providerRaw });

    const result = await reconcileTicketCancellation(input);

    expect(result).toEqual({ ok: true, status: 'completed' });
    expect(defaultMocks.rpc).toHaveBeenCalledWith(
      'record_ticket_provider_cancellation_evidence',
      {
        p_ticket_order_id: TICKET_ORDER_ID,
        p_reason: '사용자 티켓 예매 취소',
        p_provider_payment_key: PAYMENT_KEY,
        p_provider_raw: providerRaw,
        p_refund_confirmed: true,
      },
    );
    expect(JSON.stringify(result)).not.toMatch(/default-must-not-leak|ticket-payment-secret/);
  });

  it('미취소 가상계좌는 provider POST 없이 needs_review로 격리한다', async () => {
    const deps = dependencies({
      fetchPayment: vi.fn(async () => ({
        ok: true as const,
        body: providerPayment({ state: 'uncanceled', method: '가상계좌' }),
      })),
    });

    await expect(reconcileTicketCancellation(input, deps)).resolves.toEqual({
      ok: false,
      code: 'unsupported_payment_method',
    });

    expect(deps.cancelPayment).not.toHaveBeenCalled();
    expect(deps.recordEvidence).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      attemptToken: ATTEMPT_TOKEN,
      code: 'unsupported_payment_method',
    });
  });

  it.each([
    ['identity mismatch', providerPayment({ paymentKey: 'other-key', state: 'fully_canceled' }), 'provider_mismatch'],
    ['unsupported contract', providerPayment({ type: 'BRANDPAY', state: 'uncanceled' }), 'provider_mismatch'],
    ['partial cancellation', providerPayment({ state: 'partial' }), 'provider_cancellation_incomplete'],
  ])('%s는 로컬 완료 없이 needs_review로 전환한다', async (_label, body, code) => {
    const deps = dependencies({
      fetchPayment: vi.fn(async () => ({ ok: true as const, body })),
    });

    await expect(reconcileTicketCancellation(input, deps)).resolves.toEqual({ ok: false, code });
    expect(deps.recordEvidence).not.toHaveBeenCalled();
    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      attemptToken: ATTEMPT_TOKEN,
      code,
    });
  });

  it.each([
    ['결제 0건', []],
    ['failed 결제만 존재', [{ id: PAYMENT_ID, status: 'failed' as const, amount: 42000, paymentKey: null }]],
  ])('pending 예매의 %s 상태는 provider 호출 없이 빈 증거로 로컬 완료한다', async (_label, payments) => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({ orderStatus: 'pending', payments })),
    });

    await expect(reconcileTicketCancellation(input, deps)).resolves.toEqual({
      ok: true,
      status: 'completed',
    });
    expect(deps.fetchPayment).not.toHaveBeenCalled();
    expect(deps.recordEvidence).not.toHaveBeenCalled();
    expect(deps.completeRequest).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      attemptToken: ATTEMPT_TOKEN,
      verifiedPaymentKeys: [],
    });
    expect(deps.markNeedsReview).not.toHaveBeenCalled();
  });

  it('paid 예매에 active 결제가 없으면 provider 증거 불충분으로 격리한다', async () => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({
        orderStatus: 'paid',
        payments: [{ id: PAYMENT_ID, status: 'failed', amount: 42000, paymentKey: null }],
      })),
    });

    await expect(reconcileTicketCancellation(input, deps)).resolves.toEqual({
      ok: false,
      code: 'payment_evidence_invalid',
    });
    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      attemptToken: ATTEMPT_TOKEN,
      code: 'payment_evidence_invalid',
    });
  });

  it('결제 id·금액·키 이상은 provider 호출 전에 차단한다', async () => {
    for (const payments of [
      [{ id: 'not-a-uuid', status: 'paid' as const, amount: 42000, paymentKey: PAYMENT_KEY }],
      [{ id: PAYMENT_ID, status: 'paid' as const, amount: 0, paymentKey: PAYMENT_KEY }],
      [{ id: PAYMENT_ID, status: 'paid' as const, amount: 42000, paymentKey: '  ' }],
    ]) {
      const deps = dependencies({
        loadContext: vi.fn(async () => context({ payments })),
      });

      await expect(reconcileTicketCancellation(input, deps)).resolves.toEqual({
        ok: false,
        code: 'payment_evidence_invalid',
      });
      expect(deps.fetchPayment).not.toHaveBeenCalled();
      expect(deps.markNeedsReview).toHaveBeenCalledWith({
        requestId: REQUEST_ID,
        attemptToken: ATTEMPT_TOKEN,
        code: 'payment_evidence_invalid',
      });
    }
  });

  it('결제는 id 순서로 처리하고 완료 RPC에는 검증된 모든 키를 전달한다', async () => {
    const earlierId = '00000000-0000-4000-8000-000000000001';
    const laterId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const earlierKey = 'earlier-key';
    const laterKey = 'later-key';
    const fetchPayment = vi.fn(async (paymentKey: string) => ({
      ok: true as const,
      body: providerPayment({
        paymentKey,
        amount: paymentKey === earlierKey ? 12000 : 30000,
        state: 'fully_canceled',
      }),
    }));
    const deps = dependencies({
      loadContext: vi.fn(async () => context({
        payments: [
          { id: laterId, status: 'refunded', amount: 30000, paymentKey: laterKey },
          { id: earlierId, status: 'canceled', amount: 12000, paymentKey: earlierKey },
        ],
      })),
      fetchPayment,
    });

    await expect(reconcileTicketCancellation(input, deps)).resolves.toEqual({
      ok: true,
      status: 'completed',
    });
    expect(fetchPayment.mock.calls.map(([key]) => key)).toEqual([earlierKey, laterKey]);
    expect(deps.completeRequest).toHaveBeenCalledWith(expect.objectContaining({
      verifiedPaymentKeys: [earlierKey, laterKey],
    }));
  });

  it.each([
    ['provider GET', 'provider_unavailable'],
    ['local evidence', 'local_evidence_failed'],
    ['local completion', 'local_finalize_failed'],
  ])('%s 실패는 안전한 코드만 반환하고 needs_review로 전환한다', async (failure, code) => {
    const deps = dependencies(
      failure === 'provider GET'
        ? { fetchPayment: vi.fn(async () => ({ ok: false as const, status: 500, code: 'PRIVATE', message: PAYMENT_KEY })) }
        : failure === 'local evidence'
          ? { recordEvidence: vi.fn(async () => { throw new Error(PAYMENT_KEY); }) }
          : { completeRequest: vi.fn(async () => { throw new Error(PAYMENT_KEY); }) },
    );

    const result = await reconcileTicketCancellation(input, deps);

    expect(result).toEqual({ ok: false, code });
    expect(JSON.stringify(result)).not.toContain(PAYMENT_KEY);
    expect(deps.markNeedsReview).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      attemptToken: ATTEMPT_TOKEN,
      code,
    });
  });

  it('요청·사용자·주문 identity가 어긋난 stale context는 provider와 상태 RPC 전에 fail closed한다', async () => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({ requestedBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })),
    });

    await expect(reconcileTicketCancellation(input, deps)).resolves.toEqual({
      ok: false,
      code: 'request_state_invalid',
    });
    expect(deps.fetchPayment).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).not.toHaveBeenCalled();
  });
});
