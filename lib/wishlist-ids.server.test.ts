import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listingWishSet } from './listing-wishlist';
import { loadListingWishlist } from './wishlist-ids.server';

/* 목록 하트의 배치 ID 로더(CL-01) — 카드 수와 무관하게 회원당 질의 한 번, 잘린 응답은 실패로 접는다. */

const mocks = vi.hoisted(() => ({
  configured: true,
  user: { id: 'user-1' } as { id: string } | null,
  pages: [] as { data: { id: string }[] | null; error: { message: string } | null; count: number | null }[],
  calls: [] as { filters: [string, string, string][]; limit: number | null }[],
}));

vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: mocks.configured }) }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user }, error: mocks.user ? null : { message: 'no session' } }) },
    from: (table: string) => {
      const call = { filters: [] as [string, string, string][], limit: null as number | null };
      mocks.calls.push(call);
      const builder = {
        select: (columns: string, options: { count: string }) => {
          call.filters.push(['select', columns, options.count]);
          return builder;
        },
        eq: (column: string, value: string) => { call.filters.push(['eq', column, value]); return builder; },
        gt: (column: string, value: string) => { call.filters.push(['gt', column, value]); return builder; },
        order: (column: string) => { call.filters.push(['order', column, table]); return builder; },
        limit: (value: number) => { call.limit = value; return builder; },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(mocks.pages.shift()).then(resolve),
      };
      return builder;
    },
  }),
}));

beforeEach(() => {
  mocks.configured = true;
  mocks.user = { id: 'user-1' };
  mocks.pages = [];
  mocks.calls = [];
});

describe('loadListingWishlist', () => {
  it('returns null in mock mode — there is nowhere to store a wish, so no hearts are drawn', async () => {
    mocks.configured = false;
    expect(await loadListingWishlist()).toBeNull();
    expect(mocks.calls).toHaveLength(0);
  });

  it('marks a guest as signed out without reading the table', async () => {
    mocks.user = null;
    expect(await loadListingWishlist()).toEqual({ signedIn: false, goodIds: [] });
    expect(mocks.calls).toHaveLength(0);
  });

  it('reads only the signed-in member’s wish ids in one bounded query', async () => {
    mocks.pages = [{ data: [{ id: 'g1' }, { id: 'g7' }], error: null, count: 2 }];

    expect(await loadListingWishlist()).toEqual({ signedIn: true, goodIds: ['g1', 'g7'] });
    expect(mocks.calls).toHaveLength(1);
    expect(mocks.calls[0].filters).toContainEqual(['select', 'id:good_id', 'exact']);
    expect(mocks.calls[0].filters).toContainEqual(['eq', 'user_id', 'user-1']);
  });

  it('pages past the API row cap with an id cursor instead of silently truncating', async () => {
    mocks.pages = [
      { data: [{ id: 'a' }, { id: 'b' }], error: null, count: 3 },
      { data: [{ id: 'c' }], error: null, count: 1 },
    ];

    expect((await loadListingWishlist())?.goodIds).toEqual(['a', 'b', 'c']);
    expect(mocks.calls[1].filters).toContainEqual(['gt', 'good_id', 'b']);
  });

  /* 공개 목록은 위시 상태를 못 읽었다고 실패하면 안 된다 — 빈 집합으로 접는다. */
  it('folds a failed or changing read into an empty set while keeping the member signed in', async () => {
    mocks.pages = [{ data: null, error: { message: 'boom' }, count: null }];
    expect(await loadListingWishlist()).toEqual({ signedIn: true, goodIds: [] });

    mocks.pages = [{ data: [{ id: 'a' }], error: null, count: 2 }, { data: [], error: null, count: 0 }];
    expect(await loadListingWishlist()).toEqual({ signedIn: true, goodIds: [] });
  });
});

describe('listingWishSet', () => {
  it('builds the lookup set only for signed-in members', () => {
    expect(listingWishSet({ signedIn: true, goodIds: ['g1', 'g2'] }).has('g2')).toBe(true);
    expect(listingWishSet({ signedIn: false, goodIds: ['g1'] }).size).toBe(0);
    expect(listingWishSet(null).size).toBe(0);
    expect(listingWishSet(undefined).has('g1')).toBe(false);
  });
});
