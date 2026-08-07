import { describe, expect, it, vi } from 'vitest';
import { loadCheckoutOrder } from './checkout.server';

const mocks = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('./supabase/server', () => ({ createClient: () => mocks.client }));

interface QueryRecord {
  table: string;
  select?: string;
  eq: [string, unknown][];
}

function createQuery(
  table: string,
  records: QueryRecord[],
  rowsByTable: Record<string, Record<string, unknown>[]>,
) {
  const record: QueryRecord = { table, eq: [] };
  records.push(record);

  const result = () => {
    let rows = rowsByTable[table] ?? [];
    for (const [column, value] of record.eq) rows = rows.filter((row) => row[column] === value);
    return { data: rows, error: null };
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
    order() {
      return query;
    },
    limit() {
      return query;
    },
    maybeSingle() {
      const { data, error } = result();
      return Promise.resolve({ data: data[0] ?? null, error });
    },
    then<TResult1 = ReturnType<typeof result>, TResult2 = never>(
      onfulfilled?: ((value: ReturnType<typeof result>) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) {
      return Promise.resolve(result()).then(onfulfilled, onrejected);
    },
  };
  return query;
}

describe('loadCheckoutOrder', () => {
  it('uses immutable order-item snapshots for provider checkout copy', async () => {
    const records: QueryRecord[] = [];
    const orderId = '7ad4c967-3d48-44da-a665-64731ac33f62';
    const userId = '1cc4d399-8e70-4f06-979d-8fb0f9c43fde';
    const rowsByTable = {
      orders: [{
        id: orderId,
        user_id: userId,
        status: 'pending',
        total: 30000,
        shipping_fee: 3000,
        address: {
          recipientName: '팬',
          phone: '01012345678',
          postalCode: '04799',
          address1: '서울 성동구',
          address2: '',
          deliveryNote: '',
        },
        expires_at: '2026-07-14T07:00:00.000Z',
        created_at: '2026-07-14T06:45:00.000Z',
      }],
      order_items: [{
        order_id: orderId,
        good_id: 'goods-1',
        qty: 1,
        unit_price: 27000,
        good_name_snapshot: '주문 당시 이름',
        good_type_snapshot: '아크릴',
      }],
      payments: [],
      goods: [{ id: 'goods-1', name: '나중에 바뀐 이름', type: '변경됨' }],
    };
    mocks.client = {
      from(table: string) {
        return createQuery(table, records, rowsByTable);
      },
    };

    const order = await loadCheckoutOrder(userId, orderId);

    expect(order?.items).toEqual([{
      goodId: 'goods-1',
      name: '주문 당시 이름',
      type: '아크릴',
      qty: 1,
      unitPrice: 27000,
    }]);
    expect(records.find((record) => record.table === 'order_items')?.select)
      .toBe('good_id,qty,unit_price,good_name_snapshot,good_type_snapshot');
    expect(records.some((record) => record.table === 'goods')).toBe(false);
  });

  it('carries the server-confirmed shipping fee snapshot into the payment screen', async () => {
    const records: QueryRecord[] = [];
    const orderId = '7ad4c967-3d48-44da-a665-64731ac33f62';
    const userId = '1cc4d399-8e70-4f06-979d-8fb0f9c43fde';
    mocks.client = {
      from(table: string) {
        return createQuery(table, records, {
          orders: [{
            id: orderId,
            user_id: userId,
            status: 'pending',
            total: 18000,
            shipping_fee: 3000,
            address: null,
            expires_at: null,
            created_at: '2026-08-07T06:45:00.000Z',
          }],
          order_items: [],
          payments: [],
        });
      },
    };

    const order = await loadCheckoutOrder(userId, orderId);

    expect(order?.total).toBe(18000);
    expect(order?.shippingFee).toBe(3000);
  });

  it('reads legacy orders without a shipping fee snapshot as free shipping', async () => {
    const records: QueryRecord[] = [];
    const orderId = '7ad4c967-3d48-44da-a665-64731ac33f62';
    const userId = '1cc4d399-8e70-4f06-979d-8fb0f9c43fde';
    mocks.client = {
      from(table: string) {
        return createQuery(table, records, {
          orders: [{
            id: orderId,
            user_id: userId,
            status: 'pending',
            total: 27000,
            shipping_fee: null,
            address: null,
            expires_at: null,
            created_at: '2026-08-07T06:45:00.000Z',
          }],
          order_items: [],
          payments: [],
        });
      },
    };

    await expect(loadCheckoutOrder(userId, orderId)).resolves.toMatchObject({ shippingFee: 0 });
  });
});
