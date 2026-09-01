import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  reconcileTicketCancellation,
  type TicketCancellationContext,
  type TicketCancellationDependencies,
} from './cancellation-orchestrator.server';

const defaultMocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  request: null as Record<string, unknown> | null,
  order: null as Record<string, unknown> | null,
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

function dependencies(
  override: Partial<TicketCancellationDependencies> = {},
): TicketCancellationDependencies {
  return {
    loadContext: vi.fn(async () => context()),
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
    defaultMocks.filters = [];
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
      provider: 'toss',
      status: 'paid',
      amount: 42000,
      payment_key: PAYMENT_KEY,
    }];
    defaultMocks.rpc.mockResolvedValue({ error: null });
  });

  it('default 조회는 legacy Toss 행만 읽고, 잔존 유상 캡처는 수동 검토로 승격한다', async () => {
    const result = await reconcileTicketCancellation(input);

    expect(result).toEqual({ ok: false, code: 'provider_unavailable' });
    expect(defaultMocks.filters).toContainEqual({
      table: 'payments',
      column: 'provider',
      value: 'toss',
    });
    expect(defaultMocks.rpc).toHaveBeenCalledWith(
      'mark_ticket_cancellation_needs_review',
      expect.objectContaining({ p_error_code: 'provider_unavailable' }),
    );
    expect(JSON.stringify(result)).not.toContain(PAYMENT_KEY);
  });

  it('legacy 원장 행이 없는 pending 예매는 빈 증거로 로컬 완료한다', async () => {
    defaultMocks.order = { id: TICKET_ORDER_ID, user_id: USER_ID, status: 'pending' };
    defaultMocks.payments = [];

    await expect(reconcileTicketCancellation(input)).resolves.toEqual({
      ok: true,
      status: 'completed',
    });
    expect(defaultMocks.rpc).toHaveBeenCalledWith(
      'complete_ticket_cancellation_request',
      expect.objectContaining({ p_provider_payment_keys: [] }),
    );
  });

  it('유상 캡처가 남아 있으면 완료하지 않고 수동 검토로 승격하며 결제 식별자를 반환하지 않는다', async () => {
    const deps = dependencies();

    const result = await reconcileTicketCancellation(input, deps);

    expect(result).toEqual({ ok: false, code: 'provider_unavailable' });
    expect(JSON.stringify(result)).not.toContain(PAYMENT_KEY);
    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      attemptToken: ATTEMPT_TOKEN,
      code: 'provider_unavailable',
    });
  });

  it('로컬 terminal(refunded·canceled) 결제도 원격 재검증이 불가능하므로 수동 검토로 승격한다', async () => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({
        payments: [
          { id: PAYMENT_ID, status: 'refunded', amount: 30000, paymentKey: PAYMENT_KEY },
        ],
      })),
    });

    await expect(reconcileTicketCancellation(input, deps)).resolves.toEqual({
      ok: false,
      code: 'provider_unavailable',
    });
    expect(deps.completeRequest).not.toHaveBeenCalled();
  });

  it.each([
    ['결제 0건', []],
    ['failed 결제만 존재', [{ id: PAYMENT_ID, status: 'failed' as const, amount: 42000, paymentKey: null }]],
  ])('pending 예매의 %s 상태는 빈 증거로 로컬 완료한다', async (_label, payments) => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({ orderStatus: 'pending', payments })),
    });

    await expect(reconcileTicketCancellation(input, deps)).resolves.toEqual({
      ok: true,
      status: 'completed',
    });
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

  it('결제 id·금액·키 이상은 수동 검토 승격 전에 증거 불량으로 차단한다', async () => {
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
      expect(deps.markNeedsReview).toHaveBeenCalledWith({
        requestId: REQUEST_ID,
        attemptToken: ATTEMPT_TOKEN,
        code: 'payment_evidence_invalid',
      });
    }
  });

  it('이미 완료된 요청은 상태 전이 없이 already_completed를 반환한다', async () => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({ requestStatus: 'completed' })),
    });

    await expect(reconcileTicketCancellation(input, deps)).resolves.toEqual({
      ok: true,
      status: 'already_completed',
    });
    expect(deps.completeRequest).not.toHaveBeenCalled();
    expect(deps.markNeedsReview).not.toHaveBeenCalled();
  });

  it('processing 이외 상태는 request_not_ready로 거절한다', async () => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({ requestStatus: 'requested' })),
    });

    await expect(reconcileTicketCancellation(input, deps)).resolves.toEqual({
      ok: false,
      code: 'request_not_ready',
    });
    expect(deps.markNeedsReview).not.toHaveBeenCalled();
  });

  it.each([
    ['local completion', 'local_finalize_failed'],
  ])('%s 실패는 안전한 코드만 반환하고 needs_review로 전환한다', async (_failure, code) => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({ orderStatus: 'pending', payments: [] })),
      completeRequest: vi.fn(async () => { throw new Error(PAYMENT_KEY); }),
    });

    const result = await reconcileTicketCancellation(input, deps);

    expect(result).toEqual({ ok: false, code });
    expect(JSON.stringify(result)).not.toContain(PAYMENT_KEY);
    expect(deps.markNeedsReview).toHaveBeenCalledWith({
      requestId: REQUEST_ID,
      attemptToken: ATTEMPT_TOKEN,
      code,
    });
  });

  it('needs_review 전이 자체가 실패하면 local_finalize_failed로 수렴한다', async () => {
    const deps = dependencies({
      markNeedsReview: vi.fn(async () => { throw new Error(PAYMENT_KEY); }),
    });

    const result = await reconcileTicketCancellation(input, deps);

    expect(result).toEqual({ ok: false, code: 'local_finalize_failed' });
    expect(JSON.stringify(result)).not.toContain(PAYMENT_KEY);
  });

  it('요청·사용자·주문 identity가 어긋난 stale context는 상태 RPC 전에 fail closed한다', async () => {
    const deps = dependencies({
      loadContext: vi.fn(async () => context({ requestedBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })),
    });

    await expect(reconcileTicketCancellation(input, deps)).resolves.toEqual({
      ok: false,
      code: 'request_state_invalid',
    });
    expect(deps.markNeedsReview).not.toHaveBeenCalled();
  });
});
