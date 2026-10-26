import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { CategoryDisplayNavigation, CategoryDisplayPage } from '@/lib/category-display';
import type { Good } from '@/lib/data';
import Page from './page';

/* /shop 상단 카테고리 전시 내비(굿즈샵·카테고리 전시 페이지 공용). 내비는 Shop 의 .wc-root 밖 형제라 자기 토큰 스코프가
 * 없으면 --wc-container-max·--wc-gutter·--wc-hairline 이 비어 x0 에서 칩 선 없는 맨 글자로 섰다(l4-qa-2). */

const DISPLAY_ID = '5a4c3000-0000-4000-8000-000000000001';
const mocks = vi.hoisted(() => ({
  goods: [] as Good[],
  navigation: [] as CategoryDisplayNavigation[],
  navigationFails: false,
  page: null as CategoryDisplayPage | null,
  wishlist: null as { viewerId: string | null; goodIds: string[] } | null,
}));

vi.mock('@/lib/catalog-categories.server', () => ({ loadPublicCatalogCategories: async () => [] }));
vi.mock('@/lib/wishlist-ids.server', () => ({ loadListingWishlist: async () => mocks.wishlist }));
vi.mock('@/app/shop/actions', () => ({ toggleWishlistAction: vi.fn() }));
vi.mock('@/lib/category-display.server', () => ({
  loadCategoryDisplayNavigation: async () => {
    if (mocks.navigationFails) throw new Error('rpc');
    return mocks.navigation;
  },
  loadCategoryDisplayPage: async () => mocks.page,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/shop',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
}));
vi.mock('@/lib/catalog', () => ({
  getCatalogSnapshot: async (): Promise<CatalogSnapshot> => ({
    source: 'supabase', verticals: [], ips: [], goods: mocks.goods, cards: [], events: [],
  }),
}));

function good(id: string, overrides: Partial<Good> = {}): Good {
  return { id, ip: 'ip1', name: `굿즈 ${id}`, type: '키링', price: 10000, badge: null, stock: 'ok', stockQty: 5, img: 'none', ...overrides };
}

function displayPage(goods: Good[]): CategoryDisplayPage {
  return {
    category: { id: DISPLAY_ID, name: 'QA 인형 전시' }, checkedAt: '2026-10-23T00:00:00.000Z', token: 'token-1', offset: 0, nextOffset: null,
    query: { displayCategory: DISPLAY_ID, view: 'all', ips: [], types: [], priceMin: null, priceMax: null, sort: 'recommended' },
    result: { goods, filteredTotal: goods.length, total: goods.length, priceCeil: 10000, ipFacets: [], typeFacets: [] },
    navigation: mocks.navigation, banner: null, video: null, recommendations: null,
  };
}

async function render(params: Record<string, string | string[] | undefined> = {}) {
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
}

/** 같은 .wc-root 상자 안에 든 내비 마크업을 돌려준다 — 내비가 토큰 스코프 밖이면 null. */
function navInsideRoot(html: string) {
  return html.match(/<div class="wc-root"><nav class="wc-category-display__navigation wc-container"[^>]*>.*?<\/nav>/)?.[0] ?? null;
}

beforeEach(() => {
  mocks.goods = [good('a', { name: '첫 굿즈' })];
  mocks.navigation = [{ id: DISPLAY_ID, name: 'QA 인형 전시', depth: 0 }];
  mocks.navigationFails = false;
  mocks.page = null;
  mocks.wishlist = null;
});

describe('/shop 카테고리 전시 내비 토큰 스코프 (l4-qa-2)', () => {
  it('굿즈샵 상단 내비는 자기 .wc-root 안에 서고 컬렉션보다 앞에 온다', async () => {
    const html = await render();
    const nav = navInsideRoot(html);

    expect(nav).not.toBeNull();
    expect(nav).toContain('href="/shop"');
    expect(nav).toContain(`href="/shop?displayCategory=${DISPLAY_ID}"`);
    expect(html.indexOf('wc-category-display__navigation')).toBeLessThan(html.indexOf('class="wc-root wc-collection"'));
  });

  it('내비를 불러오지 못한 안내도 같은 .wc-root 안의 컨테이너 문단이다', async () => {
    mocks.navigationFails = true;
    const html = await render();

    expect(html).toMatch(/<div class="wc-root"><p class="wc-container" role="status">카테고리 전시를 불러오지 못했습니다\./);
    expect(html).not.toContain('wc-category-display__navigation');
  });

  it('켜진 전시가 없으면 빈 토큰 상자를 남기지 않고 컬렉션으로 바로 시작한다', async () => {
    mocks.navigation = [];
    const html = await render();

    expect(html.startsWith('<div class="wc-root wc-collection">')).toBe(true);
    expect(html).not.toContain('<div class="wc-root"></div>');
  });

  it('카테고리 전시 페이지의 내비도 .wc-root 안에 서고 현재 전시를 표시한다', async () => {
    mocks.page = displayPage([good('a', { name: '전시 굿즈' })]);
    const html = await render({ displayCategory: DISPLAY_ID });
    const nav = navInsideRoot(html);

    expect(nav).not.toBeNull();
    expect(nav).toMatch(new RegExp(`href="/shop\\?displayCategory=${DISPLAY_ID}"[^>]*aria-current="page"|aria-current="page"[^>]*href="/shop\\?displayCategory=${DISPLAY_ID}"`));
    expect(html.indexOf('wc-category-display__navigation')).toBeLessThan(html.indexOf('class="wc-root wc-collection"'));
  });

  it('카테고리 전시 페이지에 다른 전시가 없으면 내비 상자를 그리지 않는다', async () => {
    mocks.navigation = [];
    mocks.page = displayPage([good('a', { name: '전시 굿즈' })]);
    const html = await render({ displayCategory: DISPLAY_ID });

    expect(html).not.toContain('wc-category-display__navigation');
    expect(html).not.toContain('<div class="wc-root"></div>');
  });
});

/* L5 — 카테고리 전시도 컬렉션과 같은 목록 문법이다: 카드 하트(CL-01)·별점(CL-02)·정렬 7종(CL-10)·타입 '예약판매'(CL-11). */
describe('카테고리 전시 목록 문법 (LFS 패리티 2차 L5)', () => {
  it('카드에 목록 하트와 별점을 그리고 정렬 7종·예약판매 타입을 연다', async () => {
    mocks.navigation = [];
    mocks.wishlist = { viewerId: 'viewer-1', goodIds: ['b'] };
    const page = displayPage([good('a', { name: '별점 굿즈' }), good('b', { name: '찜한 굿즈' })]);
    page.result.reviewSummaries = { a: { count: 3, average: 4.2 } };
    page.result.typeFacets = [{ value: '키링', label: '키링', count: 2 }, { value: '예약판매', label: '예약판매', count: 1 }];
    mocks.page = page;
    const html = await render({ displayCategory: DISPLAY_ID });

    expect(html.match(/<button[^>]*class="wc-list-heart/g)).toHaveLength(2);
    expect(html).toMatch(/aria-pressed="true"[^>]*aria-label="찜한 굿즈[^"]*"|aria-label="찜한 굿즈[^"]*"[^>]*aria-pressed="true"/);
    expect(html).toContain('평점 5점 만점에 4.2점, 리뷰 3개');
    const sorts = [...html.matchAll(/<option[^>]*value="([^"]+)"/g)].map((match) => match[1]);
    expect(sorts).toEqual(['recommended', 'name_asc', 'name_desc', 'price_asc', 'price_desc', 'oldest', 'newest']);
    expect(html).toContain('예약판매');
  });
});
