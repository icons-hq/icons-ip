import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getGoodEngagement, pendingRestockState } from './wishlist.server';

const mocks = vi.hoisted(() => ({
  configured: true,
  userId: 'user-1' as string | null,
  wish: { data: null as { good_id: string } | null, error: null as { message: string } | null },
  restock: { data: [] as { variant_id: string | null; status: string }[] | null, error: null as { message: string } | null },
  restockFilters: [] as [string, unknown][],
}));

vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: mocks.configured }) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.userId ? { id: mocks.userId } : null }, error: null }) },
    from: (table: string) => {
      if (table === 'wishlists') {
        const query = { select: () => query, eq: () => query, maybeSingle: async () => mocks.wish };
        return query;
      }
      if (table === 'restock_alerts') {
        /* 재입고 신청은 여러 행이다 — maybeSingle 이 아니라 목록으로 끝나야 한다. */
        const query = {
          select: () => query,
          eq: (column: string, value: unknown) => { mocks.restockFilters.push([column, value]); return query; },
          maybeSingle: async () => { throw new Error('restock alerts must be read as a list'); },
          then: (resolve: (value: unknown) => unknown) => Promise.resolve(mocks.restock).then(resolve),
        };
        return query;
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

const B = '00000000-0000-4000-8000-000000056711';
const C = '00000000-0000-4000-8000-000000056712';

beforeEach(() => {
  mocks.configured = true;
  mocks.userId = 'user-1';
  mocks.wish = { data: { good_id: 'g11' }, error: null };
  mocks.restock = { data: [], error: null };
  mocks.restockFilters = [];
});

describe('pendingRestockState (PD-11)', () => {
  it('나누어 센다 — "모든 옵션" 신청은 굿즈 단위 표식, 옵션 신청은 옵션 id', () => {
    expect(pendingRestockState([
      { variant_id: null, status: 'pending' },
      { variant_id: B, status: 'pending' },
      { variant_id: C, status: 'notified' },
    ])).toEqual({ restockRequested: true, restockVariantIds: [B] });
  });

  it('알림을 받은 신청(notified)은 다시 신청할 수 있어야 하므로 세지 않는다', () => {
    expect(pendingRestockState([{ variant_id: null, status: 'notified' }, { variant_id: B, status: 'notified' }]))
      .toEqual({ restockRequested: false, restockVariantIds: [] });
    expect(pendingRestockState([])).toEqual({ restockRequested: false, restockVariantIds: [] });
  });
});

describe('getGoodEngagement', () => {
  /* 예전에는 .eq(good_id).maybeSingle() 이라 신청이 두 행부터 오류가 나 신청 상태가 false 로 접혔다. */
  it('한 굿즈의 여러 신청 행을 모두 읽어 옵션별 상태를 낸다', async () => {
    mocks.restock = { data: [{ variant_id: null, status: 'pending' }, { variant_id: B, status: 'pending' }, { variant_id: C, status: 'pending' }], error: null };

    await expect(getGoodEngagement(' g11 ')).resolves.toEqual({ wished: true, restockRequested: true, restockVariantIds: [B, C] });
    expect(mocks.restockFilters).toEqual([['user_id', 'user-1'], ['good_id', 'g11'], ['status', 'pending']]);
  });

  it('신청 조회가 실패해도 위시 표시는 맞고 신청 상태만 기본값으로 접는다', async () => {
    mocks.restock = { data: null, error: { message: 'boom' } };

    await expect(getGoodEngagement('g11')).resolves.toEqual({ wished: true, restockRequested: false, restockVariantIds: [] });
  });

  it('게스트·mock 모드는 읽지 않고 빈 상태다', async () => {
    mocks.userId = null;
    await expect(getGoodEngagement('g11')).resolves.toEqual({ wished: false, restockRequested: false, restockVariantIds: [] });
    mocks.configured = false;
    await expect(getGoodEngagement('g11')).resolves.toEqual({ wished: false, restockRequested: false, restockVariantIds: [] });
    expect(mocks.restockFilters).toEqual([]);
  });
});
