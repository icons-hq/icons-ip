import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadOrderDetail, loadOrders } from './orders.server';

const mocks = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => mocks.client }));

type Row = Record<string, unknown>;
type QueryResult = { data: Row[] | Row | null; error: { message: string } | null };

interface QueryRecord {
  table: string;
  select?: string;
  eq: [string, unknown][];
  in: [string, unknown[]][];
  order: [string, { ascending?: boolean } | undefined][];
  limit?: number;
  maybeSingle: boolean;
}

interface ClientOptions {
  errors?: Partial<Record<string, string>>;
  records: QueryRecord[];
  rows: Record<string, Row[]>;
}

function createQuery(table: string, options: ClientOptions) {
  const record: QueryRecord = {
    table,
    eq: [],
    in: [],
    order: [],
    maybeSingle: false,
  };
  options.records.push(record);

  const resolve = (): QueryResult => {
    const message = options.errors?.[table];
    if (message) return { data: null, error: { message } };

    let rows = [...(options.rows[table] ?? [])];
    for (const [column, value] of record.eq) rows = rows.filter((row) => row[column] === value);
    for (const [column, values] of record.in) rows = rows.filter((row) => values.includes(row[column]));
    for (const [column, settings] of record.order) {
      rows.sort((left, right) => {
        const direction = settings?.ascending === false ? -1 : 1;
        return direction * String(left[column] ?? '').localeCompare(String(right[column] ?? ''));
      });
    }
    if (record.limit !== undefined) rows = rows.slice(0, record.limit);

    return { data: record.maybeSingle ? rows[0] ?? null : rows, error: null };
  };

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
    order(column: string, settings?: { ascending?: boolean }) {
      record.order.push([column, settings]);
      return query;
    },
    limit(value: number) {
      record.limit = value;
      return query;
    },
    maybeSingle() {
      record.maybeSingle = true;
      return Promise.resolve(resolve());
    },
    then<TResult1 = QueryResult, TResult2 = never>(
      onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve(resolve()).then(onfulfilled, onrejected);
    },
  };

  return query;
}

function createClient(options: ClientOptions) {
  return {
    from(table: string) {
      return createQuery(table, options);
    },
  };
}

const orderId = '7ad4c967-3d48-44da-a665-64731ac33f62';
const userId = '1cc4d399-8e70-4f06-979d-8fb0f9c43fde';

beforeEach(() => {
  mocks.client = null;
});

describe('loadOrders', () => {
  it('loads only the viewer visible history and summarizes immutable item snapshots', async () => {
    const records: QueryRecord[] = [];
    mocks.client = createClient({
      records,
      rows: {
        orders: [{ id: orderId, user_id: userId, status: 'paid', total: 54000, created_at: '2026-07-14T06:00:00.000Z' }],
        order_items: [
          { order_id: orderId, qty: 2, good_name_snapshot: '아크릴 스탠드' },
          { order_id: orderId, qty: 1, good_name_snapshot: '틴케이스' },
        ],
      },
    });

    await expect(loadOrders(userId)).resolves.toEqual([{
      id: orderId,
      status: 'paid',
      total: 54000,
      createdAt: '2026-07-14T06:00:00.000Z',
      itemLabel: '아크릴 스탠드 외 1건',
      itemCount: 3,
    }]);

    expect(records.find((record) => record.table === 'orders')).toMatchObject({
      select: 'id,user_id,status,total,created_at',
      eq: [['user_id', userId]],
      in: [['status', ['paid', 'shipping', 'done', 'canceled']]],
      order: [['created_at', { ascending: false }], ['id', { ascending: false }]],
    });
    expect(records.find((record) => record.table === 'order_items')).toMatchObject({
      select: 'order_id,qty,good_name_snapshot',
      in: [['order_id', [orderId]]],
    });
  });

  it('throws on query failures instead of rendering a false empty state', async () => {
    mocks.client = createClient({ records: [], rows: {}, errors: { orders: 'network unavailable' } });
    await expect(loadOrders(userId)).rejects.toThrow('Failed to load orders');
  });
});

describe('loadOrderDetail', () => {
  it('loads a viewer-owned receipt with safe payment fields and actual card-pack counts', async () => {
    const records: QueryRecord[] = [];
    mocks.client = createClient({
      records,
      rows: {
        orders: [{
          id: orderId,
          user_id: userId,
          status: 'shipping',
          total: 54000,
          address: {
            recipientName: '팬',
            phone: '01012345678',
            postalCode: '04799',
            address1: '서울 성동구',
            address2: '101호',
            deliveryNote: '',
          },
          created_at: '2026-07-14T06:00:00.000Z',
        }],
        order_items: [{
          id: 'item-1',
          order_id: orderId,
          good_id: 'goods-1',
          qty: 2,
          unit_price: 27000,
          good_name_snapshot: '아크릴 스탠드',
          good_type_snapshot: '아크릴',
        }],
        payments: [{
          id: 'payment-2',
          user_id: userId,
          purpose: 'order',
          ref_id: orderId,
          amount: 54000,
          status: 'paid',
          created_at: '2026-07-14T06:01:00.000Z',
          payment_key: 'must-not-leak',
          idempotency_key: 'must-not-leak',
          raw: { cardNumber: 'must-not-leak' },
        }, {
          id: 'payment-1',
          user_id: userId,
          purpose: 'order',
          ref_id: orderId,
          amount: 54000,
          status: 'failed',
          created_at: '2026-07-14T05:59:00.000Z',
        }],
        refunds: [{
          id: 'refund-1',
          payment_id: 'payment-1',
          amount: 54000,
          status: 'requested',
          reason: 'must-not-leak',
          created_at: '2026-07-14T07:30:00.000Z',
        }],
        draw_tickets: [
          { user_id: userId, source: 'order_paid', source_id: orderId, consumed_at: null },
          { user_id: userId, source: 'order_paid', source_id: orderId, consumed_at: '2026-07-14T07:00:00.000Z' },
        ],
      },
    });

    const result = await loadOrderDetail(userId, orderId);

    expect(result).toMatchObject({
      id: orderId,
      status: 'shipping',
      total: 54000,
      items: [{ goodId: 'goods-1', name: '아크릴 스탠드', type: '아크릴', qty: 2, unitPrice: 27000 }],
      payment: { amount: 54000, status: 'paid', createdAt: '2026-07-14T06:01:00.000Z' },
      refund: { status: 'requested', createdAt: '2026-07-14T07:30:00.000Z' },
      cardPacks: { issuedCount: 2, availableCount: 1 },
    });
    expect(JSON.stringify(result)).not.toMatch(/must-not-leak|payment_key|idempotency_key|raw/);

    expect(records.find((record) => record.table === 'orders')).toMatchObject({
      eq: [['id', orderId], ['user_id', userId]],
      in: [['status', ['pending', 'paid', 'shipping', 'done', 'canceled']]],
      maybeSingle: true,
    });
    expect(records.find((record) => record.table === 'payments')).toMatchObject({
      select: 'id,amount,status,created_at',
      eq: [['user_id', userId], ['purpose', 'order'], ['ref_id', orderId]],
      order: [['created_at', { ascending: false }], ['id', { ascending: false }]],
      maybeSingle: false,
    });
    expect(records.find((record) => record.table === 'draw_tickets')).toMatchObject({
      select: 'consumed_at',
      eq: [['user_id', userId], ['source', 'order_paid'], ['source_id', orderId]],
    });
    expect(records.find((record) => record.table === 'refunds')).toMatchObject({
      select: 'status,created_at',
      in: [['payment_id', ['payment-2', 'payment-1']]],
      order: [['created_at', { ascending: false }]],
      limit: 1,
      maybeSingle: true,
    });
  });

  it('loads a pending order detail while keeping pending orders out of history', async () => {
    const records: QueryRecord[] = [];
    mocks.client = createClient({
      records,
      rows: {
        orders: [{
          id: orderId,
          user_id: userId,
          status: 'pending',
          total: 54000,
          address: null,
          created_at: '2026-07-14T06:00:00.000Z',
        }],
        order_items: [],
        payments: [],
        draw_tickets: [],
      },
    });

    await expect(loadOrderDetail(userId, orderId)).resolves.toMatchObject({
      id: orderId,
      status: 'pending',
      refund: null,
    });
    expect(records.some((record) => record.table === 'refunds')).toBe(false);
  });

  it('returns null for a missing or other-user order without loading receipt children', async () => {
    const records: QueryRecord[] = [];
    mocks.client = createClient({
      records,
      rows: {
        orders: [{ id: orderId, user_id: 'another-user', status: 'paid' }],
      },
    });

    await expect(loadOrderDetail(userId, orderId)).resolves.toBeNull();
    expect(records.map((record) => record.table)).toEqual(['orders']);
  });
});
