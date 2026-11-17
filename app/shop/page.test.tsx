import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { CategoryDisplayPage } from '@/lib/category-display';
import type { CollectionBanner } from '@/lib/collection-banners';
import type { Good } from '@/lib/data';
import type { ListingSortOrders } from '@/lib/listing-sorts';
import type { ShopListQuery } from '@/lib/shop-catalog';
import type { StorefrontCategoryNode } from '@/lib/storefront-mega-menu';
import Page from './page';

/* /shop — 전체 굿즈(칩 + "전체 굿즈" + 정렬 셀렉트)와 카테고리 전시(?displayCategory=)가 같은 Figma 틀이다. 칩·제목·하위 탭은 공개 전시 트리
 * (메가메뉴와 같은 원천)에서 서버가 만든다. 이 화면에는 필터가 없어 필터 쿼리는 읽지 않는다. */

const DISPLAY_ID = '5a4c3000-0000-4000-8000-000000000001';
const CHILD_ID = '5a4c3000-0000-4000-8000-000000000011';
const mocks = vi.hoisted(() => ({
  goods: [] as Good[],
  tree: [] as StorefrontCategoryNode[],
  treeFails: false,
  page: null as CategoryDisplayPage | null,
  pageCalls: [] as Array<{ id: string; query: ShopListQuery }>,
  wishlist: null as { viewerId: string | null; goodIds: string[] } | null,
  banners: [] as CollectionBanner[],
  bannerSlots: [] as string[],
  orders: null as ListingSortOrders | null,
  orderLoads: 0,
}));

vi.mock('@/lib/wishlist-ids.server', () => ({ loadListingWishlist: async () => mocks.wishlist }));
vi.mock('@/lib/collection-banners.server', () => ({
  getCollectionBanners: async (slot: string) => {
    mocks.bannerSlots.push(slot);
    return mocks.banners.filter((banner) => banner.slot === slot);
  },
}));
vi.mock('@/lib/goods-listing-orders.server', () => ({
  loadListingSortOrders: async () => { mocks.orderLoads += 1; return mocks.orders; },
}));
vi.mock('@/lib/storefront-mega-menu.server', () => ({
  getStorefrontMegaMenus: async () => {
    if (mocks.treeFails) throw new Error('rpc');
    return { categories: mocks.tree, campaigns: [], featuredIps: [] };
  },
}));
vi.mock('@/app/shop/actions', () => ({ toggleWishlistAction: vi.fn() }));
vi.mock('@/lib/category-display.server', () => ({
  loadCategoryDisplayPage: async (id: string, query: ShopListQuery) => { mocks.pageCalls.push({ id, query }); return mocks.page; },
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

function node(id: string, name: string, parentId: string | null): StorefrontCategoryNode {
  return { id, parentId, name, depth: parentId === null ? 1 : 2, imageUrl: null, navigable: true };
}

function displayPage(goods: Good[]): CategoryDisplayPage {
  return {
    category: { id: DISPLAY_ID, name: 'QA 인형 전시' }, checkedAt: '2026-10-23T00:00:00.000Z', token: 'token-1', offset: 0, nextOffset: null,
    query: { displayCategory: DISPLAY_ID, view: 'all', ips: [], types: [], priceMin: null, priceMax: null, sort: 'recommended' },
    result: { goods, filteredTotal: goods.length, total: goods.length, priceCeil: 10000, ipFacets: [], typeFacets: [] },
    navigation: [], banner: null, video: null, recommendations: null,
  };
}

function collectionBanner(id: string, slot: CollectionBanner['slot']): CollectionBanner {
  return { id, slot, title: `배너 ${id}`, subtitle: null, imageUrl: `https://cdn.test/${id}.webp`, mobileImageUrl: null, href: null, imageAlt: '', imageDim: 'none', textColor: 'black', endsAt: null };
}

async function render(params: Record<string, string | string[] | undefined> = {}) {
  return renderToStaticMarkup(await Page({ searchParams: Promise.resolve(params) }));
}

const currentLinks = (html: string) => [...html.matchAll(/<a\b[^>]*aria-current="page"[^>]*>([^<]+)<\/a>/g)].map((match) => match[1]);

beforeEach(() => {
  mocks.goods = [good('a', { name: '첫 굿즈' })];
  mocks.tree = [node(DISPLAY_ID, 'QA 인형 전시', null)];
  mocks.treeFails = false;
  mocks.page = null;
  mocks.pageCalls = [];
  mocks.wishlist = null;
  mocks.banners = [];
  mocks.bannerSlots = [];
  mocks.orders = null;
  mocks.orderLoads = 0;
});

describe('/shop 전체 굿즈 — 칩 영역', () => {
  it('공개 전시 트리의 1단계 칩이 목록 머리 앞에 서고 전체 칩이 선택이며 제목은 전체 굿즈다', async () => {
    const html = await render();

    expect(html).toContain('<main class="wc-root wc-listing">');
    expect(html).toContain('aria-label="카테고리"');
    expect(html).toContain(`href="/shop?displayCategory=${DISPLAY_ID}"`);
    expect(currentLinks(html)).toEqual(['전체']);
    expect(html).toContain('<h1 class="wc-listing-head__title">전체 굿즈</h1>');
    expect(html.indexOf('wc-listing-chips')).toBeLessThan(html.indexOf('wc-listing-head'));
    /* 옛 '카테고리 전시' 한 줄 내비는 칩으로 대체됐다. */
    expect(html).not.toContain('wc-category-display__navigation');
  });

  it('공개 트리가 비면(스위치 OFF·전시 없음) 칩 영역 없이 전체 목록만 그린다', async () => {
    mocks.tree = [];
    const html = await render();

    expect(html).not.toContain('wc-listing-chips');
    expect(html).toContain('<h1 class="wc-listing-head__title">전체 굿즈</h1>');
    expect(html).toContain('첫 굿즈');
  });

  it('트리를 읽지 못해도 목록은 막지 않는다 — 칩만 빠진다', async () => {
    mocks.treeFails = true;
    const html = await render();

    expect(html).not.toContain('wc-listing-chips');
    expect(html).toContain('첫 굿즈');
  });

  it('필터 쿼리와 이름순은 읽지 않는다 — 결과가 같다', async () => {
    mocks.goods = [good('a', { name: '첫 굿즈' }), good('b', { name: '둘째 굿즈', price: 90000, ip: 'ip2' })];

    expect(await render({ ip: 'ip1', min: '50000', max: '1', type: '인형', category: 'root', sort: 'name_asc' })).toBe(await render());
  });

  it('정렬 순서(DB)는 인기도·판매량·리뷰 많은순일 때만 읽는다', async () => {
    mocks.goods = [good('a', { name: '첫 굿즈' }), good('b', { name: '둘째 굿즈' })];
    mocks.orders = { popular: ['b', 'a'], sales: [], reviews: [] };

    await render({ sort: 'price_asc' });
    expect(mocks.orderLoads).toBe(0);
    const html = await render({ sort: 'popular' });
    expect(mocks.orderLoads).toBe(1);
    expect(html.indexOf('둘째 굿즈')).toBeLessThan(html.indexOf('첫 굿즈'));
  });
});

/* 굿즈샵 전체만 컬렉션 배너(all 슬롯)를 읽는다. 카테고리 전시 분기는 컬렉션 배너를 읽지도 그리지도 않고 전시 구성 배너를 쓴다. */
describe('굿즈샵 컬렉션 배너 (LFS 패리티 2차 L8b)', () => {
  it('굿즈샵 전체는 all 슬롯 배너를 읽어 칩 영역 앞 맨 위에 그린다', async () => {
    mocks.banners = [collectionBanner('a1', 'all')];
    const html = await render();

    expect(mocks.bannerSlots).toEqual(['all']);
    expect(html).toContain('data-slot="all"');
    expect(html).toContain('배너 a1');
    expect(html.indexOf('wc-strip-banners')).toBeLessThan(html.indexOf('wc-listing-chips'));
    expect(html.indexOf('wc-listing-chips')).toBeLessThan(html.indexOf('wc-listing-head'));
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it('카테고리 전시 페이지는 컬렉션 배너를 읽지 않는다', async () => {
    mocks.banners = [collectionBanner('a1', 'all')];
    mocks.page = displayPage([good('a', { name: '전시 굿즈' })]);
    const html = await render({ displayCategory: DISPLAY_ID });

    expect(mocks.bannerSlots).toEqual([]);
    expect(html).not.toContain('배너 a1');
  });
});

describe('카테고리 전시 (?displayCategory=)', () => {
  it('칩·제목·하위 탭을 공개 트리에서 만들고 현재 전시를 선택으로 표시한다', async () => {
    mocks.tree = [node(DISPLAY_ID, '인형', null), node(CHILD_ID, '봉제 인형', DISPLAY_ID)];
    mocks.page = { ...displayPage([good('a', { name: '전시 굿즈' })]), category: { id: CHILD_ID, name: '봉제 인형' } };
    const html = await render({ displayCategory: CHILD_ID });

    expect(mocks.pageCalls[0].id).toBe(CHILD_ID);
    expect(html).toContain('<h1 class="wc-listing-head__title">인형</h1>');
    expect(html).toContain('<nav aria-label="하위 분류" class="wc-listing-tabs">');
    expect(currentLinks(html)).toEqual(['인형', '봉제 인형']);
    expect(html).toContain('전시 굿즈');
  });

  it('공개 트리 읽기가 실패하면 칩·탭 없이 전시 이름을 제목으로 그린다', async () => {
    mocks.treeFails = true;
    mocks.page = displayPage([good('a', { name: '전시 굿즈' })]);
    const html = await render({ displayCategory: DISPLAY_ID });

    expect(html).not.toContain('wc-listing-chips');
    expect(html).toContain('<h1 class="wc-listing-head__title">QA 인형 전시</h1>');
  });

  it('URL 의 필터는 버리고 화면에서 뺀 정렬은 기본값으로 돌려 전시 RPC 에 보낸다', async () => {
    mocks.page = displayPage([good('a')]);
    await render({ displayCategory: DISPLAY_ID, ip: 'ip1', type: '키링', min: '100', max: '900', sort: 'name_asc' });

    expect(mocks.pageCalls[0].query).toMatchObject({ displayCategory: DISPLAY_ID, ips: [], types: [], priceMin: null, priceMax: null, sort: 'recommended' });

    mocks.pageCalls = [];
    await render({ displayCategory: DISPLAY_ID, sort: 'popular' });
    expect(mocks.pageCalls[0].query.sort).toBe('popular');
    /* 전시는 서버(RPC)가 정렬한다 — 클라이언트 정렬 순서 RPC 는 부르지 않는다. */
    expect(mocks.orderLoads).toBe(0);
  });

  it('잘못된 전시 id·존재하지 않는 전시는 404 다', async () => {
    await expect(render({ displayCategory: 'missing' })).rejects.toThrow('NEXT_NOT_FOUND');
    mocks.page = null;
    await expect(render({ displayCategory: DISPLAY_ID })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  /* L5 — 카테고리 전시도 같은 목록 문법이다: 카드 하트(CL-01)·별점(CL-02)·정렬 7종(CL-10). */
  it('카드에 목록 하트와 별점을 그리고 정렬 7종을 연다', async () => {
    mocks.wishlist = { viewerId: 'viewer-1', goodIds: ['b'] };
    const page = displayPage([good('a', { name: '별점 굿즈' }), good('b', { name: '찜한 굿즈' })]);
    page.result.reviewSummaries = { a: { count: 3, average: 4.2 } };
    mocks.page = page;
    const html = await render({ displayCategory: DISPLAY_ID });

    expect(html.match(/<button[^>]*class="wc-list-heart/g)).toHaveLength(2);
    expect(html).toMatch(/aria-pressed="true"[^>]*aria-label="찜한 굿즈[^"]*"|aria-label="찜한 굿즈[^"]*"[^>]*aria-pressed="true"/);
    expect(html).toContain('평점 5점 만점에 4.2점, 리뷰 3개');
    const sorts = [...html.matchAll(/<option[^>]*value="([^"]+)"/g)].map((match) => match[1]);
    expect(sorts).toEqual(['recommended', 'popular', 'newest', 'sales', 'price_asc', 'price_desc', 'reviews']);
    expect(html).not.toContain('wc-filter-group');
  });

  it('전시 구성의 배너는 목록 머리 스트립 배너로, 영상·추천 밴드는 칩과 제목 줄 사이에 그린다', async () => {
    const page = displayPage([good('a', { name: '전시 굿즈' })]);
    page.banner = { id: 'category-1', title: '겨울 여행', subtitle: '신규 MD', imageUrl: 'https://cdn.test/c.webp', mobileImageUrl: null, href: null };
    page.recommendations = { id: 'category-1', title: '추천 굿즈', layout: 'list', imageShape: 'square', goods: [{ id: 'r1', name: '추천 인형', href: '/shop/r1', imageBg: 'none', price: 5000, soldOut: false, badge: null, brand: '홍실' }] };
    mocks.page = page;
    const html = await render({ displayCategory: DISPLAY_ID });

    expect(html).toContain('data-slot="category"');
    expect(html).toContain('겨울 여행');
    expect(html.indexOf('data-slot="category"')).toBeLessThan(html.indexOf('wc-listing-chips'));
    expect(html.indexOf('wc-listing-chips')).toBeLessThan(html.indexOf('추천 굿즈'));
    expect(html.indexOf('추천 굿즈')).toBeLessThan(html.indexOf('wc-listing-head'));
  });
});
