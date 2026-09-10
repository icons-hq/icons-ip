import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getAdminCouponListData } from './coupons.server';
import { normalizeAdminCouponFilters } from './coupons';

const mocks = vi.hoisted(() => ({
  adminState: {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.gg' },
    role: 'staff' as const,
    isStaff: true,
  },
  client: null as unknown,
}));

vi.mock('@/lib/auth/admin', () => ({
  getCurrentAdminAuthState: () => mocks.adminState,
}));
vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  redirect: (path: string) => { throw new Error(`NEXT_REDIRECT:${path}`); },
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: () => mocks.client,
}));

type Result = {
  data: unknown[] | Record<string, unknown> | null;
  count?: number;
  error: { message: string } | null;
};

function database(results: Result[]) {
  const calls: unknown[][] = [];
  const query = (result: Result) => {
    const builder = {
      select: (...args: unknown[]) => { calls.push(['select', ...args]); return builder; },
      eq: (...args: unknown[]) => { calls.push(['eq', ...args]); return builder; },
      maybeSingle: () => Promise.resolve(result),
      then: (resolve: (value: Result) => unknown) => Promise.resolve(result).then(resolve),
    };
    return builder;
  };

  mocks.client = {
    rpc: (...args: unknown[]) => {
      calls.push(['rpc', ...args]);
      return query(results.shift()!);
    },
    from: (...args: unknown[]) => {
      calls.push(['from', ...args]);
      return query(results.shift()!);
    },
  };
  return calls;
}

const row = (code: string, usedCount = 0) => ({
  code,
  name: `${code} 쿠폰`,
  discount_type: 'fixed',
  discount_value: 3000,
  max_discount_amount: null,
  min_subtotal: 20000,
  starts_at: '2026-09-01T00:00:00.000Z',
  ends_at: null,
  issue_limit: null,
  issued_count: 0,
  status: 'active',
  grade_benefit: null,
  recipient_segment: 'all', goods_scope: 'all', target_good_ids: [], terms_revision: 1, target_goods: [],
  used_count: usedCount,
});

beforeEach(() => {
  mocks.adminState = {
    isConfigured: true,
    user: { id: 'staff-1', email: 'staff@icons.gg' },
    role: 'staff',
    isStaff: true,
  };
});

describe('admin coupon list server boundary', () => {
  it('does not broaden an invalid search into an unfiltered list', async () => {
    const calls = database([]);
    const data = await getAdminCouponListData(normalizeAdminCouponFilters({ q: 'x'.repeat(101) }));
    expect(data.records).toEqual([]);
    expect(data.filters.inputError).toContain('100자');
    expect(calls).toEqual([]);
  });
  it('uses the matching total inside the paginated RPC instead of its output row count', async () => {
    const calls = database([{
      data: [{ ...row('AUTUMN-3000', 2), total_count: 41 }],
      count: 1,
      error: null,
    }]);

    const data = await getAdminCouponListData(normalizeAdminCouponFilters({
      page: '2',
      q: 'AUTUMN',
      status: 'active',
    }));

    expect(data.records).toHaveLength(1);
    expect(data.records[0]?.usedCount).toBe(2);
    expect(data.total).toBe(41);
    expect(calls).toContainEqual([
      'rpc',
      'admin_search_coupons',
      { p_query: 'AUTUMN', p_status: 'active', p_limit: 20, p_offset: 20 },
    ]);
    expect(calls).toContainEqual([
      'select',
      'code,name,discount_type,discount_value,max_discount_amount,min_subtotal,starts_at,ends_at,issue_limit,issued_count,status,grade_benefit,recipient_segment,goods_scope,target_good_ids,terms_revision,used_count,total_count,target_goods',
    ]);
    expect(calls.filter(([kind]) => kind === 'from')).toHaveLength(0);
  });

  it('rewinds a page that became empty without reading the catalogue', async () => {
    const calls = database([
      { data: [], count: 20, error: null },
      { data: [{ ...row('LAST-COUPON'), total_count: 20 }], count: 1, error: null },
    ]);

    const data = await getAdminCouponListData(normalizeAdminCouponFilters({ page: '2' }));

    expect(data.filters.page).toBe(1);
    expect(data.records[0]?.code).toBe('LAST-COUPON');
    expect(calls.filter(([kind]) => kind === 'rpc')).toHaveLength(2);
  });

  it('keeps an off-page selected coupon by reading only that definition and its applied count', async () => {
    const calls = database([
      { data: [{ ...row('PAGE-COUPON'), total_count: 21 }], count: 1, error: null },
      { data: row('SELECTED-COUPON', 0), error: null },
      { data: null, count: 7, error: null },
    ]);

    const data = await getAdminCouponListData(normalizeAdminCouponFilters({
      couponCode: 'selected-coupon',
      page: '1',
    }));

    expect(data.selectedRecord).toMatchObject({ code: 'SELECTED-COUPON', usedCount: 7 });
    expect(calls).toContainEqual(['from', 'coupons']);
    expect(calls).toContainEqual(['from', 'coupon_redemptions']);
    expect(calls).toContainEqual(['eq', 'code', 'SELECTED-COUPON']);
    expect(calls).toContainEqual(['eq', 'coupon_code', 'SELECTED-COUPON']);
    expect(calls).toContainEqual(['eq', 'status', 'applied']);
  });
});
