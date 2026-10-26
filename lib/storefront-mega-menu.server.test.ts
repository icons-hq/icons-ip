import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* 메가메뉴 로더는 전역 셸이 루트 레이아웃에서 부른다 — 쿠키 없는 anon 읽기(법적 문서 SSG 유지, #325)이고,
 * 세 원천(공개 메뉴 RPC·진행 중 캠페인·피처드 IP)은 서로의 실패에 끌려가지 않는다. */

const mocks = vi.hoisted(() => ({ create: vi.fn(), rpc: vi.fn(), from: vi.fn(), configured: true, calls: [] as Array<[string, unknown[]]> }));
/* unstable_cache 흉내 — 새 항목 경로처럼 콜백이 값을 돌려주면 저장하고, 던지면 아무것도 저장하지 않는다(next/dist/server/web/spec-extension/unstable-cache.js). */
const cache = vi.hoisted(() => ({ store: new Map<string, unknown>(), registrations: [] as Array<{ keyParts: unknown; options: unknown }> }));
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...args: unknown[]) => Promise<unknown>, keyParts: unknown, options: unknown) => {
    cache.registrations.push({ keyParts, options });
    return async (...args: unknown[]) => {
      const key = JSON.stringify([keyParts, args]);
      if (cache.store.has(key)) return cache.store.get(key);
      const value = await fn(...args);
      cache.store.set(key, value);
      return value;
    };
  },
}));
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.create }));
vi.mock('./supabase/config', () => ({ getSupabaseConfig: () => ({ url: 'https://local.example.test', key: 'anon-test', isConfigured: mocks.configured }) }));
import { getStorefrontMegaMenus, readStorefrontMegaMenus } from './storefront-mega-menu.server';
import { EMPTY_STOREFRONT_MEGA_MENUS, MENU_CAMPAIGN_LIMIT, MENU_CAMPAIGN_QUERY_LIMIT, STOREFRONT_MEGA_MENU_CACHE_TAG } from './storefront-mega-menu';

const id = (n: number) => `94932000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/* PostgREST 빌더 흉내 — 체인 호출을 기록하고 마지막에 정해진 응답을 돌려준다. */
function query(table: string, result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'lte', 'gt', 'order', 'limit', 'is', 'not']) {
    builder[method] = (...args: unknown[]) => { mocks.calls.push([`${table}.${method}`, args]); return builder; };
  }
  builder.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

const results: Record<string, { data: unknown; error: unknown }> = {};

const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
const MENU_ROWS = [
  { id: '94932000-0000-4000-8000-000000000001', parentId: null, name: '토이', depth: 1, imagePath: null, navigable: false },
  { id: '94932000-0000-4000-8000-000000000002', parentId: '94932000-0000-4000-8000-000000000001', name: '피규어', depth: 2, imagePath: null, navigable: true },
];
/* 배포·db reset 직후 PostgREST 스키마 캐시가 새 RPC 를 아직 모를 때의 응답(QA l5-qa-3 의 유력 원인). */
const SCHEMA_CACHE_MISS = { data: null, error: { code: 'PGRST202', message: 'Could not find the function public.get_storefront_category_menu without parameters in the schema cache' } };

afterEach(() => {
  errors.mockClear();
});

beforeEach(() => {
  cache.store.clear();
  mocks.calls = [];
  mocks.configured = true;
  mocks.rpc.mockReset().mockResolvedValue({ data: [
    { id: id(1), parentId: null, name: '토이', depth: 1, imagePath: null, navigable: false },
    { id: id(2), parentId: id(1), name: '피규어', depth: 2, imagePath: null, navigable: true },
  ], error: null });
  results.campaigns = { data: [{ id: 'c1', title: '가을 기획전', card_image_path: 'catalog/event/a.webp' }], error: null };
  results.ips = { data: [{ id: 'maple', public_slug: 'maple', title: 'MapleStory', bg: null, image_path: null, sort_order: 1 }], error: null };
  mocks.from.mockReset().mockImplementation((table: string) => query(table, results[table]));
  mocks.create.mockReset().mockReturnValue({
    rpc: mocks.rpc,
    from: mocks.from,
    storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example/public-media/${path}` } }) }) },
  });
});

describe('메가메뉴 로더', () => {
  it('쿠키 없는 클라이언트로 공개 메뉴·진행 중 기획전·피처드 IP를 읽는다', async () => {
    const now = new Date('2026-10-23T03:00:00.000Z');
    const { menus, failures } = await readStorefrontMegaMenus(now);
    expect(failures).toEqual([]);
    expect(errors).not.toHaveBeenCalled();

    expect(mocks.create.mock.calls[0][2].cookies.getAll()).toEqual([]);
    expect(mocks.rpc).toHaveBeenCalledWith('get_storefront_category_menu');
    expect(menus.categories.map((node) => node.name)).toEqual(['토이', '피규어']);
    expect(menus.campaigns).toEqual([{ id: 'c1', title: '가을 기획전', imageUrl: 'https://cdn.example/public-media/catalog/event/a.webp' }]);
    expect(menus.featuredIps).toEqual([{ id: 'maple', name: 'MapleStory', href: '/ip/maple', imageBg: null }]);
    /* 진행 중만 — 공개 상태, 시작했고 끝나지 않은 캠페인을 허브 배너 순서로. */
    expect(mocks.calls).toEqual(expect.arrayContaining([
      ['campaigns.eq', ['status', 'published']],
      ['campaigns.lte', ['starts_at', now.toISOString()]],
      ['campaigns.gt', ['ends_at', now.toISOString()]],
      ['campaigns.order', ['featured_order', { ascending: true, nullsFirst: false }]],
      ['campaigns.limit', [MENU_CAMPAIGN_QUERY_LIMIT]],
      ['ips.eq', ['featured', true]],
      ['ips.is', ['archived_at', null]],
      ['ips.not', ['published_at', 'is', null]],
    ]));
  });

  it('한 원천이 실패해도 나머지는 남고, 틀린 메뉴 트리는 기존 메뉴로 돌아간다 — 실패는 원천·코드로 서버 로그에 남는다', async () => {
    mocks.rpc.mockResolvedValue(SCHEMA_CACHE_MISS);
    results.campaigns = { data: null, error: { code: '42501', message: 'permission denied for table campaigns' } };
    const partial = await readStorefrontMegaMenus();
    expect(partial.menus.categories).toEqual([]);
    expect(partial.menus.campaigns).toEqual([]);
    expect(partial.menus.featuredIps).toHaveLength(1);
    expect(partial.failures).toEqual([
      { source: 'menu', code: 'PGRST202', message: SCHEMA_CACHE_MISS.error.message },
      { source: 'campaigns', code: '42501', message: 'permission denied for table campaigns' },
    ]);
    expect(errors.mock.calls).toEqual(partial.failures.map((failure) => ['[storefront/mega-menu] source read failed', failure]));

    errors.mockClear();
    results.campaigns = { data: [], error: null };
    mocks.rpc.mockResolvedValue({ data: [{ id: id(2), parentId: id(1), name: '고아', depth: 2, imagePath: null, navigable: true }], error: null });
    const invalid = await readStorefrontMegaMenus();
    expect(invalid.menus.categories).toEqual([]);
    expect(invalid.failures).toEqual([{ source: 'menu', code: 'invalid_menu_payload', message: 'menu tree failed validation' }]);
    expect(errors).toHaveBeenCalledTimes(1);
  });

  /* 리뷰 l5-data-1 — limit(8)이 검증보다 먼저 걸리면 검증에서 빠진 행 자리가 비어 8개 대신 7개만 보였다. */
  it('캠페인은 상한보다 넉넉히 읽어 검증에서 빠진 자리를 다음 순서의 캠페인으로 채운다', async () => {
    expect(MENU_CAMPAIGN_QUERY_LIMIT).toBeGreaterThan(MENU_CAMPAIGN_LIMIT);
    results.campaigns = { data: [
      { id: 'blank', title: '\u0007', card_image_path: null },
      { id: 'c0', title: '첫 기획전', card_image_path: null },
      { id: 'c0', title: '중복', card_image_path: null },
      ...Array.from({ length: 10 }, (_, index) => ({ id: `c${index + 1}`, title: `기획전 ${index + 1}`, card_image_path: null })),
    ], error: null };
    const { menus } = await readStorefrontMegaMenus();
    expect(menus.campaigns.map((campaign) => campaign.id)).toEqual(['c0', 'c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7']);
  });

  it('미설정 환경·예외에서는 빈 메뉴(= 기존 셸 메뉴)다 — 미설정은 실패가 아니고 예외는 실패다', async () => {
    mocks.configured = false;
    expect(await readStorefrontMegaMenus()).toEqual({ menus: EMPTY_STOREFRONT_MEGA_MENUS, failures: [] });
    mocks.configured = true;
    mocks.create.mockImplementation(() => { throw new Error('offline'); });
    expect(await readStorefrontMegaMenus()).toEqual({ menus: EMPTY_STOREFRONT_MEGA_MENUS, failures: [{ source: 'client', code: null, message: 'offline' }] });
    expect(await getStorefrontMegaMenus()).toEqual(EMPTY_STOREFRONT_MEGA_MENUS);
    expect(cache.store.size).toBe(0);
  });
});

/* QA l5-qa-3 — 빌드 직후 메뉴 RPC 한 번의 실패가 '카테고리 0개'로 300초 캐시돼 5분 동안 폴백 메뉴가 보였고 원인도 남지 않았다. */
describe('셸 메가메뉴 캐시', () => {
  it('300초·storefront-mega-menus 태그로 캐시한다', () => {
    expect(cache.registrations).toEqual([{ keyParts: ['storefront-mega-menus'], options: { revalidate: 300, tags: [STOREFRONT_MEGA_MENU_CACHE_TAG] } }]);
  });

  it('원천 읽기가 실패하면 읽은 부분으로 그리되 캐시하지 않아 다음 요청이 바로 다시 읽는다', async () => {
    mocks.rpc.mockResolvedValue(SCHEMA_CACHE_MISS);
    const failed = await getStorefrontMegaMenus();
    expect(failed.categories).toEqual([]);
    expect(failed.campaigns).toHaveLength(1);
    expect(failed.featuredIps).toHaveLength(1);
    expect(cache.store.size).toBe(0);
    expect(errors).toHaveBeenCalledWith('[storefront/mega-menu] source read failed', { source: 'menu', code: 'PGRST202', message: SCHEMA_CACHE_MISS.error.message });

    /* 원천이 돌아오면 다음 요청이 5분을 기다리지 않고 공개 전시 메뉴를 그리고, 그 값을 캐시한다. */
    mocks.rpc.mockResolvedValue({ data: MENU_ROWS, error: null });
    expect((await getStorefrontMegaMenus()).categories.map((node) => node.name)).toEqual(['토이', '피규어']);
    expect(cache.store.size).toBe(1);

    /* 캐시가 찬 뒤의 실패는 캐시 값을 덮지 않는다(캐시 적중이라 다시 읽지 않는다). */
    mocks.rpc.mockResolvedValue(SCHEMA_CACHE_MISS);
    expect((await getStorefrontMegaMenus()).categories).toHaveLength(2);
  });

  it('RPC 가 정상으로 돌려준 빈 트리(공개 스위치 OFF·공개 전시 없음)는 실패가 아니라 그대로 캐시한다', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect((await getStorefrontMegaMenus()).categories).toEqual([]);
    expect(cache.store.size).toBe(1);
    expect(errors).not.toHaveBeenCalled();
  });
});
