import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadOrderDetail, loadOrders } from './orders.server';
import { myOrderItemsFixture } from './orders/my-order-items.fixture';
import { transactionDisplay, transactionLineId, transactionQuoteId } from '@/test/fixtures/cart-transaction';

const mocks = vi.hoisted(() => ({ client: null as unknown, gift: vi.fn(), giftList: vi.fn(), giftDetail: vi.fn(), retrySources: vi.fn() }));

vi.mock('./gifts-order.server', () => ({ loadGiftCheckoutOrder: mocks.gift }));
vi.mock('./gifts-order-detail.server', () => ({ loadGiftOrderList: mocks.giftList, loadGiftOrderDetail: mocks.giftDetail }));
/* 다시 결제 진입의 출처(QA1 S-D2-15)는 보류 원장을 서비스 롤로 읽는다 — 여기서는 주입한다. */
vi.mock('./checkout.server', () => ({ loadOrderRetrySources: mocks.retrySources }));
beforeEach(() => { mocks.gift.mockReset().mockResolvedValue({ kind: 'ordinary' }); mocks.giftList.mockReset().mockResolvedValue([]); mocks.giftDetail.mockReset();
  mocks.retrySources.mockReset().mockResolvedValue(new Map()); });
vi.mock('@/lib/supabase/server', () => ({ createClient: () => mocks.client }));
/* 품목 줄 보강의 19금 판정(MD-0036)은 인증 요청 범위가 필요하다 — 여기서는 주입한다. */
vi.mock('@/lib/adult-goods-access.server', () => ({ getAdultGoodsAccess: async () => 'full' }));
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
type QueryResult = { data: Row[] | Row | null; error: { message: string } | null; count?:number|null };

interface QueryRecord {
  table: string;
  /** 마스킹 RPC(my_order_items)로 읽었으면 그 이름. */
  rpc?: string;
  select?: string;
  eq: [string, unknown][];
  in: [string, unknown[]][];
  order: [string, { ascending?: boolean } | undefined][];
  limit?: number;
  afterId?:string;
  maybeSingle: boolean;
}

interface ClientOptions {
  /** get_my_goods_transaction_receipt가 돌려줄 값. 없으면 null(영수증 없음). */
  receipt?: unknown;
  rpcCalls?: string[];
  claimEligibility?: unknown;
  reshipmentParcels?: unknown;
  eligibilityError?: boolean;
  errors?: Partial<Record<string, string>>;
  records: QueryRecord[];
  rows: Record<string, Row[]>;
}

/* 고객 세션에서 order_items 를 직접 읽으면 랜덤 배정 행은 restrictive RLS(random_items_private_read)로 빠진다.
   마스킹 RPC(my_order_items)는 랜덤 행을 주문·굿즈 한 줄로 합치고 옵션을 가린다 — 이 흉내가 그 차이를 재현한다. */

function createQuery(table: string, options: ClientOptions, initial: Partial<QueryRecord> = {}) {
  const record: QueryRecord = {
    table,
    eq: [],
    in: [],
    order: [],
    maybeSingle: false,
    ...initial,
  };
  options.records.push(record);

  const resolve = (): QueryResult => {
    const message = options.errors?.[table];
    if (message) return { data: null, error: { message } };

    let rows = (options.rows[table] ?? []).map((row,index)=>table==='order_items'?{...row,id:row.id??String(index).padStart(12,'0')}:row);
    if (table === 'order_items') {
      rows = record.rpc === 'my_order_items' ? myOrderItemsFixture(rows) : rows.filter((row) => row.option_sale_mode_snapshot !== 'random');
    }
    for (const [column, value] of record.eq) rows = rows.filter((row) => row[column] === value);
    for (const [column, values] of record.in) rows = rows.filter((row) => values.includes(row[column]));
    for (const [column, settings] of record.order) {
      rows.sort((left, right) => {
        const direction = settings?.ascending === false ? -1 : 1;
        return direction * String(left[column] ?? '').localeCompare(String(right[column] ?? ''));
      });
    }
    rows=rows.filter(row=>record.afterId===undefined||String(row.id)>record.afterId);
    const count=rows.length;
    rows=rows.slice(0,Math.min(record.limit??1000,1000));

    return { data: record.maybeSingle ? rows[0] ?? null : rows, error: null, count };
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
    gt(_column:string,value:string){record.afterId=value;return query;},
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
    rpc: vi.fn().mockImplementation((name: string, args?: { p_order_ids?: string[]; p_good_ids?: string[] }) => { options.rpcCalls?.push(name); return name === 'my_order_items'
      ? createQuery('order_items', options, { rpc: name, in: [['order_id', args?.p_order_ids ?? []]] })
      /* 품목 줄 보강의 굿즈 값은 본인 주문 RPC(my_order_line_goods)로 읽는다 — goods 공개 읽기는 내려간 굿즈를 열지 않는다. */
      : name === 'my_order_line_goods' ? createQuery('goods', options, { rpc: name, in: [['id', args?.p_good_ids ?? []]] })
      /* 배치 표시값 RPC(my_order_item_display): PostgREST가 `id:item_id`로 별칭해 주는 행을 id 커서로 페이지한다. */
      : name === 'my_order_item_display' ? createQuery('item_display', options, { rpc: name })
      : Promise.resolve(name === 'get_my_goods_transaction_receipt' ? { data: options.receipt ?? null, error: null }
        : name === 'get_my_order_claim_reshipment_items' ? { data: [], error: null }
        : name === 'get_my_order_claim_reshipments' ? { data: options.reshipmentParcels ?? [], error: null }
        : { data: options.claimEligibility ?? null, error: options.eligibilityError ? { message: 'unavailable' } : null }); }),
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
  /* QA1 S-D2-15: 결제 대기 카드 주문이 목록에서 숨어 결제 화면을 닫은 고객이 그 주문을 다시 찾지 못했다. */
  it('결제 대기 카드 주문도 기본 목록에 보이고, 다시 결제 진입의 출처를 붙인다', async () => {
    mocks.client=createClient({records:[],rows:{orders:[
      {id:orderId,user_id:userId,status:'pending',total:10000,created_at:'2026-09-28T00:00:00Z'},
      {id:'other',user_id:'other-user',status:'pending',total:10000,created_at:'2026-09-28T00:00:00Z'},
    ],order_items:[]}});
    const retry = { source: 'cart', awaitingPayment: true, paymentUnresolved: false, baseGoodId: null, retryOrderId: null };
    mocks.retrySources.mockResolvedValue(new Map([[orderId, retry]]));
    expect(await loadOrders(userId,{includePending:true})).toMatchObject([{id:orderId,status:'pending',retry}]);
    expect(await loadOrders(userId)).toMatchObject([{id:orderId,status:'pending',paymentMethod:'card',retry}]);
    expect(mocks.retrySources).toHaveBeenLastCalledWith(userId, [orderId]);
  });

  it('결제한 주문·무통장 주문은 다시 결제 출처를 묻지 않는다', async () => {
    mocks.client=createClient({records:[],rows:{orders:[
      {id:orderId,user_id:userId,status:'paid',total:10000,created_at:'2026-09-28T00:00:00Z'},
      {id:'8be5d078-4e59-4f8b-a776-75842bd44073',user_id:userId,status:'pending',total:10000,created_at:'2026-09-27T00:00:00Z',payment_method:'bank_transfer'},
    ],order_items:[]}});
    expect(await loadOrders(userId)).toMatchObject([{id:orderId,retry:null},{retry:null}]);
    expect(mocks.retrySources).toHaveBeenLastCalledWith(userId, []);
  });
  it('무통장 입금 대기 주문은 접수 = 주문 완료라 기본 목록에도 보인다(ADR-0026)', async () => {
    mocks.client=createClient({records:[],rows:{orders:[
      {id:orderId,user_id:userId,status:'pending',total:10000,created_at:'2026-09-28T00:00:00Z',payment_method:'bank_transfer'},
    ],order_items:[]}});
    expect(await loadOrders(userId)).toMatchObject([{id:orderId,status:'pending',paymentMethod:'bank_transfer'}]);
  });
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
      paymentMethod: 'card',
      claim: null,
      retry: null,
    }]);

    expect(records.find((record) => record.table === 'orders')).toMatchObject({
      select: 'id,order_number,user_id,status,total,created_at,payment_method',
      eq: [['user_id', userId]],
      in: [['status', ['pending', 'paid', 'confirmed', 'shipping', 'delivered', 'done', 'canceled']]],
      order: [['created_at', { ascending: false }], ['id', { ascending: false }]],
    });
    expect(records.find((record) => record.table === 'order_items')).toMatchObject({
      rpc: 'my_order_items',
      select: 'id,order_id,good_id,qty,unit_price,good_name_snapshot,option_sale_mode',
      in: [['order_id', [orderId]]],
    });
  });

  it('throws on query failures instead of rendering a false empty state', async () => {
    mocks.client = createClient({ records: [], rows: {}, errors: { orders: 'network unavailable' } });
    await expect(loadOrders(userId)).rejects.toThrow('Failed to load orders');
  });

  it('keeps a pending order visible when it has a durable cancellation request', async () => {
    const records: QueryRecord[] = [];
    const pendingOrderId = '8be5d078-4e59-4f8b-a776-75842bd44073';
    mocks.client = createClient({
      records,
      rows: {
        orders: [
          { id: orderId, user_id: userId, status: 'paid', total: 54000, created_at: '2026-07-14T06:00:00.000Z' },
          { id: pendingOrderId, user_id: userId, status: 'pending', total: 32000, created_at: '2026-07-14T07:00:00.000Z' },
        ],
        order_cancellation_requests: [{ order_id: pendingOrderId, claim_type: 'cancel', stage: 'requested', requested_at: '2026-07-14T07:01:00.000Z' }],
        order_items: [
          { order_id: orderId, qty: 1, good_name_snapshot: '완료 주문 굿즈' },
          { order_id: pendingOrderId, qty: 1, good_name_snapshot: '취소 확인 중 굿즈' },
        ],
      },
    });

    await expect(loadOrders(userId)).resolves.toEqual([
      {
        id: pendingOrderId,
        status: 'pending',
        total: 32000,
        createdAt: '2026-07-14T07:00:00.000Z',
        itemLabel: '취소 확인 중 굿즈',
        itemCount: 1,
        paymentMethod: 'card',
        claim: { claimType: 'cancel', stage: 'requested' },
        retry: null,
      },
      {
        id: orderId,
        status: 'paid',
        total: 54000,
        createdAt: '2026-07-14T06:00:00.000Z',
        itemLabel: '완료 주문 굿즈',
        itemCount: 1,
        paymentMethod: 'card',
        claim: null,
        retry: null,
      },
    ]);
    expect(records.find((record) => record.table === 'order_cancellation_requests')).toMatchObject({
      select: 'order_id,claim_type,stage',
      in: [['order_id', [pendingOrderId, orderId]]],
      order: [['requested_at', { ascending: false }], ['id', { ascending: false }]],
    });
  });

  /* 운영자 계정은 RLS로 전체 클레임을 읽을 수 있다. 자기 /orders는 자기 주문 id의 클레임만 읽고,
     운영자가 접수한 클레임도 요청자와 무관하게 보인다(requested_by 필터 없음). */
  it('reads claims only for the viewer order ids without filtering by requester', async () => {
    const records: QueryRecord[] = [];
    const pendingOrderId = '8be5d078-4e59-4f8b-a776-75842bd44073';
    mocks.client = createClient({
      records,
      rows: {
        orders: [
          { id: orderId, user_id: userId, status: 'paid', total: 54000, created_at: '2026-07-14T06:00:00.000Z' },
          { id: pendingOrderId, user_id: userId, status: 'pending', total: 1000, created_at: '2026-07-14T05:00:00.000Z' },
          { id: 'someone-else', user_id: 'other-user', status: 'paid', total: 1000, created_at: '2026-07-14T07:00:00.000Z' },
        ],
        order_cancellation_requests: [
          { order_id: orderId, claim_type: 'cancel', stage: 'requested', requested_by: 'staff-id', requested_at: '2026-07-14T06:10:00.000Z' },
          { order_id: 'someone-else', claim_type: 'cancel', stage: 'requested', requested_at: '2026-07-14T07:10:00.000Z' },
        ],
        order_items: [{ order_id: orderId, qty: 1, good_name_snapshot: '굿즈' }],
      },
    });

    /* 결제 대기 카드 주문도 목록에 보인다(QA1 S-D2-15) — 다른 회원의 주문·클레임은 여전히 없다. */
    await expect(loadOrders(userId)).resolves.toMatchObject([{ id: orderId, claim: { claimType: 'cancel', stage: 'requested' } }, { id: pendingOrderId, claim: null }]);
    const claimQuery = records.find((record) => record.table === 'order_cancellation_requests');
    expect(claimQuery?.in.map(([column, ids]) => [column, [...ids].sort()])).toEqual([['order_id', [orderId, pendingOrderId].sort()]]);
    expect(claimQuery?.eq).toEqual([]);
  });

  /* 10/14 회의 S20 — 목록 배지는 상세와 같은 기준(가장 최근 클레임)으로 진행 중 클레임을 말한다. */
  it('carries the latest claim of each order so the list badge matches the detail header', async () => {
    mocks.client = createClient({
      records: [],
      rows: {
        orders: [{ id: orderId, user_id: userId, status: 'paid', total: 54000, created_at: '2026-07-14T06:00:00.000Z' }],
        order_cancellation_requests: [
          { order_id: orderId, claim_type: 'cancel', stage: 'rejected', requested_at: '2026-07-14T06:10:00.000Z' },
          { order_id: orderId, claim_type: 'cancel', stage: 'processing', requested_at: '2026-07-14T06:20:00.000Z' },
        ],
        order_items: [{ order_id: orderId, qty: 1, good_name_snapshot: '굿즈' }],
      },
    });

    await expect(loadOrders(userId)).resolves.toMatchObject([{ id: orderId, claim: { claimType: 'cancel', stage: 'processing' } }]);
  });
});

/* MD-0036: 주문내역 카드의 품목 줄. 읽기 열을 늘리는 건 withLines일 때만이고, 보강이 실패해도 목록은 스냅샷으로 남는다. */
describe('loadOrders withLines', () => {
  /* 굿즈 이미지 경로는 공개 미디어 URL로 바뀐다 — 프로젝트 URL이 있어야 URL이 만들어진다. */
  beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.test'); });
  afterEach(() => { vi.unstubAllEnvs(); });
  const lineRows = (extra: Record<string, unknown> = {}) => ({
    orders: [{ id: orderId, user_id: userId, status: 'paid', total: 54000, created_at: '2026-07-14T06:00:00.000Z', calculation_version: 1 }],
    order_items: [
      { id: 'item-1', order_id: orderId, good_id: 'g1', variant_id: 'v1', variant_name_snapshot: '파랑', qty: 2, unit_price: 18000, good_name_snapshot: '아크릴 스탠드' },
      { id: 'item-2', order_id: orderId, good_id: 'g2', variant_id: 'v-assigned-a', variant_name_snapshot: '실제 배정 옵션', cart_variant_id: 'v-base', option_sale_mode_snapshot: 'random', qty: 1, unit_price: 18000, good_name_snapshot: '랜덤 키링' },
      { id: 'item-3', order_id: orderId, good_id: 'g2', variant_id: 'v-assigned-b', variant_name_snapshot: '다른 배정 옵션', cart_variant_id: 'v-base', option_sale_mode_snapshot: 'random', qty: 1, unit_price: 18000, good_name_snapshot: '랜덤 키링' },
    ],
    goods: [
      { id: 'g1', ip_id: 'ip-1', image_path: 'goods/a.webp', bg: null, sale_restriction: 'none' },
      { id: 'g2', ip_id: 'ip-1', image_path: null, bg: 'linear-gradient(#111, #333)', sale_restriction: 'none' },
    ],
    ips: [{ id: 'ip-1', title: '홍실' }],
    ...extra,
  });

  it('모든 품목 줄에 IP명·썸네일을 붙이고, 읽기 열에 옵션을 더한다. 랜덤 판매 옵션은 마스킹 RPC 값 그대로다', async () => {
    const records: QueryRecord[] = [];
    mocks.client = createClient({ records, rows: lineRows() });

    const [order] = await loadOrders(userId, { withLines: true });

    expect(order.lines).toMatchObject([
      { key: 'item-1', name: '아크릴 스탠드', optionName: '파랑', qty: 2, ipName: '홍실', purchaseAmount: 36000, regularAmount: null,
        thumbnail: expect.stringContaining('goods/a.webp') },
      /* 같은 굿즈의 두 배정 행은 DB가 한 줄(수량 합계, 옵션명 '랜덤')로 합쳐 준다. */
      { key: 'item-2', name: '랜덤 키링', optionName: '랜덤', qty: 2, ipName: '홍실', purchaseAmount: 36000, thumbnail: 'linear-gradient(#111, #333)' },
    ]);
    expect(order.lines).toHaveLength(2);
    expect(JSON.stringify(order)).not.toMatch(/실제 배정 옵션|다른 배정 옵션|v-assigned/);
    expect(records.find((record) => record.table === 'orders')?.select).toBe('id,order_number,user_id,status,total,created_at,payment_method');
    expect(records.find((record) => record.table === 'order_items')?.select)
      .toBe('id,order_id,good_id,qty,unit_price,good_name_snapshot,option_sale_mode,variant_id,variant_name_snapshot');
    expect(records.find((record) => record.table === 'goods')).toMatchObject({ rpc: 'my_order_line_goods', in: [['id', ['g1', 'g2']]] });
    expect(records.find((record) => record.table === 'ips')?.in).toEqual([['id', ['ip-1']]]);
  });

  it('정가·복수구매 할인은 배치 RPC 한 번으로 읽어 구매가(복수구매 할인 반영)와 정가를 붙인다. 주문별 영수증 RPC는 부르지 않는다', async () => {
    const rpcCalls: string[] = [];
    const records: QueryRecord[] = [];
    const secondOrderId = '8be5d078-4e59-4f8b-a776-75842bd44073';
    mocks.client = createClient({ records, rpcCalls, rows: lineRows({
      orders: [
        { id: orderId, user_id: userId, status: 'paid', total: 16000, created_at: '2026-07-14T06:00:00.000Z' },
        { id: secondOrderId, user_id: userId, status: 'paid', total: 18000, created_at: '2026-07-13T06:00:00.000Z' },
      ],
      order_items: [
        { id: transactionLineId, order_id: orderId, good_id: 'transaction-good', variant_id: transactionDisplay.lines[0].variantId, variant_name_snapshot: '기본 옵션', qty: 2, unit_price: 10000, good_name_snapshot: '복수구매 굿즈' },
        { id: 'item-b', order_id: secondOrderId, good_id: 'g1', variant_id: 'v1', variant_name_snapshot: '파랑', qty: 2, unit_price: 9000, good_name_snapshot: '아크릴 스탠드' },
      ],
      item_display: [
        { id: transactionLineId, regular_unit_price: 10000, volume_unit_discount: 1000, active_qty: 2 },
        { id: 'item-b', regular_unit_price: 9000, volume_unit_discount: 0, active_qty: 2 },
      ],
    }) });

    const orders = await loadOrders(userId, { withLines: true });

    /* 주문이 둘이어도 배치 RPC는 한 번이고, 주문별 영수증 RPC는 없다. */
    expect(rpcCalls.filter((name) => name === 'my_order_item_display')).toHaveLength(1);
    expect(rpcCalls).not.toContain('get_my_goods_transaction_receipt');
    expect(records.find((record) => record.rpc === 'my_order_item_display')?.select).toBe('id:item_id,regular_unit_price,volume_unit_discount,active_qty');
    /* (10000 − 1000) × 2 = 18000 구매가, 10000 × 2 = 20000 정가. 기본 옵션은 줄에서 숨기는 이름이라 값은 남고 화면이 감춘다. */
    expect(orders[0].lines?.[0]).toMatchObject({ name: '복수구매 굿즈', optionName: '기본 옵션', qty: 2, purchaseAmount: 18000, regularAmount: 20000 });
    expect(orders[0].lines?.[0]).not.toHaveProperty('canceledQty');
    /* 구매가와 정가가 같은 줄은 숫자 하나로 보인다(값은 둘 다 남는다). */
    expect(orders[1].lines?.[0]).toMatchObject({ purchaseAmount: 18000, regularAmount: 18000 });
  });

  it('부분 취소가 있으면 남은 수량과 그 수량의 금액을 담고 취소 수량을 따로 알린다. 전부 취소되면 수량 0에 금액이 없다', async () => {
    mocks.client = createClient({ records: [], rows: lineRows({
      item_display: [
        { id: 'item-1', regular_unit_price: 20000, volume_unit_discount: 2000, active_qty: 1 },
        { id: 'item-2', regular_unit_price: 18000, volume_unit_discount: 0, active_qty: 0 },
      ],
    }) });

    const [order] = await loadOrders(userId, { withLines: true });

    /* item-1: 주문 2개 중 1개가 남았다 → (18000 − 2000) × 1 구매가, 20000 × 1 정가. */
    expect(order.lines?.[0]).toMatchObject({ key: 'item-1', qty: 1, canceledQty: 1, purchaseAmount: 16000, regularAmount: 20000 });
    /* item-2(랜덤 판매 합친 줄 2개): 전부 취소 → 0개, 취소 2개, 가격 없음. */
    expect(order.lines?.[1]).toMatchObject({ key: 'item-2', qty: 0, canceledQty: 2, purchaseAmount: null, regularAmount: null });
    /* 목록 요약(첫 굿즈 외 N건)은 주문 당시 품목 수량(2 + 2) 그대로다. */
    expect(order.itemCount).toBe(4);
  });

  it('배치 RPC가 실패해도 목록은 스냅샷 줄(주문 단가 × 주문 수량)로 그대로 돌아온다', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.client = createClient({ records: [], rows: lineRows(), errors: { item_display: 'boom' } });

    const [order] = await loadOrders(userId, { withLines: true });

    expect(order.lines).toMatchObject([
      { key: 'item-1', qty: 2, purchaseAmount: 36000, regularAmount: null },
      { key: 'item-2', qty: 2, purchaseAmount: 36000, regularAmount: null },
    ]);
    expect(order.lines?.[0]).not.toHaveProperty('canceledQty');
    expect(errorSpy).toHaveBeenCalledWith('[orders] line enrichment failed', 'item_display:unknown');
    errorSpy.mockRestore();
  });

  it('v1 주문(배치 RPC가 정가 null을 준 줄)은 주문 단가 × 수량 숫자 하나다', async () => {
    const rpcCalls: string[] = [];
    mocks.client = createClient({ records: [], rpcCalls, rows: lineRows({
      item_display: [{ id: 'item-1', regular_unit_price: null, volume_unit_discount: 0, active_qty: 2 }],
    }) });
    const [order] = await loadOrders(userId, { withLines: true });
    expect(rpcCalls).not.toContain('get_my_goods_transaction_receipt');
    expect(order.lines?.[0]).toMatchObject({ qty: 2, purchaseAmount: 36000, regularAmount: null });
  });

  it('withLines가 아니면 굿즈·IP를 읽지 않고 lines 키도 없다(마이페이지 요약은 비용이 늘지 않는다)', async () => {
    const records: QueryRecord[] = [];
    const rpcCalls: string[] = [];
    mocks.client = createClient({ records, rpcCalls, rows: lineRows() });

    const [order] = await loadOrders(userId);

    expect(order).not.toHaveProperty('lines');
    expect(records.some((record) => record.table === 'goods' || record.table === 'ips')).toBe(false);
    expect(rpcCalls).toEqual(['my_order_items']);
    expect(records.find((record) => record.table === 'orders')?.select).toBe('id,order_number,user_id,status,total,created_at,payment_method');
  });

  it('선물 주문 목록에는 withLines 여부를 그대로 넘긴다', async () => {
    mocks.client = createClient({ records: [], rows: lineRows() });
    await loadOrders(userId, { includePending: true, withLines: true });
    expect(mocks.giftList).toHaveBeenLastCalledWith(true, { withLines: true });
    await loadOrders(userId);
    expect(mocks.giftList).toHaveBeenLastCalledWith(false, { withLines: false });
  });

  it('굿즈·IP 읽기가 실패해도 목록은 스냅샷 줄로 그대로 돌아온다', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.client = createClient({ records: [], rows: lineRows(), errors: { goods: 'boom', ips: 'boom' } });

    const [order] = await loadOrders(userId, { withLines: true });

    expect(order).toMatchObject({ id: orderId, status: 'paid', total: 54000, itemLabel: '아크릴 스탠드 외 1건' });
    expect(order.lines).toMatchObject([
      { name: '아크릴 스탠드', qty: 2, ipName: null, thumbnail: null, purchaseAmount: 36000 },
      { name: '랜덤 키링', optionName: '랜덤', ipName: null, thumbnail: null },
    ]);
    expect(errorSpy).toHaveBeenCalledWith('[orders] line enrichment failed', expect.stringMatching(/^goods:/));
    errorSpy.mockRestore();
  });

  it('주문 자체 읽기 실패는 그대로 던진다(보강 실패와 다르다)', async () => {
    mocks.client = createClient({ records: [], rows: lineRows(), errors: { orders: 'network unavailable' } });
    await expect(loadOrders(userId, { withLines: true })).rejects.toThrow('Failed to load orders');
  });
});

describe('loadOrderDetail', () => {
  it.each([
    [{ cancel: true, return: false, exchange: false }, false, { cancel: true, return: false, exchange: false }],
    [{ cancel: false, return: true, exchange: true }, false, { cancel: false, return: true, exchange: true }],
    [null, false, null],
    [{ cancel: 'true', return: true }, false, null],
    [{ cancel: true, return: true, exchange: true }, true, null],
  ])('DB 접수 자격을 투영하고 누락·잘못된 응답·조회 오류는 닫는다', async (claimEligibility, eligibilityError, expected) => {
    mocks.client = createClient({ records: [], claimEligibility, eligibilityError: Boolean(eligibilityError), rows: {
      orders: [{ id: orderId, user_id: userId, status: 'paid', total: 14000, created_at: '2026-09-01T00:00:00Z',
        address: null, delivered_at: null, payment_method: 'card', expires_at: null }],
    } });
    expect((await loadOrderDetail(userId, orderId))?.claimEligibility).toEqual(expected);
  });

  it('loads a safe receipt and counts legacy, revoked, and opened card packs', async () => {
    const records: QueryRecord[] = [];
    mocks.client = createClient({
      records,
      rows: {
        order_shipments: [{id:'shipment-1',order_id:orderId,origin_id:'origin',origin_name_snapshot:'김포',shipping_fee:3000,status:'shipping',carrier:'hanjin',tracking_number:'123456789012',shipped_at:null,delivered_at:null,exported_at:null,order_shipment_items:[{order_item_id:'item-1'}]}],
        orders: [{
          id: orderId,
          user_id: userId,
          status: 'shipping',
          total: 57000,
          shipping_fee: 3000,
          shipping_carrier: 'hanjin',
          tracking_number: '123456789012',
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
          variant_id: 'variant-blue',
          variant_name_snapshot: '파랑',
          variant_code_snapshot: 'BLUE',
          qty: 2,
          unit_price: 27000,
          good_name_snapshot: '아크릴 스탠드',
        }],
        payment_summaries: [{
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
        order_cancellation_requests: [{
          id: 'cancel-request-1',
          order_id: orderId,
          status: 'needs_review',
          requested_at: '2026-07-14T07:20:00.000Z',
          decided_at: '2026-07-14T07:25:00.000Z',
          decision_note: null,
          last_error_code: 'must-not-leak',
        }],
        draw_tickets: [
          {
            user_id: userId,
            source: 'order_paid',
            source_id: orderId,
            consumed_at: null,
            revoked_at: null,
            reward_policy_id: null,
          },
          {
            user_id: userId,
            source: 'order_paid',
            source_id: orderId,
            consumed_at: null,
            revoked_at: '2026-07-14T07:10:00.000Z',
          },
          {
            user_id: userId,
            source: 'order_paid',
            source_id: orderId,
            consumed_at: '2026-07-14T07:00:00.000Z',
            revoked_at: null,
          },
        ],
      },
    });

    const result = await loadOrderDetail(userId, orderId);
    expect(result?.items[0]).toMatchObject({ variantId: 'variant-blue', variantName: '파랑', variantCode: 'BLUE' });

    expect(result).toMatchObject({
      id: orderId,
      status: 'shipping',
      total: 57000,
      shippingFee: 3000,
      items: [{ goodId: 'goods-1', name: '아크릴 스탠드', qty: 2, unitPrice: 27000 }],
      payment: { amount: 54000, status: 'paid', createdAt: '2026-07-14T06:01:00.000Z' },
      refund: { status: 'requested', createdAt: '2026-07-14T07:30:00.000Z' },
      cancellationRequest: {
        id: 'cancel-request-1',
        status: 'needs_review',
        requestedAt: '2026-07-14T07:20:00.000Z',
        decidedAt: '2026-07-14T07:25:00.000Z',
        decisionNote: null,
      },
      cardPacks: { issuedCount: 3, availableCount: 1 },
      shipments: [{
        carrier: 'hanjin',
        carrierLabel: '한진택배',
        trackingNumber: '123456789012',
      }],
    });
    expect(JSON.stringify(result)).not.toMatch(/must-not-leak|payment_key|idempotency_key|raw|last_error_code/);

    expect(records.find((record) => record.table === 'orders')).toMatchObject({
      select: 'id,order_number,user_id,status,total,shipping_fee,discount_total,store_credit_total,address,created_at,delivered_at,payment_method,expires_at,calculation_version,volume_discount_total,shipping_collect_total',
      eq: [['id', orderId], ['user_id', userId]],
      in: [['status', ['pending', 'paid', 'confirmed', 'shipping', 'delivered', 'done', 'canceled']]],
      maybeSingle: true,
    });
    expect(records.filter(record => record.table === 'order_shipments')).toHaveLength(1);
    expect(records.find(record => record.table === 'order_shipments')?.in).toEqual([['order_id', [orderId]]]);
    expect(records.find((record) => record.table === 'payment_summaries')).toMatchObject({
      select: 'id,amount,status,created_at,provider',
      eq: [['user_id', userId], ['purpose', 'order'], ['ref_id', orderId]],
      order: [['created_at', { ascending: false }], ['id', { ascending: false }]],
      maybeSingle: false,
    });
    expect(records.find((record) => record.table === 'draw_tickets')).toMatchObject({
      select: 'consumed_at,revoked_at',
      eq: [['user_id', userId], ['source', 'order_paid'], ['source_id', orderId]],
    });
    expect(records.find((record) => record.table === 'refunds')).toMatchObject({
      select: 'status,created_at',
      in: [['payment_id', ['payment-2', 'payment-1']]],
      order: [['created_at', { ascending: false }]],
      limit: 1,
      maybeSingle: true,
    });
    expect(records.find((record) => record.table === 'order_cancellation_requests')).toMatchObject({
      select: 'id,status,claim_type,stage,reference,requested_at,decided_at,decision_note,'
        + 'reship_carrier,reship_tracking_number,reship_delivered_at',
      eq: [['order_id', orderId]],
      order: [['requested_at', { ascending: false }]],
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
        payment_summaries: [],
        draw_tickets: [],
      },
    });

    await expect(loadOrderDetail(userId, orderId)).resolves.toMatchObject({
      id: orderId,
      status: 'pending',
      // 배송비 스냅샷이 없던 시절의 주문은 무료배송으로 읽는다.
      shippingFee: 0,
      refund: null,
      cancellationRequest: null,
    });
    expect(records.some((record) => record.table === 'refunds')).toBe(false);
  });

  it('교환 소포를 배송 건마다 조회 링크와 함께 싣고, 클레임 칸에 같은 운송장을 다시 싣지 않는다(TKT-166)', async () => {
    const claimId = '5f0d7c11-3c1d-4b8c-9e7a-0c5d2f6b1a01';
    const parcel = (n: number, deliveredAt: string | null, collectionWaived = false) => ({
      claimId, reshipmentId: `5f0d7c11-3c1d-4b8c-9e7a-0c5d2f6b1a1${n}`, carrier: 'hanjin', trackingNumber: `EXCHANGE00${n}`,
      reshippedAt: '2026-11-10T01:00:00.000Z', deliveredAt, collectionWaived,
      items: [{ orderItemId: `5f0d7c11-3c1d-4b8c-9e7a-0c5d2f6b1a2${n}`, name: '아크릴 스탠드', variantName: '파랑', qty: 1 }],
    });
    const rows = (stage: string) => ({
      orders: [{ id: orderId, user_id: userId, status: 'delivered', total: 54000, address: null, created_at: '2026-07-14T06:00:00.000Z' }],
      order_items: [], payment_summaries: [], draw_tickets: [],
      order_cancellation_requests: [{ id: claimId, order_id: orderId, status: stage === 'completed' ? 'completed' : 'requested', claim_type: 'exchange', stage, reference: 9,
        requested_at: '2026-11-09T00:00:00.000Z', decided_at: null, decision_note: null, reship_carrier: null, reship_tracking_number: null, reship_delivered_at: null }],
    });
    mocks.client = createClient({ records: [], rows: rows('collecting'), reshipmentParcels: [parcel(1, null), parcel(2, null, true)] });
    const open = await loadOrderDetail(userId, orderId);
    expect(open?.reshipmentParcels).toMatchObject([
      { trackingNumber: 'EXCHANGE001', carrierLabel: '한진택배', collectionWaived: false },
      { trackingNumber: 'EXCHANGE002', carrierLabel: '한진택배', collectionWaived: true },
    ]);
    expect(open?.reshipmentParcels?.[0].trackingUrl).toContain('EXCHANGE001');
    expect(open?.cancellationRequest).toMatchObject({ reshipCarrier: null, reshipTrackingNumber: null, reshipDeliveredAt: null });
    mocks.client = createClient({ records: [], rows: rows('completed'), reshipmentParcels: [parcel(1, '2026-11-11T01:00:00.000Z'), parcel(2, '2026-11-12T01:00:00.000Z')] });
    expect((await loadOrderDetail(userId, orderId))?.cancellationRequest).toMatchObject({ reshipDeliveredAt: '2026-11-12T01:00:00.000Z' });
    mocks.client = createClient({ records: [], rows: rows('completed'), reshipmentParcels: [{ ...parcel(1, null), trackingNumber: 'bad' }] });
    await expect(loadOrderDetail(userId, orderId)).rejects.toThrow('order_reshipment_parcels_invalid');
  });

  it('이 기능 전의 클레임 단위 재출고(한 쌍)도 소포 목록에만 싣고 클레임 칸에 다시 싣지 않는다(리뷰 #6)', async () => {
    const claimId = '5f0d7c11-3c1d-4b8c-9e7a-0c5d2f6b1a31';
    const legacy = { claimId, reshipmentId: null, carrier: 'hanjin', trackingNumber: 'LEGACY0001', reshippedAt: '2026-10-01T01:00:00.000Z',
      deliveredAt: '2026-10-03T01:00:00.000Z', collectionWaived: false, items: [] };
    mocks.client = createClient({ records: [], reshipmentParcels: [legacy], rows: {
      orders: [{ id: orderId, user_id: userId, status: 'delivered', total: 54000, address: null, created_at: '2026-07-14T06:00:00.000Z' }],
      order_items: [], payment_summaries: [], draw_tickets: [],
      order_cancellation_requests: [{ id: claimId, order_id: orderId, status: 'completed', claim_type: 'exchange', stage: 'completed', reference: 3,
        requested_at: '2026-09-29T00:00:00.000Z', decided_at: null, decision_note: null, reship_carrier: 'hanjin', reship_tracking_number: 'LEGACY0001',
        reship_delivered_at: '2026-10-03T01:00:00.000Z' }],
    } });
    const detail = await loadOrderDetail(userId, orderId);
    expect(detail?.reshipmentParcels).toMatchObject([{ trackingNumber: 'LEGACY0001', reshipmentId: null }]);
    expect(detail?.cancellationRequest).toMatchObject({ reshipCarrier: null, reshipTrackingNumber: null, reshipDeliveredAt: '2026-10-03T01:00:00.000Z' });
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

it('1001행 주문을 고객 주문 상세와 주문 목록 수량 요약에서 모두 읽는다',async()=>{
  const records:QueryRecord[]=[];
  const rows={orders:[{id:orderId,user_id:userId,status:'paid',total:1001000,address:{},created_at:'2026-10-12T00:00:00Z',payment_method:'card'}],
    order_items:Array.from({length:1001},(_,index)=>({id:String(index).padStart(12,'0'),order_id:orderId,good_id:'g1',qty:1,unit_price:1000,good_name_snapshot:'각인 상품',variant_id:'00000000-0000-4000-8000-000000000001',
      custom_inputs_snapshot:{revision:1,fields:[{id:'00000000-0000-4000-8000-000000063311',name:'문구',value:`입력 ${index}`}]}}))};
  mocks.client=createClient({records,rows});
  const detail=await loadOrderDetail(userId,orderId);
  expect(detail?.items).toHaveLength(1001);
  expect(detail?.items.at(-1)?.customInputs?.fields[0].value).toBe('입력 1000');
  expect((await loadOrders(userId))[0]?.itemCount).toBe(1001);
});

describe('랜덤 판매 굿즈(D5②) 고객 은닉', () => {
  const randomRows = [
    { id: '00000000-0000-4000-8000-0000000000a1', order_id: orderId, good_id: 'random-good', qty: 2, unit_price: 5000, good_name_snapshot: '랜덤 포토카드', variant_id: '00000000-0000-4000-8000-00000000000b', variant_name_snapshot: '배정옵션-비밀', variant_code_snapshot: 'SECRET-CODE',
      option_sale_mode_snapshot: 'random', cart_variant_id: '00000000-0000-4000-8000-00000000000a' },
    { id: '00000000-0000-4000-8000-0000000000a2', order_id: orderId, good_id: 'random-good', qty: 1, unit_price: 5000, good_name_snapshot: '랜덤 포토카드', variant_id: '00000000-0000-4000-8000-00000000000c', variant_name_snapshot: '다른배정-비밀', variant_code_snapshot: 'SECRET-CODE-2',
      option_sale_mode_snapshot: 'random', cart_variant_id: '00000000-0000-4000-8000-00000000000a' },
    { id: '00000000-0000-4000-8000-0000000000a3', order_id: orderId, good_id: 'plain-good', qty: 1, unit_price: 3000, good_name_snapshot: '틴케이스', variant_id: '00000000-0000-4000-8000-00000000000d', variant_name_snapshot: '파랑', variant_code_snapshot: 'BLUE' },
  ];

  it('주문 목록 요약은 직접 읽기에서 빠지는 랜덤 행까지 마스킹 RPC로 센다', async () => {
    const records: QueryRecord[] = [];
    mocks.client = createClient({ records, rows: {
      orders: [{ id: orderId, user_id: userId, status: 'paid', total: 18000, created_at: '2026-10-28T00:00:00Z', payment_method: 'card' }],
      order_items: randomRows,
    } });
    await expect(loadOrders(userId)).resolves.toMatchObject([{ id: orderId, itemCount: 4, itemLabel: '랜덤 포토카드 외 1건' }]);
    expect(records.filter((record) => record.table === 'order_items').every((record) => record.rpc === 'my_order_items')).toBe(true);
  });

  it('주문 상세는 랜덤 행을 장바구니 키·옵션명 랜덤 한 줄로만 보이고 배정 옵션·나뉜 개수를 싣지 않는다', async () => {
    mocks.client = createClient({ records: [], rows: {
      orders: [{ id: orderId, user_id: userId, status: 'pending', total: 18000, address: null, created_at: '2026-10-28T00:00:00Z', payment_method: 'card' }],
      order_items: randomRows,
    } });
    const detail = await loadOrderDetail(userId, orderId);
    expect(detail?.items).toHaveLength(2);
    expect(detail?.items.filter((item) => item.goodId === 'random-good')).toEqual([
      expect.objectContaining({ id: '00000000-0000-4000-8000-0000000000a1', variantId: '00000000-0000-4000-8000-00000000000a', variantName: '랜덤', variantCode: null, qty: 3 }),
    ]);
    expect(detail?.items.find((item) => item.goodId === 'plain-good')).toMatchObject({ variantName: '파랑', variantCode: 'BLUE' });
    expect(JSON.stringify(detail)).not.toMatch(/비밀|SECRET|00000000000b|00000000000c/);
  });

  it('주문 상세는 RPC가 합친 줄을 그대로 쓰고 상세 열에 배송 건을 함께 읽는다', async () => {
    const records: QueryRecord[] = [];
    mocks.client = createClient({ records, rows: {
      orders: [{ id: orderId, user_id: userId, status: 'pending', total: 18000, address: null, created_at: '2026-10-28T00:00:00Z', payment_method: 'card' }],
      order_items: randomRows,
    } });
    await loadOrderDetail(userId, orderId);
    expect(records.find((record) => record.table === 'order_items')).toMatchObject({ rpc: 'my_order_items' });
    expect(records.find((record) => record.table === 'order_items')?.select?.split(',')).toContain('shipment_id');
  });

  /* 고객은 배송 건 품목(order_shipment_items)의 랜덤 배정 행을 읽지 못한다(restrictive RLS) — 배송 건 대응은 my_order_items.shipment_id. */
  it('배송 건 품목에서 빠진 랜덤 줄을 my_order_items 의 배송 건에 붙인다', async () => {
    mocks.client = createClient({ records: [], rows: {
      orders: [{ id: orderId, user_id: userId, status: 'paid', total: 18000, address: null, created_at: '2026-10-28T00:00:00Z', payment_method: 'card' }],
      order_items: randomRows.map((row) => ({ ...row, shipment_id: 'shipment-1' })),
      order_shipments: [{ id: 'shipment-1', order_id: orderId, origin_id: 'origin', origin_name_snapshot: '김포', shipping_fee: 3000, status: 'ready',
        carrier: null, tracking_number: null, shipped_at: null, delivered_at: null, exported_at: null,
        order_shipment_items: [{ order_item_id: '00000000-0000-4000-8000-0000000000a3' }] }],
    } });
    const detail = await loadOrderDetail(userId, orderId);
    expect(detail?.shipments?.[0]?.orderItemIds).toEqual(['00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000a1']);
  });
});

/* MD-0036·0037: 주문 상세도 같은 품목 줄을 쓴다. 이미 읽은 영수증을 다시 읽지 않고, 결제 provider를 싣는다. */
describe('loadOrderDetail lines·provider', () => {
  beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.test'); });
  afterEach(() => { vi.unstubAllEnvs(); });

  const baseRows = () => ({
    orders: [{ id: orderId, user_id: userId, status: 'paid', total: 54000, address: null, created_at: '2026-07-14T06:00:00.000Z', payment_method: 'card', calculation_version: 1 } as Record<string, unknown>],
    order_items: [{ id: 'item-1', order_id: orderId, good_id: 'g1', variant_id: 'v1', variant_name_snapshot: '파랑', qty: 2, unit_price: 27000, good_name_snapshot: '아크릴 스탠드' } as Record<string, unknown>],
    goods: [{ id: 'g1', ip_id: 'ip-1', image_path: 'goods/a.webp', bg: null, sale_restriction: 'none' }],
    ips: [{ id: 'ip-1', title: '홍실' }],
    payment_summaries: [{ id: 'payment-1', user_id: userId, purpose: 'order', ref_id: orderId, amount: 54000, status: 'paid', created_at: '2026-07-14T06:01:00.000Z', provider: 'toss' } as Record<string, unknown>],
  });

  it('품목 줄과 결제 provider를 싣는다(v1은 영수증을 읽지 않고 주문 단가 × 수량)', async () => {
    const rpcCalls: string[] = [];
    mocks.client = createClient({ records: [], rpcCalls, rows: baseRows() });

    const detail = await loadOrderDetail(userId, orderId);

    expect(detail?.lines).toMatchObject([{ key: 'item-1', name: '아크릴 스탠드', optionName: '파랑', qty: 2, ipName: '홍실', purchaseAmount: 54000, regularAmount: null, thumbnail: expect.stringContaining('goods/a.webp') }]);
    expect(detail?.payment).toMatchObject({ amount: 54000, status: 'paid', provider: 'toss' });
    expect(rpcCalls).not.toContain('get_my_goods_transaction_receipt');
  });

  it('결제 provider가 없는 옛 결제는 null이다', async () => {
    const rows = baseRows();
    delete rows.payment_summaries[0].provider;
    mocks.client = createClient({ records: [], rows });
    expect((await loadOrderDetail(userId, orderId))?.payment?.provider).toBeNull();
  });

  it('v2 주문은 이미 검증해 읽은 영수증으로 줄을 보강하고 영수증을 다시 읽지 않는다', async () => {
    const rpcCalls: string[] = [];
    const rows = baseRows();
    rows.orders = [{ ...rows.orders[0], total: 16000, shipping_fee: 0, discount_total: 1000, store_credit_total: 1000, volume_discount_total: 2000, shipping_collect_total: 3000, calculation_version: 2 }];
    rows.order_items = [{ ...rows.order_items[0], id: transactionLineId, good_id: 'transaction-good', variant_id: transactionDisplay.lines[0].variantId, qty: 2, unit_price: 10000 }];
    mocks.client = createClient({ records: [], rpcCalls, rows, receipt: { orderId, quoteId: transactionQuoteId, display: transactionDisplay } });

    const detail = await loadOrderDetail(userId, orderId);

    expect(rpcCalls.filter((name) => name === 'get_my_goods_transaction_receipt')).toHaveLength(1);
    expect(detail?.lines).toMatchObject([{ key: transactionLineId, purchaseAmount: 18000, regularAmount: 20000 }]);
  });

  it('굿즈·IP 읽기가 실패해도 주문 상세는 스냅샷 줄과 함께 그대로 열린다', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.client = createClient({ records: [], rows: baseRows(), errors: { goods: 'boom', ips: 'boom' } });

    const detail = await loadOrderDetail(userId, orderId);

    expect(detail).toMatchObject({ id: orderId, status: 'paid', items: [{ name: '아크릴 스탠드' }] });
    expect(detail?.lines).toMatchObject([{ name: '아크릴 스탠드', ipName: null, thumbnail: null, purchaseAmount: 54000 }]);
    errorSpy.mockRestore();
  });
});
