import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurrentAuthState } from '@/lib/auth/server';
import { restoreCanceledOrderToCartAction } from './reorder-actions';

const mocks = vi.hoisted(() => ({
  auth: null as unknown as CurrentAuthState,
  rows: {} as Record<string, Record<string, unknown>[]>,
  failingTables: new Set<string>(),
  queries: [] as { table: string; eq: [string, unknown][] }[],
  rpc: vi.fn(),
  quote: vi.fn(),
  gift: vi.fn(),
  runtime: vi.fn(),
  transactionQuote: vi.fn(),
  pageCap: 500,
  missingCounts: new Set<string>(),
  retention: vi.fn(),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => ({ rpc: (...args: unknown[]) => mocks.retention(...args) }),
}));

vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: () => mocks.auth }));
vi.mock('@/lib/goods-sales.server', () => ({
  loadGoodsSalesQuote: (...args: unknown[]) => mocks.quote(...args),
}));
vi.mock('@/lib/gifts-order.server', () => ({ loadGiftCheckoutOrder: (...args: unknown[]) => mocks.gift(...args) }));
vi.mock('@/lib/checkout-transaction.server', () => ({ loadGoodsTransactionRuntimeMode: () => mocks.runtime() }));
vi.mock('./transaction-actions', () => ({ quoteCartTransactionAction: (...args: unknown[]) => mocks.transactionQuote(...args) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from(table: string) {
      const record = { table, eq: [] as [string, unknown][], in: [] as [string, unknown[]][],
        after: null as string | null, limit: Infinity, ordered: false, exact: false };
      mocks.queries.push(record);
      const result = () => {
        if (mocks.failingTables.has(table)) return { data: null, error: { message: 'boom' }, count: null };
        let rows = mocks.rows[table] ?? [];
        for (const [column, value] of record.eq) rows = rows.filter((row) => row[column] === value);
        for (const [column, values] of record.in) rows = rows.filter((row) => values.includes(row[column]));
        if (record.after) rows = rows.filter(row => String(row.id) > record.after!);
        if (record.ordered) rows = [...rows].sort((left, right) => String(left.id).localeCompare(String(right.id)));
        const count = record.exact && !mocks.missingCounts.has(table) ? rows.length : null;
        return { data: rows.slice(0, Math.min(record.limit, record.exact ? mocks.pageCap : Infinity)), error: null, count };
      };
      const query = {
        select: (_columns: string, options?: { count?: string }) => { record.exact = options?.count === 'exact'; return query; },
        eq(column: string, value: unknown) { record.eq.push([column, value]); return query; },
        in(column: string, values: unknown[]) { record.in.push([column, values]); return query; },
        gt: (_column: string, value: string) => { record.after = value; return query; },
        order: (column: string) => { record.ordered = column === 'id'; return query; },
        limit: (limit: number) => { record.limit = limit; return query; },
        maybeSingle: () => {
          const { data, error } = result();
          return Promise.resolve({ data: data?.[0] ?? null, error });
        },
        then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return query;
    },
    rpc: mocks.rpc,
  }),
}));

const userId = '00000000-0000-4000-8000-000000000001';
const orderId = '5cbcbbed-202d-4676-821a-7706398e57c0';
const variantA = '10000000-0000-4000-8000-00000000000a';
const variantB = '10000000-0000-4000-8000-00000000000b';
const userCouponId = '30000000-0000-4000-8000-000000000001';
const otherUserCouponId = '30000000-0000-4000-8000-000000000002';
const inputFieldId = '40000000-0000-4000-8000-000000000001';
const inputSelection = (value: string, revision = 1) => ({ revision, fields: [{ id: inputFieldId, name: '각인 문구', value }] });
const rowId = (index: number) => `60000000-0000-4000-8000-${String(index).padStart(12, '0')}`;

function rpcCalls(name: string) {
  return mocks.rpc.mock.calls.filter(([called]) => called === name);
}

/* 장바구니·쿠폰 선택 RPC가 실제로 행을 바꾸는 것처럼 흉내 낸다 — 쿠폰 재선택 뒤의 판매
   견적은 그 결과(담긴 굿즈·선택된 쿠폰)를 읽는다. */
function cartRpc(name: string, args: Record<string, unknown> = {}) {
  if (name === 'merge_cart_items') {
    const item = (args.p_items as Record<string, unknown>[])[0];
    const rows = mocks.rows.cart_items ?? (mocks.rows.cart_items = []);
    const inputSnapshot = item.input_revision
      ? inputSelection((item.input_values as Record<string, string>)[inputFieldId], item.input_revision as number) : null;
    const existing = rows.find(row => row.user_id === userId && row.good_id === item.good_id
      && row.variant_id === item.variant_id && JSON.stringify(row.input_snapshot ?? null) === JSON.stringify(inputSnapshot));
    if (existing) existing.qty = Math.max(existing.qty as number, item.qty as number);
    else rows.push({ id: rowId(1_000_000 + rows.length), user_id: userId, good_id: item.good_id,
      variant_id: item.variant_id, qty: item.qty, input_snapshot: inputSnapshot });
  }
  if (name === 'apply_cart_coupon') {
    mocks.rows.cart_coupon_selections = [{ user_id: userId, user_coupon_id: args.p_user_coupon_id }];
  }
  if (name === 'clear_cart_coupon') mocks.rows.cart_coupon_selections = [];
  return Promise.resolve({ data: null, error: null });
}

/** 장바구니·주문서가 쓰는 판매 견적의 쿠폰 부분만 흉내 낸다. reason이 있으면 제출이 막힌다. */
function quoteWithCouponReason(reason: string | null) {
  return async () => {
    const selected = mocks.rows.cart_coupon_selections?.[0]?.user_coupon_id;
    if (typeof selected !== 'string') return { coupon: null };
    return {
      coupon: { userCouponId: selected, couponCode: 'WELCOME', eligibleSubtotal: 10000, discount: reason ? 0 : 3000, reason },
    };
  };
}

function onboardedAuth(overrides: Partial<NonNullable<CurrentAuthState['profile']>> = {}): CurrentAuthState {
  return {
    isConfigured: true,
    user: { id: userId, email: 'fan@icons.gg' },
    profile: {
      email: 'fan@icons.gg',
      nickname: 'fan',
      birth_date: '2000-01-01',
      consents: { terms: true, privacy: true },
      onboarded_at: '2026-07-01T00:00:00.000Z',
      ...overrides,
    },
    isStaff: false,
  } as CurrentAuthState;
}

describe('restoreCanceledOrderToCartAction', () => {
  beforeEach(() => {
    mocks.auth = onboardedAuth();
    mocks.queries = [];
    mocks.failingTables = new Set();
    mocks.missingCounts = new Set();
    mocks.pageCap = 500;
    mocks.rpc.mockReset();
    mocks.retention.mockReset();
    mocks.retention.mockResolvedValue({ data: null, error: null });
    mocks.rpc.mockImplementation(cartRpc);
    mocks.quote.mockReset();
    mocks.quote.mockImplementation(quoteWithCouponReason(null));
    mocks.gift.mockReset().mockResolvedValue({ kind: 'ordinary' });
    mocks.runtime.mockReset().mockResolvedValue('legacy');
    mocks.transactionQuote.mockReset();
    mocks.rows = {
      orders: [{ id: orderId, user_id: userId, status: 'canceled', discount_total: 0, store_credit_total: 0 }],
      order_items: [
        { id: rowId(1), order_id: orderId, good_id: 'g1', variant_id: variantA, qty: 2, good_name_snapshot: '홍실 키링', variant_name_snapshot: '파랑' },
        { id: rowId(2), order_id: orderId, good_id: 'g2', variant_id: variantB, qty: 1, good_name_snapshot: '홍실 쿠션', variant_name_snapshot: null },
      ],
      cart_items: [],
    };
  });

  it('does not re-add lines for a card order whose cart was retained until payment (ADR-0026)', async () => {
    mocks.rows.orders = [{ id: orderId, user_id: userId, status: 'canceled', discount_total: 0, store_credit_total: 0 }];
    mocks.retention.mockResolvedValue({ data: { state: 'released', releaseReason: 'superseded' }, error: null });
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toEqual({ ok: false, error: 'cart_retained' });
    expect(mocks.retention).toHaveBeenCalledWith('service_get_order_cart_retention', { p_user_id: userId, p_order_id: orderId });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('결제가 확정돼 장바구니에서 이미 뺀 주문(consumed)은 기존 다시 담기 흐름을 쓴다', async () => {
    mocks.rows.orders = [{ id: orderId, user_id: userId, status: 'canceled', discount_total: 0, store_credit_total: 0 }];
    mocks.retention.mockResolvedValue({ data: { state: 'consumed', releaseReason: null }, error: null });
    const result = await restoreCanceledOrderToCartAction(orderId);
    expect(result).not.toEqual({ ok: false, error: 'cart_retained' });
  });

  it('DB가 취소를 확정한 본인 주문의 품목을 장바구니 수량 RPC로 다시 담는다', async () => {
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toEqual({
      ok: true,
      restoredLines: 2,
      skipped: [],
      coupon: 'none',
      storeCreditUsed: 0,
    });
    expect(mocks.rpc).toHaveBeenCalledWith('merge_cart_items', { p_items: [{ good_id: 'g1', variant_id: variantA, qty: 2, input_revision: 0, input_values: {} }] });
    expect(mocks.rpc).toHaveBeenCalledWith('merge_cart_items', { p_items: [{ good_id: 'g2', variant_id: variantB, qty: 1, input_revision: 0, input_values: {} }] });
    expect(mocks.queries.find((query) => query.table === 'orders')?.eq).toEqual([
      ['id', orderId],
      ['user_id', userId],
    ]);
  });

  it('취소되지 않은 주문은 담지 않는다', async () => {
    mocks.rows.orders = [{ id: orderId, user_id: userId, status: 'pending' }];
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toEqual({ ok: false, error: 'not_canceled' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('남의 주문·형식 밖 주문번호는 찾지 못한 것으로 답한다', async () => {
    mocks.rows.orders = [{ id: orderId, user_id: 'someone-else', status: 'canceled' }];
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toEqual({ ok: false, error: 'not_found' });
    mocks.gift.mockClear();
    await expect(restoreCanceledOrderToCartAction('not-a-uuid')).resolves.toEqual({ ok: false, error: 'not_found' });
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.gift).not.toHaveBeenCalled();
  });

  it('선물 주문과 선물 조회 실패는 품목·장바구니를 바꾸기 전에 차단한다', async () => {
    mocks.gift.mockResolvedValue({ kind: 'gift', order: { giftId: rowId(99) } });
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toEqual({ ok: false, error: 'gift_order' });
    expect(mocks.gift).toHaveBeenCalledWith(userId, orderId);
    expect(mocks.queries).toEqual([]);
    mocks.gift.mockResolvedValue({ kind: 'unavailable' });
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toEqual({ ok: false, error: 'failed' });
    mocks.gift.mockRejectedValue(new Error('gift_order_projection_failed'));
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toEqual({ ok: false, error: 'failed' });
    expect(mocks.queries).toEqual([]);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('로그인·온보딩이 안 됐거나 정지된 계정은 담지 않는다', async () => {
    mocks.auth = { isConfigured: true, user: null, profile: null, isStaff: false };
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toEqual({ ok: false, error: 'auth_required' });
    mocks.auth = onboardedAuth({ suspended_at: '2026-10-01T00:00:00.000Z' } as never);
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toEqual({ ok: false, error: 'account_suspended' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('품절·판매 중지 품목은 기존 RPC 판정대로 건너뛰고 나머지는 담는다', async () => {
    mocks.rpc.mockImplementation((_name: string, args: { p_items: { variant_id: string }[] }) => Promise.resolve(
      args.p_items[0].variant_id === variantA
        ? { data: null, error: { message: 'out of stock' } }
        : { data: null, error: { message: 'catalog_item_unavailable' } },
    ));
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toEqual({
      ok: true,
      restoredLines: 0,
      skipped: [
        { name: '홍실 키링 (파랑)', reason: 'out_of_stock' },
        { name: '홍실 쿠션', reason: 'unavailable' },
      ],
      coupon: 'none',
      storeCreditUsed: 0,
    });
  });

  /* catalog_item_unavailable은 품절·비게시·판매 제한을 한데 묶는다. 게시 중인 굿즈가
     품절로 바뀐 경우를 '판매 중지'로 오인시키지 않는다(E-4). */
  it('게시 중인 품절 굿즈는 품절로, 그 밖의 담을 수 없는 굿즈는 사유를 단정하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'catalog_item_unavailable' } });
    mocks.rows.goods = [
      { id: 'g1', stock: 'soldout', published_at: '2026-09-01T00:00:00.000Z', archived_at: null },
      { id: 'g2', stock: 'soldout', published_at: null, archived_at: null },
    ];
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toMatchObject({
      ok: true,
      restoredLines: 0,
      skipped: [
        { name: '홍실 키링 (파랑)', reason: 'sold_out' },
        { name: '홍실 쿠션', reason: 'unavailable' },
      ],
    });

    mocks.failingTables.add('goods');
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toMatchObject({
      skipped: [
        { name: '홍실 키링 (파랑)', reason: 'unavailable' },
        { name: '홍실 쿠션', reason: 'unavailable' },
      ],
    });
  });

  it('같은 옵션도 직접입력값별로 합치고 기존 수량을 보존하며 반복 복원해도 늘리지 않는다', async () => {
    const first = mocks.rows.order_items[0];
    mocks.rows.order_items = [
      { ...first, id: rowId(1), qty: 2, custom_inputs_snapshot: inputSelection('ALPHA') },
      { ...first, id: rowId(2), qty: 3, custom_inputs_snapshot: inputSelection('ALPHA') },
      { ...first, id: rowId(3), qty: 1, custom_inputs_snapshot: inputSelection('BETA') },
    ];
    mocks.rows.cart_items = [
      { id: rowId(10), user_id: userId, good_id: 'g1', variant_id: variantA, qty: 7, input_snapshot: inputSelection('ALPHA') },
      { id: rowId(11), user_id: userId, good_id: 'g1', variant_id: variantA, qty: 9, input_snapshot: inputSelection('OTHER') },
    ];

    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toMatchObject({ ok: true, restoredLines: 2, skipped: [] });
    }
    expect(rpcCalls('merge_cart_items')).toHaveLength(4);
    expect(mocks.rpc).toHaveBeenCalledWith('merge_cart_items', { p_items: [{
      good_id: 'g1', variant_id: variantA, qty: 7, input_revision: 1, input_values: { [inputFieldId]: 'ALPHA' },
    }] });
    expect(mocks.rpc).toHaveBeenCalledWith('merge_cart_items', { p_items: [{
      good_id: 'g1', variant_id: variantA, qty: 1, input_revision: 1, input_values: { [inputFieldId]: 'BETA' },
    }] });
    expect(mocks.rows.cart_items.map(row => row.qty)).toEqual([7, 9, 1]);
  });

  it('현재 입력 설정이 달라진 품목은 기존 수량이 충분해도 다시 검사하고 구분해서 알린다', async () => {
    mocks.rows.order_items[0].custom_inputs_snapshot = inputSelection('이전 문구', 2);
    mocks.rows.cart_items = [
      { id: rowId(10), user_id: userId, good_id: 'g1', variant_id: variantA, qty: 5, input_snapshot: inputSelection('이전 문구', 2) },
    ];
    mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => (
      (args.p_items as { variant_id: string }[])[0].variant_id === variantA
        ? Promise.resolve({ data: null, error: { message: 'goods_custom_inputs_changed' } }) : cartRpc(name, args)
    ));
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toMatchObject({
      ok: true, restoredLines: 1,
      skipped: [{ name: '홍실 키링 (파랑) / 각인 문구: 이전 문구', reason: 'custom_inputs_changed' }],
    });
    expect(mocks.rows.cart_items[0].qty).toBe(5);
  });

  it('손상된 주문 입력값을 빈 옵션으로 바꾸어 복원하지 않는다', async () => {
    mocks.rows.order_items[0].custom_inputs_snapshot = { revision: 1, fields: [] };
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toMatchObject({
      ok: true, restoredLines: 1, skipped: [{ name: '홍실 키링 (파랑)', reason: 'custom_inputs_changed' }],
    });
    expect(rpcCalls('merge_cart_items')).toEqual([['merge_cart_items', { p_items: [{
      good_id: 'g2', variant_id: variantB, qty: 1, input_revision: 0, input_values: {},
    }] }]]);
  });

  it('장바구니 입력값을 해석하지 못하면 수량을 바꾸기 전에 멈춘다', async () => {
    mocks.rows.cart_items = [{ id: rowId(10), user_id: userId, good_id: 'g1', variant_id: variantA, qty: 5, input_snapshot: false }];
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toEqual({ ok: false, error: 'failed' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('서버가 작은 페이지로 잘라도 주문·장바구니 1,001개 전체에서 수량을 구한다', async () => {
    const first = mocks.rows.order_items[0];
    mocks.rows.order_items = Array.from({ length: 1001 }, (_, index) => ({ ...first, id: rowId(index + 1), qty: 1 }));
    mocks.rows.cart_items = Array.from({ length: 1001 }, (_, index) => ({
      id: rowId(index + 1), user_id: userId, good_id: index === 1000 ? 'g1' : `other-${index}`,
      variant_id: index === 1000 ? variantA : `70000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      qty: index === 1000 ? 1005 : 1,
    }));
    mocks.pageCap = 127;
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toMatchObject({ ok: true, restoredLines: 1, skipped: [] });
    expect(mocks.rpc).toHaveBeenCalledWith('merge_cart_items', { p_items: [{ good_id: 'g1', variant_id: variantA, qty: 1005, input_revision: 0, input_values: {} }] });
    expect(mocks.queries.filter(query => query.table === 'order_items')).toHaveLength(8);
    expect(mocks.queries.filter(query => query.table === 'cart_items')).toHaveLength(8);
  });

  it('전체 개수를 확인할 수 없는 주문·장바구니와 넘친 합계 수량은 변경 전에 거절한다', async () => {
    for (const table of ['order_items', 'cart_items']) {
      mocks.missingCounts = new Set([table]);
      await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toEqual({ ok: false, error: 'failed' });
    }
    mocks.missingCounts.clear();
    mocks.rows.order_items = [
      { ...mocks.rows.order_items[0], id: rowId(1), qty: 2_147_483_647 },
      { ...mocks.rows.order_items[0], id: rowId(2), qty: 1 },
    ];
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toEqual({ ok: false, error: 'failed' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  describe('원 주문의 혜택', () => {
    beforeEach(() => {
      mocks.rows.orders = [{ id: orderId, user_id: userId, status: 'canceled', discount_total: 3000, store_credit_total: 0 }];
      mocks.rows.coupon_redemptions = [{
        order_id: orderId,
        user_id: userId,
        user_coupon_id: userCouponId,
        benefit_kind: 'goods',
        status: 'released',
        release_reason: 'order_canceled',
      }];
      mocks.rows.cart_coupon_selections = [];
    });

    /* 주문 생성이 장바구니 쿠폰 선택을 지우므로, 다시 고르지 않으면 새 주문은 정가로
       결제되고 첫구매 쿠폰은 그 결제로 영영 못 쓰게 된다(E-1). */
    it('취소로 돌아온 쿠폰을 기존 RPC로 장바구니에 다시 선택한다', async () => {
      await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toEqual({
        ok: true,
        restoredLines: 2,
        skipped: [],
        coupon: 'restored',
        storeCreditUsed: 0,
      });
      expect(rpcCalls('apply_cart_coupon')).toEqual([['apply_cart_coupon', { p_user_coupon_id: userCouponId }]]);
      expect(mocks.queries.find((query) => query.table === 'coupon_redemptions')?.eq).toEqual([
        ['order_id', orderId],
        ['user_id', userId],
        ['status', 'released'],
        ['release_reason', 'order_canceled'],
      ]);
    });

    it('복수 쿠폰은 일부만 자동 복원하지 않고 기존 선택을 보존한 채 주문서 재선택으로 안내한다', async () => {
      mocks.rows.orders[0].discount_total = 5000;
      mocks.rows.coupon_redemptions.push({
        order_id: orderId, user_id: userId, user_coupon_id: otherUserCouponId,
        status: 'released', release_reason: 'order_canceled', benefit_kind: 'goods',
      });
      const selection = [{ user_id: userId, user_coupon_id: otherUserCouponId }];
      mocks.rows.cart_coupon_selections = selection;
      // PostgREST가 요청한 두 행 대신 한 행만 반환해도 exact count는 2다.
      mocks.pageCap = 1;

      await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toMatchObject({
        ok: true, restoredLines: 2, skipped: [],
        coupon: 'not_restored', couponReselectAt: 'checkout',
      });
      expect(mocks.rows.cart_coupon_selections).toEqual(selection);
      expect(rpcCalls('apply_cart_coupon')).toEqual([]);
      expect(rpcCalls('clear_cart_coupon')).toEqual([]);
      expect(mocks.quote).not.toHaveBeenCalled();
      expect(mocks.transactionQuote).not.toHaveBeenCalled();
    });

    it('쿠폰 사용 원장의 정확한 건수를 읽지 못하면 단일 자동 복원으로 처리하지 않는다', async () => {
      mocks.missingCounts.add('coupon_redemptions');
      await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toMatchObject({
        ok: true, coupon: 'not_restored',
      });
      expect(rpcCalls('apply_cart_coupon')).toEqual([]);
    });

    it('배송비 쿠폰만 쓴 주문도 원장 조회에 실패하면 혜택 미복원을 알린다', async () => {
      mocks.rows.orders[0].discount_total = 0;
      mocks.rows.orders[0].shipping_coupon_discount_total = 2000;
      mocks.failingTables.add('coupon_redemptions');
      await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toMatchObject({
        ok: true, coupon: 'not_restored', couponReselectAt: 'checkout',
      });
    });

    it('배송비 쿠폰 1장은 장바구니 단일 쿠폰에 넣지 않고 주문서에서 다시 고르게 한다', async () => {
      mocks.rows.orders[0].discount_total = 0;
      mocks.rows.orders[0].shipping_coupon_discount_total = 2000;
      mocks.rows.coupon_redemptions[0].benefit_kind = 'shipping';
      await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toMatchObject({
        ok: true, coupon: 'not_restored', couponReselectAt: 'checkout',
      });
      expect(rpcCalls('apply_cart_coupon')).toEqual([]);
      expect(rpcCalls('clear_cart_coupon')).toEqual([]);
      expect(mocks.transactionQuote).not.toHaveBeenCalled();
    });

    it('다시 고른 쿠폰이 지금 장바구니에서 할인으로 인정되는지 판매 견적으로 확인한다', async () => {
      await restoreCanceledOrderToCartAction(orderId);
      expect(mocks.quote).toHaveBeenCalledWith(
        [
          { goodId: 'g1', variantId: variantA, qty: 2 },
          { goodId: 'g2', variantId: variantB, qty: 1 },
        ],
        null,
      );
      expect(rpcCalls('clear_cart_coupon')).toEqual([]);
    });

    it('거래 견적은 직접입력값과 본인 주문의 배송지로 현재 쿠폰 할인을 검증한다', async () => {
      const address = { recipientName: '합성 수취인', phone: '01012345678', postalCode: '12345', address1: '합성 주소', address2: '', deliveryNote: '' };
      mocks.rows.orders[0].address = address;
      mocks.rows.order_items[0].custom_inputs_snapshot = inputSelection('ALPHA');
      mocks.rows.cart_items = [{ id: rowId(10), user_id: userId, good_id: 'g1', variant_id: variantA, qty: 1, input_snapshot: inputSelection('BETA') }];
      mocks.runtime.mockResolvedValue('transaction');
      mocks.transactionQuote.mockResolvedValue({ ok: true, quote: { state: 'quoted', display: {
        userCouponId, totals: { couponDiscountTotal: 3000, shippingCouponDiscountTotal: 0 },
      } } });

      await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toMatchObject({ coupon: 'restored' });
      expect(mocks.quote).not.toHaveBeenCalled();
      expect(mocks.transactionQuote).toHaveBeenCalledWith({
        expectedActorId: userId,
        items: [
          { goodId: 'g1', variantId: variantA, qty: 1, customInputs: inputSelection('BETA') },
          { goodId: 'g1', variantId: variantA, qty: 2, customInputs: inputSelection('ALPHA') },
          { goodId: 'g2', variantId: variantB, qty: 1 },
        ],
        address, deliveryChoices: {}, userCouponId, storeCreditAmount: 0,
      });
      expect(rpcCalls('clear_cart_coupon')).toEqual([]);
    });

    it('현재 견적이 차단·실패·조회 불가이면 이전 견적으로 우회하지 않고 새 쿠폰 선택을 푼다', async () => {
      mocks.runtime.mockResolvedValue('transaction');
      for (const result of [
        { ok: true, quote: { state: 'blocked', issues: [{ code: 'coupon_unavailable', goodId: null }] } },
        { ok: false, error: 'cart_changed' },
      ]) {
        mocks.rows.cart_coupon_selections = [];
        mocks.transactionQuote.mockResolvedValue(result);
        await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toMatchObject({ coupon: 'not_restored' });
        expect(mocks.rows.cart_coupon_selections).toEqual([]);
      }
      mocks.rows.cart_coupon_selections = [];
      mocks.runtime.mockResolvedValue('unavailable');
      await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toMatchObject({ coupon: 'not_restored' });
      expect(mocks.quote).not.toHaveBeenCalled();
      expect(rpcCalls('clear_cart_coupon')).toHaveLength(3);
    });

    it('기존 판매 견적은 입력값이 다른 같은 옵션 수량을 합산하고 0원 할인은 성공으로 보지 않는다', async () => {
      mocks.rows.order_items[0].custom_inputs_snapshot = inputSelection('ALPHA');
      mocks.rows.cart_items = [{ id: rowId(10), user_id: userId, good_id: 'g1', variant_id: variantA, qty: 1, input_snapshot: inputSelection('BETA') }];
      mocks.quote.mockResolvedValue({ coupon: { userCouponId, discount: 0, reason: null } });
      await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toMatchObject({ coupon: 'conditions_unmet' });
      expect(mocks.quote).toHaveBeenCalledWith([
        { goodId: 'g1', variantId: variantA, qty: 3 }, { goodId: 'g2', variantId: variantB, qty: 1 },
      ], null);
      expect(mocks.rows.cart_coupon_selections).toEqual([]);
    });

    /* apply_cart_coupon은 최소 주문 금액 미달·대상 굿즈 없음도 선택으로 받아들이고, 그
       선택은 주문서 제출을 막는다. 일부만 담긴 주문에서 그 쿠폰을 '다시 적용됨'으로 두면
       고객이 장바구니에서 직접 해제해야 남은 굿즈를 주문할 수 있다(E2-1). */
    it('일부만 담겨 쿠폰 조건에 못 미치면 고른 선택을 풀고 conditions_unmet으로 답한다', async () => {
      mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => (
        name === 'merge_cart_items' && (args.p_items as { variant_id: string }[])[0].variant_id === variantA
          ? Promise.resolve({ data: null, error: { message: 'catalog_item_unavailable' } })
          : cartRpc(name, args)
      ));
      mocks.rows.goods = [{ id: 'g1', stock: 'soldout', published_at: '2026-09-01T00:00:00.000Z', archived_at: null }];
      mocks.quote.mockImplementation(quoteWithCouponReason('coupon_min_subtotal'));

      await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toEqual({
        ok: true,
        restoredLines: 1,
        skipped: [{ name: '홍실 키링 (파랑)', reason: 'sold_out' }],
        coupon: 'conditions_unmet',
        storeCreditUsed: 0,
      });
      expect(mocks.quote).toHaveBeenCalledWith([{ goodId: 'g2', variantId: variantB, qty: 1 }], null);
      expect(rpcCalls('apply_cart_coupon')).toHaveLength(1);
      expect(rpcCalls('clear_cart_coupon')).toHaveLength(1);
      expect(mocks.rows.cart_coupon_selections).toEqual([]);
    });

    it('대상 굿즈 없음·최소 결제액 유지도 사용 조건 미달로 본다', async () => {
      for (const reason of ['coupon_no_eligible_goods', 'coupon_no_discount']) {
        mocks.rows.cart_items = [];
        mocks.rows.cart_coupon_selections = [];
        mocks.quote.mockImplementation(quoteWithCouponReason(reason));
        await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toMatchObject({ coupon: 'conditions_unmet' });
        expect(mocks.rows.cart_coupon_selections).toEqual([]);
      }
    });

    it('고객이 이미 골라 둔 같은 쿠폰이 조건에 못 미치면 선택은 두고 conditions_unmet으로 답한다', async () => {
      mocks.rows.cart_coupon_selections = [{ user_id: userId, user_coupon_id: userCouponId }];
      mocks.quote.mockImplementation(quoteWithCouponReason('coupon_min_subtotal'));
      await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toMatchObject({ coupon: 'conditions_unmet' });
      expect(rpcCalls('apply_cart_coupon')).toEqual([]);
      expect(rpcCalls('clear_cart_coupon')).toEqual([]);
    });

    it('조건 미달 선택을 풀지 못해도 장바구니에서 확인하라는 conditions_unmet을 유지한다', async () => {
      mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => (
        name === 'clear_cart_coupon'
          ? Promise.resolve({ data: null, error: { message: 'boom' } })
          : cartRpc(name, args)
      ));
      mocks.quote.mockImplementation(quoteWithCouponReason('coupon_min_subtotal'));
      await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toMatchObject({ coupon: 'conditions_unmet' });
    });

    it('판매 견적을 읽지 못하면 restored라 단정하지 않고 고른 선택을 푼다', async () => {
      mocks.quote.mockResolvedValue(null);
      await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toMatchObject({ coupon: 'not_restored' });
      expect(rpcCalls('clear_cart_coupon')).toHaveLength(1);

      mocks.rows.cart_items = [];
      mocks.rows.cart_coupon_selections = [];
      mocks.quote.mockRejectedValue(new Error('network'));
      await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toMatchObject({ coupon: 'not_restored' });
    });

    /* 만료·다른 주문에 사용된 쿠폰은 장바구니 쿠폰 목록(active만)에 없어 다시 고를 수
       없다 — 장바구니에서 다시 고르라는 안내가 실제로 할 수 있는 행동과 다르다(E2-2). */
    it('다시 고를 수 없는 사유로 재선택이 거절되면 unavailable로 답한다', async () => {
      for (const reason of [
        'coupon_expired',
        'coupon_already_used',
        'coupon_not_found',
        'coupon_not_started',
        'coupon_first_purchase_only',
        'coupon_repeat_purchase_only',
      ]) {
        mocks.rows.cart_items = [];
        mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => (
          name === 'apply_cart_coupon'
            ? Promise.resolve({ data: null, error: { message: reason } })
            : cartRpc(name, args)
        ));
        await expect(restoreCanceledOrderToCartAction(orderId), reason).resolves.toMatchObject({
          ok: true,
          restoredLines: 2,
          coupon: 'unavailable',
        });
      }
      expect(mocks.quote).not.toHaveBeenCalled();
    });

    it('장바구니에서 풀 수 있는 사유나 알 수 없는 오류로 거절되면 not_restored로 답한다', async () => {
      for (const reason of ['coupon_first_purchase_reserved', 'coupon_first_purchase_pending', 'boom']) {
        mocks.rows.cart_items = [];
        mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => (
          name === 'apply_cart_coupon'
            ? Promise.resolve({ data: null, error: { message: reason } })
            : cartRpc(name, args)
        ));
        await expect(restoreCanceledOrderToCartAction(orderId), reason).resolves.toMatchObject({ coupon: 'not_restored' });
      }
    });

    it('고른 직후 쿠폰이 쓸 수 없게 되면 선택을 풀었을 때만 unavailable로 답한다', async () => {
      mocks.quote.mockImplementation(quoteWithCouponReason('coupon_expired'));
      await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toMatchObject({ coupon: 'unavailable' });
      expect(mocks.rows.cart_coupon_selections).toEqual([]);

      /* 선택이 남으면 주문서 제출이 막히므로 장바구니에서 해결하라는 결과로 낮춘다. */
      mocks.rows.cart_items = [];
      mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => (
        name === 'clear_cart_coupon'
          ? Promise.resolve({ data: null, error: { message: 'boom' } })
          : cartRpc(name, args)
      ));
      await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toMatchObject({ coupon: 'not_restored' });
    });

    it('장바구니에 이미 고른 다른 쿠폰은 덮지 않고, 같은 쿠폰이면 다시 적용된 것으로 본다', async () => {
      mocks.rows.cart_coupon_selections = [{ user_id: userId, user_coupon_id: otherUserCouponId }];
      await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toMatchObject({ coupon: 'not_restored' });
      expect(rpcCalls('apply_cart_coupon')).toEqual([]);

      mocks.rows.cart_coupon_selections = [{ user_id: userId, user_coupon_id: userCouponId }];
      await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toMatchObject({ coupon: 'restored' });
      expect(rpcCalls('apply_cart_coupon')).toEqual([]);
    });

    it('쿠폰 원장을 읽지 못하면 할인 주문은 not_restored로 답한다', async () => {
      mocks.failingTables.add('coupon_redemptions');
      await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toMatchObject({ coupon: 'not_restored' });
      expect(rpcCalls('apply_cart_coupon')).toEqual([]);
    });

    it('담긴 굿즈가 없으면 쿠폰을 빈 장바구니에 걸지 않는다', async () => {
      mocks.rpc.mockImplementation(() => Promise.resolve({ data: null, error: { message: 'out of stock' } }));
      await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toMatchObject({
        restoredLines: 0,
        coupon: 'not_restored',
      });
      expect(rpcCalls('apply_cart_coupon')).toEqual([]);
    });

    it('원 주문의 적립금 사용액을 돌려준다', async () => {
      mocks.rows.orders = [{ id: orderId, user_id: userId, status: 'canceled', discount_total: 0, store_credit_total: 2500 }];
      mocks.rows.coupon_redemptions = [];
      await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toEqual({
        ok: true,
        restoredLines: 2,
        skipped: [],
        coupon: 'none',
        storeCreditUsed: 2500,
      });
    });
  });

  it('장바구니에 이미 같은 옵션이 충분히 있으면 수량을 더하지 않는다', async () => {
    mocks.rows.cart_items = [
      { id: rowId(10), user_id: userId, good_id: 'g1', variant_id: variantA, qty: 3 },
    ];
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toEqual({
      ok: true, restoredLines: 2, skipped: [], coupon: 'none', storeCreditUsed: 0,
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenCalledWith('merge_cart_items', { p_items: [{ good_id: 'g1', variant_id: variantA, qty: 3, input_revision: 0, input_values: {} }] });
    expect(mocks.rpc).toHaveBeenCalledWith('merge_cart_items', { p_items: [{ good_id: 'g2', variant_id: variantB, qty: 1, input_revision: 0, input_values: {} }] });
  });

  it('장바구니를 읽은 뒤 늘어난 같은 항목 수량도 DB의 max 병합으로 보존한다', async () => {
    mocks.rows.order_items = [mocks.rows.order_items[0]];
    mocks.rows.cart_items = [{ id: rowId(10), user_id: userId, good_id: 'g1', variant_id: variantA, qty: 3 }];
    mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
      if (name === 'merge_cart_items') mocks.rows.cart_items[0].qty = 10;
      return cartRpc(name, args);
    });
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toMatchObject({ ok: true, restoredLines: 1 });
    expect(mocks.rows.cart_items[0].qty).toBe(10);
  });
});
