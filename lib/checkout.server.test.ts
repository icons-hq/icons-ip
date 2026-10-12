import { describe, expect, it, vi } from 'vitest';
import { loadCheckoutOrder, loadLatestCardPaymentResultFocus } from './checkout.server';

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  serviceClient: null as unknown,
}));

vi.mock('./supabase/server', () => ({ createClient: () => mocks.client }));
vi.mock('./supabase/service', () => ({ createServiceClient: () => mocks.serviceClient }));

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
    in() { return query; },
    gte() { return query; },
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
        id: 'item-1',
        order_id: orderId,
        good_id: 'goods-1',
        variant_id: '00000000-0000-4000-8000-000000000001',
        variant_name_snapshot: '파랑',
        variant_code_snapshot: 'BLUE',
        qty: 1,
        unit_price: 27000,
        good_name_snapshot: '주문 당시 이름',
        good_type_snapshot: '아크릴',
      }],
      payment_summaries: [],
      goods: [{ id: 'goods-1', name: '나중에 바뀐 이름', type: '변경됨' }],
    };
    mocks.client = {
      from(table: string) {
        return createQuery(table, records, rowsByTable);
      },
    };
    mocks.serviceClient = mocks.client;

    const order = await loadCheckoutOrder(userId, orderId);

    expect(order?.items).toEqual([{
      id: 'item-1',
      goodId: 'goods-1',
      variantId: '00000000-0000-4000-8000-000000000001',
      variantName: '파랑',
      variantCode: 'BLUE',
      name: '주문 당시 이름',
      type: '아크릴',
      qty: 1,
      unitPrice: 27000,
      supplySource: 'stock',
      preorderExpectedShipDate: null,
    }]);
    expect(records.find((record) => record.table === 'order_items')?.select)
      .toBe('id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,variant_id,variant_name_snapshot,variant_code_snapshot,supply_source,preorder_expected_ship_date');
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
          payment_summaries: [],
        });
      },
    };
    mocks.serviceClient = mocks.client;

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
          payment_summaries: [],
        });
      },
    };
    mocks.serviceClient = mocks.client;

    await expect(loadCheckoutOrder(userId, orderId)).resolves.toMatchObject({ shippingFee: 0 });
  });

  it.each(['confirming', 'unknown', 'needs_review'])(
    '%s payment attempt는 결제 원장 행이 아직 없어도 checking으로 합성한다',
    async (state) => {
      const records: QueryRecord[] = [];
      const serviceRecords: QueryRecord[] = [];
      const orderId = '7ad4c967-3d48-44da-a665-64731ac33f62';
      const userId = '1cc4d399-8e70-4f06-979d-8fb0f9c43fde';
      const rowsByTable = {
        orders: [{
          id: orderId,
          user_id: userId,
          status: 'pending',
          total: 31000,
          shipping_fee: 3000,
          address: null,
          expires_at: '2026-08-14T10:00:00.000Z',
          created_at: '2026-08-14T09:45:00.000Z',
        }],
        order_items: [],
        payment_summaries: [],
      };
      mocks.client = {
        from(table: string) {
          return createQuery(table, records, rowsByTable);
        },
      };
      mocks.serviceClient = {
        from(table: string) {
          return createQuery(table, serviceRecords, {
            payment_attempts: [{
              user_id: userId,
              purpose: 'order',
              ref_id: orderId,
              state,
              created_at: '2026-08-14T09:46:00.000Z',
            }],
          });
        },
      };

      await expect(loadCheckoutOrder(userId, orderId)).resolves.toMatchObject({
        paymentStatus: 'pending',
      });
      expect(serviceRecords.find((record) => record.table === 'payment_attempts')).toMatchObject({
        select: 'state,expires_at,provider',
        eq: [
          ['user_id', userId],
          ['purpose', 'order'],
          ['ref_id', orderId],
        ],
      });
    },
  );

  it('결제 시도 상태·만료·provider와 처리 중인 취소 요청을 스냅샷에 싣는다', async () => {
    const orderId = '7ad4c967-3d48-44da-a665-64731ac33f62';
    const userId = '1cc4d399-8e70-4f06-979d-8fb0f9c43fde';
    const records: QueryRecord[] = [];
    mocks.client = {
      from(table: string) {
        return createQuery(table, records, {
          orders: [{
            id: orderId,
            user_id: userId,
            status: 'pending',
            total: 31000,
            shipping_fee: 3000,
            address: null,
            expires_at: '2026-10-12T05:15:00.000Z',
            created_at: '2026-10-12T05:00:00.000Z',
          }],
          order_items: [],
          payment_summaries: [],
          order_cancellation_requests: [{ order_id: orderId, status: 'requested' }],
        });
      },
    };
    mocks.serviceClient = {
      from(table: string) {
        return createQuery(table, [], {
          payment_attempts: [{
            user_id: userId,
            purpose: 'order',
            ref_id: orderId,
            state: 'declined',
            expires_at: '2026-10-12T05:10:00.000Z',
            provider: 'toss',
          }],
        });
      },
    };

    await expect(loadCheckoutOrder(userId, orderId)).resolves.toMatchObject({
      paymentStatus: null,
      paymentAttempt: { state: 'declined', expiresAt: '2026-10-12T05:10:00.000Z', provider: 'toss' },
      hasActiveCancellationRequest: true,
    });
    expect(records.find((record) => record.table === 'order_cancellation_requests')).toMatchObject({
      select: 'status',
      eq: [['order_id', orderId]],
    });
  });

  it('결제 시도와 취소 요청이 없으면 비워 둔다', async () => {
    const orderId = '7ad4c967-3d48-44da-a665-64731ac33f62';
    const userId = '1cc4d399-8e70-4f06-979d-8fb0f9c43fde';
    mocks.client = {
      from(table: string) {
        return createQuery(table, [], {
          orders: [{
            id: orderId,
            user_id: userId,
            status: 'pending',
            total: 31000,
            shipping_fee: 3000,
            address: null,
            expires_at: '2026-10-12T05:15:00.000Z',
            created_at: '2026-10-12T05:00:00.000Z',
          }],
        });
      },
    };
    mocks.serviceClient = mocks.client;

    await expect(loadCheckoutOrder(userId, orderId)).resolves.toMatchObject({
      paymentAttempt: null,
      hasActiveCancellationRequest: false,
    });
  });
});

describe('loadLatestCardPaymentResultFocus', () => {
  const orderId = '7ad4c967-3d48-44da-a665-64731ac33f62';
  const userId = '1cc4d399-8e70-4f06-979d-8fb0f9c43fde';
  const now = Date.parse('2026-10-12T05:20:00.000Z');

  it('최근 토스 결제 시도와 본인 주문을 읽어 실제 결과를 고른다', async () => {
    const serviceRecords: QueryRecord[] = [];
    mocks.serviceClient = {
      from(table: string) {
        return createQuery(table, serviceRecords, {
          payment_attempts: [{
            user_id: userId,
            purpose: 'order',
            provider: 'toss',
            ref_id: orderId,
            state: 'prepared',
            expires_at: '2026-10-12T05:10:00.000Z',
          }],
        });
      },
    };
    const records: QueryRecord[] = [];
    mocks.client = {
      from(table: string) {
        return createQuery(table, records, {
          orders: [{ id: orderId, user_id: userId, status: 'pending' }],
          payment_summaries: [],
        });
      },
    };

    await expect(loadLatestCardPaymentResultFocus(userId, now)).resolves.toEqual({
      orderId,
      outcome: 'attempt_expired',
    });
    expect(serviceRecords[0]).toMatchObject({
      table: 'payment_attempts',
      eq: [['user_id', userId], ['purpose', 'order'], ['provider', 'toss']],
    });
    expect(records.find((record) => record.table === 'orders')?.eq).toEqual([
      ['id', orderId],
      ['user_id', userId],
    ]);
  });

  it('최근 결제 시도나 본인 주문이 없으면 쿼리 기본 안내에 맡긴다', async () => {
    mocks.serviceClient = { from: (table: string) => createQuery(table, [], {}) };
    mocks.client = { from: (table: string) => createQuery(table, [], {}) };
    await expect(loadLatestCardPaymentResultFocus(userId, now)).resolves.toBeNull();

    mocks.serviceClient = {
      from: (table: string) => createQuery(table, [], {
        payment_attempts: [{ user_id: userId, purpose: 'order', provider: 'toss', ref_id: orderId, state: 'declined', expires_at: null }],
      }),
    };
    await expect(loadLatestCardPaymentResultFocus(userId, now)).resolves.toBeNull();
  });
});

