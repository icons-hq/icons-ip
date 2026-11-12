import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn(), from: vi.fn(), configured: true }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: mocks.configured }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc, from: mocks.from }) }));
import { loadCartCouponState, loadLoyaltyStatus, loadMyCoupons } from './coupons.server';
beforeEach(() => { vi.clearAllMocks(); mocks.configured = true; mocks.getUser.mockResolvedValue({ data: { user: { id: 'self' } }, error: null }); });
describe('loyalty display aggregate', () => {
  it('uses the self-only database aggregate and current count-only policy', async () => {
    mocks.rpc.mockResolvedValue({ data: { grade: 'welcome', windowSpend: 9000000, windowItemCount: 1001,
      policy: { revision: 8, updatedAt: '2026-10-13T03:00:00Z', tiers: [
        { grade: 'silver', enabled: true, amount: null, itemCount: 1002 },
        { grade: 'gold', enabled: true, amount: null, itemCount: 2000 },
        { grade: 'platinum', enabled: false, amount: null, itemCount: null },
      ] } }, error: null });
    expect(await loadLoyaltyStatus()).toEqual({ grade: 'welcome', windowSpend: 9000000, windowItemCount: 1001, nextNote: 'SILVER까지 굿즈 주문 항목 1건' });
    expect(mocks.rpc).toHaveBeenCalledWith('get_my_loyalty_status');
  });
  it('does not report zero spend or stale thresholds when reading fails', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
    expect(await loadLoyaltyStatus()).toBeNull();
  });
  it('does not query private status before login', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await loadLoyaltyStatus()).toBeNull(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

/* QA1 S-D2-08: 결제 대기 주문이 잡은 쿠폰을 장바구니·주문서 쿠폰 칸과 쿠폰함이 알아본다. */
describe('결제를 마치지 않은 주문이 잡은 쿠폰', () => {
  const definition = { code: 'CPNFIRST', name: '첫구매 3천원', discount_type: 'fixed', discount_value: 3000, max_discount_amount: null, min_subtotal: 10000,
    starts_at: '2026-01-01T00:00:00Z', ends_at: null, status: 'active', grade_benefit: null, recipient_segment: 'all', goods_scope: 'all', target_good_ids: [], recipient_reason: null };
  const row = (id: string, status: 'active' | 'used', issuedAt: string) => ({ id, status, issued_at: issuedAt, expires_at: null, used_at: status === 'used' ? '2026-11-12T00:00:00Z' : null, coupons: definition });
  const active = row('11111111-1111-4111-8111-111111111111', 'active', '2026-11-01T00:00:00Z');
  const held = row('22222222-2222-4222-8222-222222222222', 'used', '2026-11-05T00:00:00Z');
  const confirming = row('44444444-4444-4444-8444-444444444444', 'used', '2026-11-06T00:00:00Z');
  const order = '33333333-3333-4333-8333-333333333333';
  type Filters = { status?: string; ids?: string[] };
  function query(rows: (filters: Filters) => unknown[]) {
    const filters: Filters = {};
    const builder = {
      select: () => builder,
      eq: (column: string, value: string) => { if (column === 'status') filters.status = value; return builder; },
      in: (_column: string, values: string[]) => { filters.ids = values; return builder; },
      order: () => builder,
      maybeSingle: async () => ({ data: { user_coupon_id: held.id }, error: null }),
      then: (resolve: (value: unknown) => void) => resolve({ data: rows(filters), error: null }),
    };
    return builder;
  }
  beforeEach(() => {
    mocks.rpc.mockResolvedValue({ data: [
      { userCouponId: held.id, orderId: order, orderNumber: '2026111200000001', paymentMethod: 'card', replaceable: true },
      { userCouponId: confirming.id, orderId: order, orderNumber: '2026111200000001', paymentMethod: 'card', replaceable: false },
    ], error: null });
    mocks.from.mockImplementation((table: string) => query((filters) => table !== 'user_coupons' ? []
      : filters.status === 'active' ? [active]
        : filters.status === 'used' ? [held, confirming].filter((candidate) => filters.ids?.includes(candidate.id))
          : [confirming, held, active]));
  });

  it('장바구니 쿠폰 칸은 다음 새 주문이 닫을 주문이 잡은 쿠폰만 더 싣는다', async () => {
    const state = await loadCartCouponState();
    expect(mocks.rpc).toHaveBeenCalledWith('get_my_unpaid_order_coupons');
    expect(state.coupons.map((coupon) => coupon.id)).toEqual([held.id, active.id]);
    expect(state.coupons[0].pendingOrder).toEqual({ orderId: order, orderNumber: '2026111200000001', paymentMethod: 'card', replaceable: true });
    expect(state.selectedUserCouponId).toBe(held.id);
  });

  it('주문을 읽지 못하면 지금처럼 쓸 수 있는 쿠폰만 싣는다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
    const state = await loadCartCouponState();
    expect(state.coupons.map((coupon) => coupon.id)).toEqual([active.id]);
    expect(state.unavailable).toBeUndefined();
  });

  it('쿠폰함은 사용 처리된 쿠폰에 그 주문을 붙인다', async () => {
    const coupons = await loadMyCoupons();
    expect(coupons?.find((coupon) => coupon.id === held.id)?.pendingOrder?.replaceable).toBe(true);
    expect(coupons?.find((coupon) => coupon.id === confirming.id)?.pendingOrder?.replaceable).toBe(false);
    expect(coupons?.find((coupon) => coupon.id === active.id)?.pendingOrder).toBeUndefined();
  });
});
