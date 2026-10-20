import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCheckoutOrder } from './checkout.server';
import { transactionActor, transactionDisplay, transactionInput, transactionLineId, transactionOrder, transactionQuoteId } from '@/test/fixtures/cart-transaction';

const mocks = vi.hoisted(() => ({
  client: null as unknown,
  serviceClient: null as unknown,
  gift: vi.fn(),
}));

vi.mock('./supabase/server', () => ({ createClient: () => mocks.client }));
vi.mock('./supabase/service', () => ({ createServiceClient: () => mocks.serviceClient }));
vi.mock('./gifts-order.server', () => ({ loadGiftCheckoutOrder: mocks.gift }));
beforeEach(() => { mocks.gift.mockReset().mockResolvedValue({ kind: 'ordinary' }); });

interface QueryRecord {
  table: string;
  select?: string;
  eq: [string, unknown][];
  afterId?:string;
  limit?:number;
}

function createQuery(
  table: string,
  records: QueryRecord[],
  rowsByTable: Record<string, Record<string, unknown>[]>,
) {
  const record: QueryRecord = { table, eq: [] };
  records.push(record);

  const result = () => {
    let rows = (rowsByTable[table] ?? []).map((row,index)=>table==='order_items'?{...row,id:row.id??String(index).padStart(12,'0')}:row);
    for (const [column, value] of record.eq) rows = rows.filter((row) => row[column] === value);
    rows=rows.filter(row=>record.afterId===undefined||String(row.id)>record.afterId);
    rows.sort((left,right)=>String(left.id).localeCompare(String(right.id)));
    return { data: rows.slice(0,Math.min(record.limit??1000,1000)), error: null, count:rows.length };
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
    order() {
      return query;
    },
    gt(_column:string,value:string){record.afterId=value;return query;},
    limit(value:number) { record.limit=value;return query; },
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
      .toBe('id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,variant_id,variant_name_snapshot,variant_code_snapshot,custom_inputs_snapshot,supply_source,preorder_expected_ship_date');
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
        select: 'state',
        eq: [
          ['user_id', userId],
          ['purpose', 'order'],
          ['ref_id', orderId],
        ],
      });
    },
  );
});

it('같은 옵션의 1001개 주문 문구를 결제 준비 화면에서 모두 읽는다',async()=>{
  const records:QueryRecord[]=[];
  const orderId='7ad4c967-3d48-44da-a665-64731ac33f62',userId='1cc4d399-8e70-4f06-979d-8fb0f9c43fde';
  const rows:Record<string,Record<string,unknown>[]>={orders:[{id:orderId,user_id:userId,status:'pending',total:1001000,address:{},created_at:'2026-10-12T00:00:00Z',payment_method:'bank_transfer'}],
    order_items:Array.from({length:1001},(_,index)=>({id:String(index).padStart(12,'0'),order_id:orderId,good_id:'g1',qty:1,unit_price:1000,good_name_snapshot:'각인 상품',good_type_snapshot:'문구',variant_id:'00000000-0000-4000-8000-000000000001',
      custom_inputs_snapshot:{revision:1,fields:[{id:'00000000-0000-4000-8000-000000063311',name:'문구',value:`입력 ${index}`}]}}))};
  mocks.client={from:(table:string)=>createQuery(table,records,rows)};mocks.serviceClient=mocks.client;
  const result=await loadCheckoutOrder(userId,orderId);
  expect(result?.items).toHaveLength(1001);
  expect(result?.items.at(-1)?.customInputs?.fields[0].value).toBe('입력 1000');
  expect(records.filter(record=>record.table==='order_items')).toHaveLength(3);
});

it('선물 전용 안전 조회 실패·권한 없음은 원본 주문 테이블로 우회하지 않는다', async () => {
  const from = vi.fn(); mocks.client = { from }; mocks.serviceClient = { from };
  mocks.gift.mockResolvedValueOnce({ kind: 'unavailable' });
  expect(await loadCheckoutOrder(transactionActor, transactionOrder)).toBeNull();
  mocks.gift.mockRejectedValueOnce(new Error('bad projection'));
  expect(await loadCheckoutOrder(transactionActor, transactionOrder)).toBeNull(); expect(from).not.toHaveBeenCalled();
  const safe = { id: transactionOrder, giftId: transactionQuoteId, address: null, transaction: transactionDisplay };
  mocks.gift.mockResolvedValueOnce({ kind: 'gift', order: safe });
  expect(await loadCheckoutOrder(transactionActor, transactionOrder)).toBe(safe); expect(from).not.toHaveBeenCalled();
});

it('신규 주문은 저장된 온라인·착불·할인·품목 원장과 일치하는 영수증만 보여준다', async () => {
  const records: QueryRecord[] = [], totals = transactionDisplay.totals;
  const rows: Record<string, Record<string, unknown>[]> = {
    orders: [{ id: transactionOrder, user_id: transactionActor, status: 'pending', total: totals.onlineTotal, shipping_fee: totals.prepaidShippingTotal,
      discount_total: totals.couponDiscountTotal, store_credit_total: totals.storeCreditTotal, volume_discount_total: totals.volumeDiscountTotal,
      shipping_collect_total: totals.collectShippingTotal, calculation_version: 2, address: transactionInput.address, created_at: '2026-10-14T03:00:00Z' }],
    order_items: [{ id: transactionLineId, order_id: transactionOrder, good_id: transactionInput.items[0].goodId, variant_id: transactionInput.items[0].variantId,
      qty: 2, unit_price: 10000, good_name_snapshot: '굿즈', good_type_snapshot: '피규어' }],
  };
  const rpc = vi.fn().mockResolvedValue({ data: { orderId: transactionOrder, quoteId: transactionQuoteId, display: transactionDisplay }, error: null });
  mocks.client = { from: (table: string) => createQuery(table, records, rows), rpc }; mocks.serviceClient = mocks.client;
  expect(await loadCheckoutOrder(transactionActor, transactionOrder)).toMatchObject({ transaction: transactionDisplay, total: 16000 });
  expect(rpc).toHaveBeenCalledWith('get_my_goods_transaction_receipt', { p_order_id: transactionOrder });
  rows.order_items[0].good_id = 'renamed-product-code';
  expect(await loadCheckoutOrder(transactionActor, transactionOrder)).toMatchObject({ transaction: transactionDisplay });
  rows.orders[0].shipping_collect_total = 0;
  expect(await loadCheckoutOrder(transactionActor, transactionOrder)).toBeNull();
  rows.orders[0].shipping_collect_total = 3000; rows.order_items[0].qty = 3;
  expect(await loadCheckoutOrder(transactionActor, transactionOrder)).toBeNull();
  rows.order_items[0].qty = 2; rpc.mockResolvedValueOnce({ data: null, error: null });
  expect(await loadCheckoutOrder(transactionActor, transactionOrder)).toBeNull();
});
