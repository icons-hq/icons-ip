import { describe, expect, it, vi } from 'vitest';
import {
  loadCheckoutOrder,
  loadLatestCardPaymentResultFocus,
  loadPendingCardPaymentReading,
} from './checkout.server';

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
  in?: [string, unknown[]][];
  order?: [string, boolean][];
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
    for (const [column, values] of record.in ?? []) rows = rows.filter((row) => values.includes(row[column]));
    const orderBy = record.order ?? [];
    if (orderBy.length) {
      rows = [...rows].sort((left, right) => {
        for (const [column, ascending] of orderBy) {
          const a = String(left[column] ?? '');
          const b = String(right[column] ?? '');
          if (a !== b) return (a < b ? -1 : 1) * (ascending ? 1 : -1);
        }
        return 0;
      });
    }
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
    in(column: string, values: unknown[]) {
      record.in = [...(record.in ?? []), [column, values]];
      return query;
    },
    gte() { return query; },
    order(column: string, options?: { ascending?: boolean }) {
      record.order = [...(record.order ?? []), [column, options?.ascending ?? true]];
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

  /* 결제창을 열어 둔 채 다른 주문을 새로 준비하면 만든 시각이 가장 늦은 시도는 그 다른
     주문이다. 콜백이 방금 처리한 시도(갱신 시각이 가장 늦은 시도)를 짚어야 승인된 결제를
     '결제가 완료되지 않았어요'로 덮지 않는다(E-2). */
  it('만든 시각이 아니라 가장 최근에 바뀐 시도를 고른다', async () => {
    const otherOrderId = '9e2f0c4b-5d1a-4c7e-8b3f-2a6d9e1c4b70';
    const serviceRecords: QueryRecord[] = [];
    mocks.serviceClient = {
      from(table: string) {
        return createQuery(table, serviceRecords, {
          payment_attempts: [
            {
              user_id: userId, purpose: 'order', provider: 'toss', ref_id: orderId, state: 'approved',
              expires_at: '2026-10-12T05:20:00.000Z',
              created_at: '2026-10-12T05:10:00.000Z', updated_at: '2026-10-12T05:19:30.000Z',
            },
            {
              user_id: userId, purpose: 'order', provider: 'toss', ref_id: otherOrderId, state: 'prepared',
              expires_at: '2026-10-12T05:25:00.000Z',
              created_at: '2026-10-12T05:15:00.000Z', updated_at: '2026-10-12T05:15:00.000Z',
            },
          ],
        });
      },
    };
    mocks.client = {
      from(table: string) {
        return createQuery(table, [], {
          orders: [
            { id: orderId, user_id: userId, status: 'paid' },
            { id: otherOrderId, user_id: userId, status: 'pending' },
          ],
          payment_summaries: [{ purpose: 'order', ref_id: orderId, status: 'paid' }],
        });
      },
    };

    await expect(loadLatestCardPaymentResultFocus(userId, now)).resolves.toEqual({
      orderId,
      outcome: 'approved',
    });
    expect(serviceRecords[0]?.order?.[0]).toEqual(['updated_at', false]);
  });

  /* 처리 중인 취소 요청이 있으면 claim이 결제를 막는다. 그 주문에 '같은 주문에서 다시
     시도'를 약속하면 결제 화면의 '결제를 진행할 수 없어요'와 모순된다(E-3). */
  it('처리 중인 취소 요청을 함께 읽어 재시도를 약속하지 않는다', async () => {
    mocks.serviceClient = {
      from: (table: string) => createQuery(table, [], {
        payment_attempts: [{
          user_id: userId, purpose: 'order', provider: 'toss', ref_id: orderId, state: 'prepared',
          expires_at: '2026-10-12T05:25:00.000Z',
        }],
      }),
    };
    const records: QueryRecord[] = [];
    const rows: Record<string, Record<string, unknown>[]> = {
      orders: [{ id: orderId, user_id: userId, status: 'pending' }],
      payment_summaries: [],
      order_cancellation_requests: [{ order_id: orderId, status: 'requested' }],
    };
    mocks.client = { from: (table: string) => createQuery(table, records, rows) };

    await expect(loadLatestCardPaymentResultFocus(userId, now)).resolves.toEqual({
      orderId,
      outcome: 'cancellation_requested',
    });
    expect(records.find((record) => record.table === 'order_cancellation_requests')).toMatchObject({
      eq: [['order_id', orderId]],
      in: [['status', ['requested', 'processing', 'needs_review']]],
    });

    rows.order_cancellation_requests = [{ order_id: orderId, status: 'completed' }];
    await expect(loadLatestCardPaymentResultFocus(userId, now)).resolves.toEqual({
      orderId,
      outcome: 'retryable',
    });
  });

  /* 승인을 기다리는 사이 취소를 요청했다(C race 케이스 A). finalizer가 결제 원장을 paid로
     남기고 주문은 pending, 요청은 processing으로 둔다 — 자동 결제 취소가 실패하면
     needs_review다. 확인 중이 아니라 결제 취소 진행이다(INT-5). */
  it('승인된 결제와 처리 중인 취소 요청을 읽어 결제 취소 진행으로 고른다', async () => {
    mocks.serviceClient = {
      from: (table: string) => createQuery(table, [], {
        payment_attempts: [{
          user_id: userId, purpose: 'order', provider: 'toss', ref_id: orderId, state: 'approved',
          expires_at: '2026-10-12T05:25:00.000Z',
        }],
      }),
    };
    const rows: Record<string, Record<string, unknown>[]> = {
      orders: [{ id: orderId, user_id: userId, status: 'pending' }],
      payment_summaries: [{ purpose: 'order', ref_id: orderId, status: 'paid' }],
      order_cancellation_requests: [{ order_id: orderId, status: 'processing' }],
    };
    mocks.client = { from: (table: string) => createQuery(table, [], rows) };

    await expect(loadLatestCardPaymentResultFocus(userId, now)).resolves.toEqual({
      orderId,
      outcome: 'refund_in_progress',
    });

    rows.order_cancellation_requests = [{ order_id: orderId, status: 'needs_review' }];
    await expect(loadLatestCardPaymentResultFocus(userId, now)).resolves.toEqual({
      orderId,
      outcome: 'refund_in_progress',
    });

    rows.orders = [{ id: orderId, user_id: userId, status: 'canceled' }];
    rows.payment_summaries = [{ purpose: 'order', ref_id: orderId, status: 'refunded' }];
    rows.order_cancellation_requests = [{ order_id: orderId, status: 'completed' }];
    await expect(loadLatestCardPaymentResultFocus(userId, now)).resolves.toEqual({
      orderId,
      outcome: 'refunded',
    });
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

/* 주문 상세가 결제 화면과 같은 결제 국면을 말하도록 결제 시도 원장을 더 읽는다(QA-2). */
describe('loadPendingCardPaymentReading', () => {
  const orderId = '1c8acc37-ad7c-463c-b5c6-567b83d6176b';
  const userId = '1cc4d399-8e70-4f06-979d-8fb0f9c43fde';
  const now = Date.parse('2026-10-12T05:12:00.000Z');
  const order = {
    id: orderId,
    status: 'pending',
    paymentMethod: 'card' as const,
    expiresAt: '2026-10-12T05:15:00.000Z',
    ledgerPaymentStatus: null,
    cancellationRequestStatus: null,
  };

  it('승인 거절된 본인 결제 시도를 읽어 닫힌 결제로 판독한다', async () => {
    const serviceRecords: QueryRecord[] = [];
    mocks.serviceClient = {
      from: (table: string) => createQuery(table, serviceRecords, {
        payment_attempts: [{
          user_id: userId,
          purpose: 'order',
          ref_id: orderId,
          state: 'declined',
          expires_at: '2026-10-12T05:10:00.000Z',
          provider: 'toss',
          created_at: '2026-10-12T05:00:00.000Z',
        }],
      }),
    };

    await expect(loadPendingCardPaymentReading(userId, order, now)).resolves.toEqual({
      state: 'payment_closed',
      closure: 'not_approved',
      reorderMode: 'cancel_then_reorder',
      provider: 'toss',
    });
    expect(serviceRecords[0]).toMatchObject({
      table: 'payment_attempts',
      eq: [['user_id', userId], ['purpose', 'order'], ['ref_id', orderId]],
    });
  });

  it('처리 중인 취소 요청과 확인 중 시도를 결제 화면과 같이 반영한다', async () => {
    mocks.serviceClient = {
      from: (table: string) => createQuery(table, [], {
        payment_attempts: [{ user_id: userId, purpose: 'order', ref_id: orderId, state: 'prepared', expires_at: '2026-10-12T05:20:00.000Z', provider: 'toss' }],
      }),
    };
    await expect(loadPendingCardPaymentReading(userId, { ...order, cancellationRequestStatus: 'requested' }, now))
      .resolves.toMatchObject({ state: 'payment_closed', closure: 'cancellation_requested' });
    await expect(loadPendingCardPaymentReading(userId, { ...order, cancellationRequestStatus: 'completed' }, now))
      .resolves.toMatchObject({ state: 'payable' });

    mocks.serviceClient = {
      from: (table: string) => createQuery(table, [], {
        payment_attempts: [{ user_id: userId, purpose: 'order', ref_id: orderId, state: 'confirming', expires_at: null, provider: 'toss' }],
      }),
    };
    await expect(loadPendingCardPaymentReading(userId, order, now)).resolves.toMatchObject({ state: 'checking' });
  });

  it('결제 대기 카드 주문이 아니면 원장을 읽지 않고, 읽지 못하면 단정하지 않는다', async () => {
    const serviceRecords: QueryRecord[] = [];
    mocks.serviceClient = { from: (table: string) => createQuery(table, serviceRecords, {}) };
    await expect(loadPendingCardPaymentReading(userId, { ...order, status: 'paid' }, now)).resolves.toBeNull();
    await expect(loadPendingCardPaymentReading(userId, { ...order, paymentMethod: 'bank_transfer' }, now)).resolves.toBeNull();
    expect(serviceRecords).toHaveLength(0);

    mocks.serviceClient = {
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
        }) }) }) }) }) }),
      }),
    };
    await expect(loadPendingCardPaymentReading(userId, order, now)).resolves.toBeNull();
  });
});
