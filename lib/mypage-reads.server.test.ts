import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMyHeldCoupons, loadMyWishlistEntries } from './mypage-reads.server';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  configured: true,
  throwOnCreate: false,
  results: {} as Record<string, { data: unknown; error: { code?: string; message: string } | null }>,
  calls: [] as unknown[][],
}));

vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: mocks.configured }) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    if (mocks.throwOnCreate) throw new Error('cookies unavailable');
    return {
      from(table: string) {
        mocks.calls.push(['from', table]);
        const query = {
          select: (columns: string) => { mocks.calls.push(['select', table, columns]); return query; },
          eq: (column: string, value: unknown) => { mocks.calls.push(['eq', table, column, value]); return query; },
          order: (column: string, options: unknown) => { mocks.calls.push(['order', table, column, options]); return query; },
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(mocks.results[table]).then(resolve),
        };
        return query;
      },
    };
  },
}));

const HELD = {
  id: '6c000000-0000-4000-8000-0000000000a1',
  status: 'active',
  issued_at: '2026-10-01T00:00:00.000Z',
  expires_at: null,
  usable_from: '2026-10-01T00:00:00.000Z',
  used_at: null,
  coupons: {
    code: 'CPN-PLAIN',
    name: '가을 쿠폰',
    discount_type: 'fixed',
    discount_value: 3000,
    max_discount_amount: null,
    min_subtotal: 10000,
    starts_at: '2026-09-01T00:00:00.000Z',
    ends_at: null,
    issue_starts_at: null,
    status: 'active',
    grade_benefit: null,
    benefit_kind: 'goods',
    stackable: false,
    recipient_segment: 'all',
    goods_scope: 'all',
    target_good_ids: [],
    target_category_ids: [],
    issuance_mode: 'code',
    recipient_reason: null,
  },
};

/* PostgREST 가 돌려주는 실제 오류 모양(504 게이트웨이·권한 오류) — 기존 로더는 이때 빈 배열을 돌려줬다(l6-data-3). */
const GATEWAY_ERROR = { code: 'PGRST000', message: 'upstream request timeout (504)' };

describe('mypage member reads', () => {
  beforeEach(() => {
    mocks.configured = true;
    mocks.throwOnCreate = false;
    mocks.calls = [];
    mocks.results = {
      wishlists: { data: [{ good_id: 'g2', created_at: '2026-10-02' }, { good_id: 'g1', created_at: '2026-09-01' }], error: null },
      user_coupons: { data: [HELD], error: null },
    };
  });

  it("reads the member's own wishes most recent first and their held coupons", async () => {
    expect(await loadMyWishlistEntries('user-1')).toEqual([
      { goodId: 'g2', createdAt: '2026-10-02' },
      { goodId: 'g1', createdAt: '2026-09-01' },
    ]);
    expect(mocks.calls).toContainEqual(['eq', 'wishlists', 'user_id', 'user-1']);
    expect(mocks.calls).toContainEqual(['order', 'wishlists', 'created_at', { ascending: false }]);

    const coupons = await loadMyHeldCoupons('user-1');
    expect(coupons?.map((held) => held.coupon.name)).toEqual(['가을 쿠폰']);
    expect(mocks.calls).toContainEqual(['eq', 'user_coupons', 'user_id', 'user-1']);
  });

  it('tells an empty list apart from a failed read', async () => {
    mocks.results.wishlists = { data: [], error: null };
    mocks.results.user_coupons = { data: [], error: null };
    expect(await loadMyWishlistEntries('user-1')).toEqual([]);
    expect(await loadMyHeldCoupons('user-1')).toEqual([]);

    mocks.results.wishlists = { data: null, error: GATEWAY_ERROR };
    mocks.results.user_coupons = { data: null, error: GATEWAY_ERROR };
    expect(await loadMyWishlistEntries('user-1')).toBeNull();
    expect(await loadMyHeldCoupons('user-1')).toBeNull();
  });

  it('returns null when the client cannot be built and a broken coupon payload', async () => {
    mocks.results.user_coupons = { data: [{ ...HELD, id: 'not-a-uuid' }], error: null };
    expect(await loadMyHeldCoupons('user-1')).toBeNull();

    mocks.throwOnCreate = true;
    expect(await loadMyWishlistEntries('user-1')).toBeNull();
    expect(await loadMyHeldCoupons('user-1')).toBeNull();
  });

  it('keeps the mock mode empty without a backend', async () => {
    mocks.configured = false;
    expect(await loadMyWishlistEntries('user-1')).toEqual([]);
    expect(await loadMyHeldCoupons('user-1')).toEqual([]);
    expect(mocks.calls).toEqual([]);
  });
});
