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
}));

vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: () => mocks.auth }));
vi.mock('@/lib/goods-sales.server', () => ({
  loadGoodsSalesQuote: (...args: unknown[]) => mocks.quote(...args),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    from(table: string) {
      const record = { table, eq: [] as [string, unknown][], in: [] as [string, unknown[]][] };
      mocks.queries.push(record);
      const result = () => {
        if (mocks.failingTables.has(table)) return { data: null, error: { message: 'boom' } };
        let rows = mocks.rows[table] ?? [];
        for (const [column, value] of record.eq) rows = rows.filter((row) => row[column] === value);
        for (const [column, values] of record.in) rows = rows.filter((row) => values.includes(row[column]));
        return { data: rows, error: null };
      };
      const query = {
        select: () => query,
        eq(column: string, value: unknown) { record.eq.push([column, value]); return query; },
        in(column: string, values: unknown[]) { record.in.push([column, values]); return query; },
        order: () => query,
        limit: () => query,
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

function rpcCalls(name: string) {
  return mocks.rpc.mock.calls.filter(([called]) => called === name);
}

/* 장바구니·쿠폰 선택 RPC가 실제로 행을 바꾸는 것처럼 흉내 낸다 — 쿠폰 재선택 뒤의 판매
   견적은 그 결과(담긴 굿즈·선택된 쿠폰)를 읽는다. */
function cartRpc(name: string, args: Record<string, unknown> = {}) {
  if (name === 'set_cart_item_quantity') {
    const rows = mocks.rows.cart_items ?? (mocks.rows.cart_items = []);
    const existing = rows.find((row) => row.user_id === userId && row.variant_id === args.p_variant_id);
    if (existing) existing.qty = args.p_qty;
    else rows.push({ user_id: userId, good_id: args.p_good_id, variant_id: args.p_variant_id, qty: args.p_qty });
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
    mocks.rpc.mockReset();
    mocks.rpc.mockImplementation(cartRpc);
    mocks.quote.mockReset();
    mocks.quote.mockImplementation(quoteWithCouponReason(null));
    mocks.rows = {
      orders: [{ id: orderId, user_id: userId, status: 'canceled', discount_total: 0, store_credit_total: 0 }],
      order_items: [
        { order_id: orderId, good_id: 'g1', variant_id: variantA, qty: 2, good_name_snapshot: '홍실 키링', variant_name_snapshot: '파랑' },
        { order_id: orderId, good_id: 'g2', variant_id: variantB, qty: 1, good_name_snapshot: '홍실 쿠션', variant_name_snapshot: null },
      ],
      cart_items: [],
    };
  });

  it('DB가 취소를 확정한 본인 주문의 품목을 장바구니 수량 RPC로 다시 담는다', async () => {
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toEqual({
      ok: true,
      restoredLines: 2,
      skipped: [],
      coupon: 'none',
      storeCreditUsed: 0,
    });
    expect(mocks.rpc).toHaveBeenCalledWith('set_cart_item_quantity', { p_good_id: 'g1', p_variant_id: variantA, p_qty: 2 });
    expect(mocks.rpc).toHaveBeenCalledWith('set_cart_item_quantity', { p_good_id: 'g2', p_variant_id: variantB, p_qty: 1 });
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
    await expect(restoreCanceledOrderToCartAction('not-a-uuid')).resolves.toEqual({ ok: false, error: 'not_found' });
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
    mocks.rpc.mockImplementation((_name: string, args: { p_variant_id: string }) => Promise.resolve(
      args.p_variant_id === variantA
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

  describe('원 주문의 혜택', () => {
    beforeEach(() => {
      mocks.rows.orders = [{ id: orderId, user_id: userId, status: 'canceled', discount_total: 3000, store_credit_total: 0 }];
      mocks.rows.coupon_redemptions = [{
        order_id: orderId,
        user_id: userId,
        user_coupon_id: userCouponId,
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

    /* apply_cart_coupon은 최소 주문 금액 미달·대상 굿즈 없음도 선택으로 받아들이고, 그
       선택은 주문서 제출을 막는다. 일부만 담긴 주문에서 그 쿠폰을 '다시 적용됨'으로 두면
       고객이 장바구니에서 직접 해제해야 남은 굿즈를 주문할 수 있다(E2-1). */
    it('일부만 담겨 쿠폰 조건에 못 미치면 고른 선택을 풀고 conditions_unmet으로 답한다', async () => {
      mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => (
        name === 'set_cart_item_quantity' && args.p_variant_id === variantA
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
      { user_id: userId, variant_id: variantA, qty: 3 },
      { user_id: userId, variant_id: variantB, qty: 0 },
    ];
    await expect(restoreCanceledOrderToCartAction(orderId)).resolves.toEqual({
      ok: true, restoredLines: 2, skipped: [], coupon: 'none', storeCreditUsed: 0,
    });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('set_cart_item_quantity', { p_good_id: 'g2', p_variant_id: variantB, p_qty: 1 });
  });
});
