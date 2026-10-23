import { beforeEach, describe, expect, it, vi } from 'vitest';

/* 메가메뉴 로더는 전역 셸이 루트 레이아웃에서 부른다 — 쿠키 없는 anon 읽기(법적 문서 SSG 유지, #325)이고,
 * 세 원천(공개 메뉴 RPC·진행 중 캠페인·피처드 IP)은 서로의 실패에 끌려가지 않는다. */

const mocks = vi.hoisted(() => ({ create: vi.fn(), rpc: vi.fn(), from: vi.fn(), configured: true, calls: [] as Array<[string, unknown[]]> }));
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.create }));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock('./supabase/config', () => ({ getSupabaseConfig: () => ({ url: 'https://local.example.test', key: 'anon-test', isConfigured: mocks.configured }) }));
import { loadStorefrontMegaMenus } from './storefront-mega-menu.server';
import { EMPTY_STOREFRONT_MEGA_MENUS } from './storefront-mega-menu';

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

beforeEach(() => {
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
    const menus = await loadStorefrontMegaMenus(now);

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
      ['campaigns.limit', [8]],
      ['ips.eq', ['featured', true]],
      ['ips.is', ['archived_at', null]],
      ['ips.not', ['published_at', 'is', null]],
    ]));
  });

  it('한 원천이 실패해도 나머지는 남고, 틀린 메뉴 트리는 기존 메뉴로 돌아간다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'missing function' } });
    results.campaigns = { data: null, error: { message: 'rls' } };
    const partial = await loadStorefrontMegaMenus();
    expect(partial.categories).toEqual([]);
    expect(partial.campaigns).toEqual([]);
    expect(partial.featuredIps).toHaveLength(1);

    mocks.rpc.mockResolvedValue({ data: [{ id: id(2), parentId: id(1), name: '고아', depth: 2, imagePath: null, navigable: true }], error: null });
    expect((await loadStorefrontMegaMenus()).categories).toEqual([]);
  });

  it('미설정 환경·예외에서는 빈 메뉴(= 기존 셸 메뉴)다', async () => {
    mocks.configured = false;
    expect(await loadStorefrontMegaMenus()).toEqual(EMPTY_STOREFRONT_MEGA_MENUS);
    mocks.configured = true;
    mocks.create.mockImplementation(() => { throw new Error('offline'); });
    expect(await loadStorefrontMegaMenus()).toEqual(EMPTY_STOREFRONT_MEGA_MENUS);
  });
});
