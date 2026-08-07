import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAdminOrderRecords } from './orders.server';
import type { AdminOrderFilters } from './orders';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

const mocks = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('@/lib/supabase/server', () => ({ createClient: () => mocks.client }));

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
  rows?: Record<string, Row[]>;
  errors?: Record<string, string>;
  records: QueryRecord[];
  rpc: ReturnType<typeof vi.fn>;
}) {
  return {
    rpc: input.rpc.mockImplementation(async () => ({
      data: input.rpcRows ?? [],
      error: input.rpcError ? { message: input.rpcError } : null,
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
        payments: [{
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
    expect(JSON.stringify(result)).not.toMatch(/must-not-leak|payment_key|raw|reason/);
    expect(records.find((record) => record.table === 'payments')?.select).toBe(
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

    await expect(getAdminOrderRecords({ ...filters, page: 1 })).resolves.toEqual({
      filters: { ...filters, page: 1 },
      items: [],
      pageSize: 20,
      total: 0,
    });
    expect(records).toEqual([]);
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
});
