import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * 목록 정렬 순서·BEST 기간 순위 로더 (스펙 C §2.12). 쿠키 없는 anon 읽기 + 120초 캐시이고, RPC 는 정렬된 굿즈 id 배열만 돌려준다.
 * 읽기 실패·모양 불일치는 null 로 떨어져 호출부가 정렬을 스코프 순서로(목록 유지), BEST 는 실패 안내로 그린다.
 */

const mocks = vi.hoisted(() => ({
  response: { data: null as unknown, error: null as null | { code?: string; message: string } },
  calls: [] as Array<{ name: string; args: unknown }>,
  configured: true,
  cacheOptions: [] as Array<{ keys: string[]; options: { revalidate?: number; tags?: string[] } }>,
}));
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => Promise<unknown>, keys: string[], options: { revalidate?: number; tags?: string[] }) => {
    mocks.cacheOptions.push({ keys, options });
    return fn;
  },
}));
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: { getAll: () => unknown[] } }) => {
    /* 쿠키 없는 클라이언트다 — 사람마다 같은 값이라 캐시해도 되는 이유다. */
    expect(options.cookies.getAll()).toEqual([]);
    return { rpc: async (name: string, args?: unknown) => { mocks.calls.push({ name, args }); return mocks.response; } };
  },
}));
vi.mock('./supabase/config', () => ({
  getSupabaseConfig: () => (mocks.configured
    ? { url: 'https://local.example.test', key: 'anon-test', isConfigured: true }
    : { url: null, key: null, isConfigured: false }),
}));

import { LISTING_SORT_ORDERS_CACHE_TAG, loadListingSortOrders, loadSalesRanking, SALES_RANKING_LIMIT } from './goods-listing-orders.server';

const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

beforeEach(() => {
  mocks.response = { data: null, error: null };
  mocks.calls = [];
  mocks.configured = true;
});

afterEach(() => {
  errors.mockClear();
});

describe('loadListingSortOrders', () => {
  it('get_goods_listing_orders 를 인자 없이 부르고 세 정렬의 id 배열을 돌려준다', async () => {
    mocks.response = { data: { popular: ['c', 'a'], sales: ['b'], reviews: [] }, error: null };

    expect(await loadListingSortOrders()).toEqual({ popular: ['c', 'a'], sales: ['b'], reviews: [] });
    expect(mocks.calls).toEqual([{ name: 'get_goods_listing_orders', args: undefined }]);
  });

  it('읽기 실패·응답 모양 불일치는 null 이다 — 던지지 않고 기록만 남긴다(목록은 막지 않는다)', async () => {
    mocks.response = { data: null, error: { code: '42501', message: 'permission denied' } };
    expect(await loadListingSortOrders()).toBeNull();

    mocks.response = { data: { popular: ['a'], sales: 'nope', reviews: [] }, error: null };
    expect(await loadListingSortOrders()).toBeNull();

    mocks.response = { data: [], error: null };
    expect(await loadListingSortOrders()).toBeNull();
    expect(errors).toHaveBeenCalledTimes(3);
  });

  it('설정 없는 환경(mock 카탈로그)은 정렬 지표가 없다 — null 이고 RPC 를 부르지 않는다', async () => {
    mocks.configured = false;

    expect(await loadListingSortOrders()).toBeNull();
    expect(mocks.calls).toEqual([]);
  });
});

describe('loadSalesRanking', () => {
  it('기간과 상한 100 으로 get_goods_sales_ranking 을 부르고 id 배열을 돌려준다', async () => {
    mocks.response = { data: ['x', 'y', 'z'], error: null };

    expect(await loadSalesRanking('weekly')).toEqual(['x', 'y', 'z']);
    expect(SALES_RANKING_LIMIT).toBe(100);
    expect(mocks.calls).toEqual([{ name: 'get_goods_sales_ranking', args: { p_period: 'weekly', p_limit: 100 } }]);
  });

  it('빈 기간은 빈 배열이고 읽기 실패·id 가 아닌 값은 null 이라 BEST 가 "집계 없음"과 "읽지 못함"을 가른다', async () => {
    mocks.response = { data: [], error: null };
    expect(await loadSalesRanking('daily')).toEqual([]);

    mocks.response = { data: null, error: { message: 'timeout' } };
    expect(await loadSalesRanking('daily')).toBeNull();

    mocks.response = { data: ['a', 2], error: null };
    expect(await loadSalesRanking('daily')).toBeNull();

    mocks.response = { data: { weekly: [] }, error: null };
    expect(await loadSalesRanking('daily')).toBeNull();
  });

  it('설정 없는 환경은 집계할 주문이 없다 — 읽기 실패가 아니라 빈 순위다', async () => {
    mocks.configured = false;

    expect(await loadSalesRanking('realtime')).toEqual([]);
    expect(mocks.calls).toEqual([]);
  });
});

describe('캐시', () => {
  it('두 읽기는 120초 캐시와 같은 태그(listing-sort-orders)를 쓴다', () => {
    expect(LISTING_SORT_ORDERS_CACHE_TAG).toBe('listing-sort-orders');
    expect(mocks.cacheOptions.map((entry) => entry.keys[0]).sort()).toEqual(['goods-listing-orders', 'goods-sales-ranking']);
    for (const entry of mocks.cacheOptions) expect(entry.options).toEqual({ revalidate: 120, tags: ['listing-sort-orders'] });
  });
});
