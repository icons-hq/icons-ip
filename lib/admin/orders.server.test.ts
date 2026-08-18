import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAdminOrderRecords } from './orders.server';
import type { AdminOrderFilters } from './orders';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

const mocks = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('@/lib/supabase/server', () => ({ createClient: () => mocks.client }));
/* 택배사 레지스트리는 DB(`public.shipping_carriers`)에서 온다(#251). 앱에 상수
   목록이 없으므로 테스트도 고정 레지스트리를 주입한다 — 여기서 확인하려는 것은
   목록 자체가 아니라 운송장이 그 목록을 거쳐 그려지는가다. */
vi.mock('@/lib/orders/shipment.server', () => {
  const carriers = [{
    code: 'hanjin',
    label: '한진택배',
    active: true,
    trackingUrlTemplate: 'https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do'
      + '?mCode=MN038&schLang=KR&wblnumText2={trackingNumber}',
  }];
  return {
    getShippingCarrierRegistry: async () => carriers,
    loadShippingCarrierRegistry: async () => carriers,
  };
});


type Row = Record<string, unknown>;
type Result = { data: Row[] | null; error: { message: string } | null };

interface QueryRecord {
  table: string;
  select: string | null;
  eq: Array<[string, unknown]>;
  in: Array<[string, unknown[]]>;
  order: Array<[string, { ascending?: boolean } | undefined]>;
}

function createClient(input: {
  rpcRows?: Row[];
  rpcError?: string;
  rpcRowsByName?: Record<string, Row[]>;
  rpcErrorsByName?: Record<string, string>;
  rows?: Record<string, Row[]>;
  errors?: Record<string, string>;
  records: QueryRecord[];
  rpc: ReturnType<typeof vi.fn>;
}) {
  return {
    rpc: input.rpc.mockImplementation(async (name: string) => ({
      data: input.rpcRowsByName?.[name] ?? input.rpcRows ?? [],
      error: input.rpcErrorsByName?.[name]
        ? { message: input.rpcErrorsByName[name] }
        : input.rpcError ? { message: input.rpcError } : null,
    })),
    from(table: string) {
      const record: QueryRecord = { table, select: null, eq: [], in: [], order: [] };
      input.records.push(record);
      const resolve = (): Result => ({
        data: input.rows?.[table] ?? [],
        error: input.errors?.[table] ? { message: input.errors[table] } : null,
      });
      const query = {
        select(columns: string) {
          record.select = columns;
          return query;
        },
        eq(column: string, value: unknown) {
          record.eq.push([column, value]);
          return query;
        },
        in(column: string, values: unknown[]) {
          record.in.push([column, values]);
          return query;
        },
        order(column: string, options?: { ascending?: boolean }) {
          record.order.push([column, options]);
          return query;
        },
        then<TResult1 = Result, TResult2 = never>(
          onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) {
          return Promise.resolve(resolve()).then(onfulfilled, onrejected);
        },
      };
      return query;
    },
  };
}

const filters: AdminOrderFilters = {
  from: '2026-07-01',
  orderId: ORDER_ID,
  page: 2,
  query: 'fan@example.test',
  status: 'paid',
  to: '2026-07-14',
};

describe('getAdminOrderRecords', () => {
  beforeEach(() => {
    mocks.client = null;
  });

  it('filters and paginates in the staff-gated DB RPC, then joins only safe ledger fields', async () => {
    const records: QueryRecord[] = [];
    const rpc = vi.fn();
    mocks.client = createClient({
      records,
      rpc,
      rpcRows: [{
        id: ORDER_ID,
        user_id: USER_ID,
        buyer_name: 'maple_fan',
        buyer_email: 'fan@example.test',
        status: 'paid',
        total: 32000,
        address: {
          recipientName: '김팬',
          phone: '01012345678',
          postalCode: '04799',
          address1: '서울 성동구 성수이로 1',
          address2: '101호',
        },
        created_at: '2026-07-14T06:00:00.000Z',
        updated_at: '2026-07-14T06:01:00.000Z',
        cancellation_request_id: '33333333-3333-4333-8333-333333333333',
        cancellation_request_status: 'requested',
        cancellation_claim_type: 'cancel',
        cancellation_stage: 'requested',
        cancellation_reason_type: 'defect',
        cancellation_requested_at: '2026-07-14T07:00:00.000Z',
        cancellation_decided_at: null,
        cancellation_decision_note: null,
        shipping_carrier: 'hanjin',
        tracking_number: '123456789012',
        total_count: 27,
        payment_key: 'must-not-leak',
        raw: { cardNumber: 'must-not-leak' },
      }],
      rows: {
        order_items: [{
          id: 'item-1',
          order_id: ORDER_ID,
          qty: 1,
          unit_price: 32000,
          good_name_snapshot: '화산강림 아크릴 스탠드',
          good_type_snapshot: '아크릴 스탠드',
        }],
        payment_summaries: [{
          id: 'payment-1',
          ref_id: ORDER_ID,
          amount: 32000,
          status: 'paid',
          created_at: '2026-07-14T06:01:00.000Z',
          payment_key: 'must-not-leak',
          raw: { cardNumber: 'must-not-leak' },
        }],
        refunds: [{
          id: 'refund-1',
          payment_id: 'payment-1',
          amount: 32000,
          status: 'requested',
          created_at: '2026-07-14T07:00:00.000Z',
          reason: 'must-not-leak',
        }],
      },
    });

    const result = await getAdminOrderRecords(filters);

    expect(rpc).toHaveBeenCalledWith('admin_search_orders', {
      p_from: '2026-07-01',
      p_limit: 20,
      p_offset: 20,
      p_query: 'fan@example.test',
      p_status: 'paid',
      p_to: '2026-07-14',
    });
    expect(result).toMatchObject({
      filters,
      pageSize: 20,
      total: 27,
      items: [{
        id: ORDER_ID,
        userId: USER_ID,
        buyerName: 'maple_fan',
        buyerEmail: 'fan@example.test',
        status: 'paid',
        total: 32000,
        items: [{ id: 'item-1', name: '화산강림 아크릴 스탠드', type: '아크릴 스탠드', qty: 1, unitPrice: 32000 }],
        payments: [{ id: 'payment-1', amount: 32000, status: 'paid', createdAt: '2026-07-14T06:01:00.000Z' }],
        refunds: [{ id: 'refund-1', amount: 32000, status: 'requested', createdAt: '2026-07-14T07:00:00.000Z' }],
        cancellationRequest: {
          id: '33333333-3333-4333-8333-333333333333',
          status: 'requested',
          claimType: 'cancel',
          stage: 'requested',
          reasonType: 'defect',
          requestedAt: '2026-07-14T07:00:00.000Z',
          decidedAt: null,
          decisionNote: null,
        },
        shipment: {
          carrier: 'hanjin',
          carrierLabel: '한진택배',
          trackingNumber: '123456789012',
        },
      }],
    });
    // 사유 구분(reasonType)은 운영 판단에 필요해 노출하지만, 고객이 적은 자유
    // 서술 reason은 여전히 새면 안 된다. 키 이름으로 정확히 구분한다.
    expect(JSON.stringify(result)).not.toMatch(/must-not-leak|payment_key|"raw"|"reason"/);
    expect(records.find((record) => record.table === 'payment_summaries')?.select).toBe(
      'id,ref_id,amount,status,created_at',
    );
    expect(records.find((record) => record.table === 'refunds')?.select).toBe(
      'id,payment_id,amount,status,created_at',
    );
  });

  it('returns an empty page without issuing broad child-table queries', async () => {
    const records: QueryRecord[] = [];
    const rpc = vi.fn();
    mocks.client = createClient({ records, rpc, rpcRows: [] });

    /* 행이 없어도 택배사 레지스트리는 함께 싣는다 — 콘솔에 상수 목록이 없어서
       빈 목록에서도 운송장 폼이 고를 값을 응답에서 받아야 한다(#251). */
    await expect(getAdminOrderRecords({ ...filters, page: 1 })).resolves.toEqual({
      carriers: [{
        code: 'hanjin',
        label: '한진택배',
        active: true,
        trackingUrlTemplate: 'https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do'
          + '?mCode=MN038&schLang=KR&wblnumText2={trackingNumber}',
      }],
      filters: { ...filters, page: 1 },
      items: [],
      pageSize: 20,
      total: 0,
    });
    expect(records).toEqual([]);
  });

  it('loads only the staff-safe Korpay attempt summary for its active cancellation request', async () => {
    const records: QueryRecord[] = [];
    const rpc = vi.fn();
    const requestId = '33333333-3333-4333-8333-333333333333';
    mocks.client = createClient({
      records,
      rpc,
      rpcRowsByName: {
        admin_search_orders: [{
          id: ORDER_ID,
          user_id: USER_ID,
          buyer_name: 'maple_fan',
          buyer_email: 'fan@example.test',
          status: 'paid',
          total: 32000,
          address: null,
          created_at: '2026-07-14T06:00:00.000Z',
          updated_at: '2026-07-14T06:01:00.000Z',
          cancellation_request_id: requestId,
          cancellation_request_status: 'needs_review',
          cancellation_claim_type: 'cancel',
          cancellation_stage: 'needs_review',
          cancellation_reason_type: 'change_of_mind',
          cancellation_requested_at: '2026-07-14T07:00:00.000Z',
          cancellation_decided_at: '2026-07-14T07:05:00.000Z',
          cancellation_decision_note: null,
          shipping_carrier: null,
          tracking_number: null,
          total_count: 1,
        }],
        admin_goods_manual_recovery_attempts: [{
          order_id: ORDER_ID,
          request_id: requestId,
          attempt_id: '44444444-4444-4444-8444-444444444444',
          provider_order_id: 'O0123456789ABCDEF',
          state: 'approved',
          amount: 32000,
          currency: 'KRW',
          created_at: '2026-07-14T06:00:30.000Z',
          updated_at: '2026-07-14T06:01:00.000Z',
          manual_recovery_available: true,
          payment_key: 'must-not-leak',
          tid: 'must-not-leak',
        }],
      },
      rows: { order_items: [], payment_summaries: [] },
    });

    const result = await getAdminOrderRecords({ ...filters, page: 1 }, true);

    expect(rpc).toHaveBeenCalledWith('admin_goods_manual_recovery_attempts', {
      p_order_ids: [ORDER_ID],
    });
    expect(result.items[0].manualRecoveryAttempt).toEqual({
      attemptId: '44444444-4444-4444-8444-444444444444',
      requestId,
      providerOrderId: 'O0123456789ABCDEF',
      state: 'approved',
      amount: 32000,
      currency: 'KRW',
      manualRecoveryAvailable: true,
    });
    expect(JSON.stringify(result.items[0].manualRecoveryAttempt)).not.toMatch(/payment_key|tid|must-not-leak/);
  });

  it('fails closed when a Korpay attempt summary does not match the active request', async () => {
    const requestId = '33333333-3333-4333-8333-333333333333';
    mocks.client = createClient({
      records: [],
      rpc: vi.fn(),
      rpcRowsByName: {
        admin_search_orders: [{
          id: ORDER_ID,
          user_id: USER_ID,
          buyer_name: 'maple_fan',
          buyer_email: null,
          status: 'pending',
          total: 32000,
          address: null,
          created_at: '2026-07-14T06:00:00.000Z',
          updated_at: '2026-07-14T06:01:00.000Z',
          cancellation_request_id: requestId,
          cancellation_request_status: 'needs_review',
          cancellation_claim_type: 'cancel',
          cancellation_stage: 'needs_review',
          cancellation_reason_type: 'change_of_mind',
          cancellation_requested_at: '2026-07-14T07:00:00.000Z',
          cancellation_decided_at: null,
          cancellation_decision_note: null,
          shipping_carrier: null,
          tracking_number: null,
          total_count: 1,
        }],
        admin_goods_manual_recovery_attempts: [{
          order_id: ORDER_ID,
          request_id: '55555555-5555-4555-8555-555555555555',
          attempt_id: '44444444-4444-4444-8444-444444444444',
          provider_order_id: 'O0123456789ABCDEF',
          state: 'unknown',
          amount: 32000,
          currency: 'KRW',
          manual_recovery_available: true,
        }],
      },
      rows: { order_items: [], payment_summaries: [] },
    });

    await expect(getAdminOrderRecords({ ...filters, page: 1 }, true)).rejects.toThrow(
      'mismatched payment attempt relation',
    );
  });

  it('throws on RPC or child query failures instead of rendering a false empty ledger', async () => {
    mocks.client = createClient({ records: [], rpc: vi.fn(), rpcError: 'private search failure' });
    await expect(getAdminOrderRecords(filters)).rejects.toThrow('Failed to load admin orders');

    mocks.client = createClient({
      records: [],
      rpc: vi.fn(),
      rpcRows: [{
        id: ORDER_ID,
        user_id: USER_ID,
        buyer_name: 'fan',
        buyer_email: null,
        status: 'paid',
        total: 1,
        address: null,
        created_at: '2026-07-14T06:00:00.000Z',
        updated_at: '2026-07-14T06:00:00.000Z',
        cancellation_request_id: null,
        cancellation_request_status: null,
        cancellation_requested_at: null,
        cancellation_decided_at: null,
        cancellation_decision_note: null,
        total_count: 1,
      }],
      errors: { order_items: 'private item failure' },
    });
    await expect(getAdminOrderRecords(filters)).rejects.toThrow('Failed to load admin order items');
  });

  /* 모르는 단계를 'requested'로 접으면 수거 중인 반품이 주문 콘솔에서 승인
     가능한 청약철회로 보인다(#252 F1). 사유 구분과 같은 이유로 fail closed다. */
  it('fails closed on an unsupported claim stage', async () => {
    mocks.client = createClient({
      records: [],
      rpc: vi.fn(),
      rpcRows: [{
        id: ORDER_ID,
        user_id: USER_ID,
        buyer_name: 'fan',
        buyer_email: null,
        status: 'paid',
        total: 1,
        address: null,
        created_at: '2026-07-14T06:00:00.000Z',
        updated_at: '2026-07-14T06:00:00.000Z',
        cancellation_request_id: '33333333-3333-4333-8333-333333333333',
        cancellation_request_status: 'requested',
        cancellation_claim_type: 'cancel',
        cancellation_stage: 'awaiting_courier',
        cancellation_reason_type: 'change_of_mind',
        cancellation_requested_at: '2026-07-14T07:00:00.000Z',
        cancellation_decided_at: null,
        cancellation_decision_note: null,
        total_count: 1,
      }],
    });

    await expect(getAdminOrderRecords(filters)).rejects.toThrow('unsupported claim stage');
  });

  // 사유 구분은 기한과 배송비 부담 주체를 가른다. 모르는 값을 조용히 단순 변심으로
  // 접으면 운영자가 잘못된 근거로 승인한다.
  it('fails closed on an unsupported cancellation reason type', async () => {
    mocks.client = createClient({
      records: [],
      rpc: vi.fn(),
      rpcRows: [{
        id: ORDER_ID,
        user_id: USER_ID,
        buyer_name: 'fan',
        buyer_email: null,
        status: 'paid',
        total: 1,
        address: null,
        created_at: '2026-07-14T06:00:00.000Z',
        updated_at: '2026-07-14T06:00:00.000Z',
        cancellation_request_id: '33333333-3333-4333-8333-333333333333',
        cancellation_request_status: 'requested',
        cancellation_claim_type: 'cancel',
        cancellation_stage: 'requested',
        cancellation_reason_type: 'act_of_god',
        cancellation_requested_at: '2026-07-14T07:00:00.000Z',
        cancellation_decided_at: null,
        cancellation_decision_note: null,
        total_count: 1,
      }],
    });

    await expect(getAdminOrderRecords(filters)).rejects.toThrow(
      'unsupported cancellation reason type',
    );
  });
});
