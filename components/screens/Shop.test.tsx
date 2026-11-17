import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Good, Ip, Stock } from '@/lib/data';
import type { CollectionBanner } from '@/lib/collection-banners';
import type { ListingWishlist } from '@/lib/listing-wishlist';
import { buildCategoryListingNav } from '@/lib/category-chips';
import {
  parseListingSearchParams,
  parseShopSearchParams,
  selectShopGoods,
  type ListingView,
} from '@/lib/shop-catalog';
import type { StorefrontCategoryNode } from '@/lib/storefront-mega-menu';
import {
  collectionBannerSlotFor,
  EMPTY_SHOP_FILTER_DRAFT,
  Shop,
  type ShopProps,
  setDraftPriceRange,
  shopFilterDraftFromQuery,
  shopQueryString,
  toggleDraftValue,
} from './Shop';

vi.mock('next/navigation', () => ({
  usePathname: () => '/shop',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/app/shop/actions', () => ({ toggleWishlistAction: vi.fn() }));

function ip(id: string, title: string): Ip {
  return {
    id,
    title,
    sub: '',
    v: { key: 'story', label: '스토리', color: '#111' },
    glyph: '◆',
    bg: 'none',
    fans: 0,
    goods: 0,
    cards: 0,
    featured: false,
    tagline: '',
    synopsis: '',
  };
}

function good(id: string, ipId: string, overrides: Partial<Good> = {}): Good {
  return {
    id,
    ip: ipId,
    name: `굿즈 ${id}`,
    type: '키링',
    price: 10000,
    badge: null,
    stock: 'ok' as Stock,
    stockQty: 10,
    img: 'linear-gradient(#111, #222)',
    ...overrides,
  };
}

const catalog = {
  ips: [ip('ip1', '홍실'), ip('ip2', '메이플')],
  goods: [
    good('a', 'ip1', { name: '홍실 피규어', price: 30000, type: '피규어', badge: 'NEW' }),
    good('b', 'ip1', { name: '홍실 키링', price: 10000 }),
    good('c', 'ip2', { name: '메이플 키링', price: 20000, stock: 'soldout', stockQty: 0 }),
    good('d', 'ip2', { name: '메이플 인형', price: 50000, type: '인형', compareAtPrice: 60000 }),
  ],
};

function render(
  view: ListingView,
  params: Record<string, string | string[] | undefined> = {},
  source: { ips: Ip[]; goods: Good[] } = catalog,
  bestGoodIds?: string[],
  wishlist?: ListingWishlist | null,
  extra: Partial<ShopProps> = {},
) {
  const { query, period } = parseListingSearchParams(params, view);
  const result = selectShopGoods(source, query, bestGoodIds);
  return renderToStaticMarkup(<Shop period={period} query={query} result={result} view={view} wishlist={wishlist} {...extra} />);
}

function sortLabels(html: string) {
  return [...html.matchAll(/<option[^>]*>([^<]+)<\/option>/g)].map((match) => match[1]);
}

describe('필터 draft 순수 함수', () => {
  const query = parseShopSearchParams(
    { ip: 'ip1', type: '키링', min: '5000', max: '20000', sort: 'price_asc' },
    { view: 'all', validIpIds: new Set(['ip1', 'ip2']) },
  );

  it('현재 질의에서 필터만 draft 로 뜬다', () => {
    expect(shopFilterDraftFromQuery(query)).toEqual({
      ips: ['ip1'],
      types: ['키링'],
      priceMin: 5000,
      priceMax: 20000,
    });
  });

  it('값 토글은 추가·제거를 오가고 원본을 건드리지 않는다', () => {
    const draft = shopFilterDraftFromQuery(query);
    const added = toggleDraftValue(draft, 'ips', 'ip2');
    expect(added.ips).toEqual(['ip1', 'ip2']);

    expect(toggleDraftValue(added, 'ips', 'ip1').ips).toEqual(['ip2']);
    expect(toggleDraftValue(draft, 'types', '인형').types).toEqual(['키링', '인형']);
    expect(draft.ips).toEqual(['ip1']);
  });

  it('가격 범위는 0~상한으로 자르고 뒤집힌 입력을 바로잡는다', () => {
    const draft = EMPTY_SHOP_FILTER_DRAFT;

    expect(setDraftPriceRange(draft, { min: 40000, max: 10000 }, 50000)).toEqual({
      ips: [],
      types: [],
      priceMin: 10000,
      priceMax: 40000,
    });
    expect(setDraftPriceRange(draft, { min: -500, max: 90000 }, 50000)).toEqual({
      ips: [],
      types: [],
      priceMin: null,
      priceMax: null,
    });
  });

  it('가격 필터를 URL 에 실을 때 기본 정렬은 빼고 반복 파라미터로 직렬화한다', () => {
    const qs = shopQueryString({
      ips: ['ip1', 'ip2'],
      types: ['키링'],
      priceMin: 5000,
      priceMax: 20000,
      sort: 'recommended',
      view: 'all',
    });

    expect(decodeURIComponent(qs)).toBe('ip=ip1&ip=ip2&type=키링&min=5000&max=20000');
    expect(shopQueryString({ ips: [], types: [], priceMin: null, priceMax: null, sort: 'newest', view: 'new' })).toBe('');
    expect(shopQueryString({ ips: [], types: [], priceMin: null, priceMax: null, sort: 'newest', view: 'all' })).toBe('sort=newest');
  });

  it('직렬화한 질의는 파서를 통해 그대로 돌아온다', () => {
    const query2 = parseShopSearchParams(
      Object.fromEntries(new URLSearchParams(shopQueryString({
        ips: ['ip1'],
        types: ['키링', '인형'],
        priceMin: null,
        priceMax: 20000,
        sort: 'price_desc',
        view: 'all',
      })).entries()),
      { view: 'all', validIpIds: new Set(['ip1', 'ip2']) },
    );

    expect(query2.ips).toEqual(['ip1']);
    expect(query2.priceMax).toBe(20000);
    expect(query2.sort).toBe('price_desc');
  });
});

describe('목록 틀 (Figma — 제목 줄 + 정렬 셀렉트 + 5열 그리드, 왼쪽 필터 없음)', () => {
  it('wc 스코프의 목록 루트와 넓은 컨테이너 안에서 그린다', () => {
    const html = render('all');

    expect(html).toContain('<main class="wc-root wc-listing">');
    expect(html).toContain('class="wc-container wc-container--wide"');
  });

  it('왼쪽 필터·수량 줄·모바일 필터 시트가 없다(D2)', () => {
    const html = render('all');

    for (const gone of ['wc-collection__sidebar', 'wc-collection__toolbar', 'wc-filter-group', 'wc-filter-trigger', 'wc-filter-sheet', 'wc-price-slider', '굿즈 필터', '전체 초기화', '전체 ›']) {
      expect(html, gone).not.toContain(gone);
    }
    expect(html).not.toMatch(/\d개 굿즈/);
  });

  it('필터 쿼리는 읽지 않는다 — ?ip·?min 이 걸려도 결과가 같다', () => {
    const filtered = render('all', { ip: 'ip1', min: '90000', type: '인형' });

    expect(filtered).toBe(render('all'));
    expect(filtered).toContain('메이플 인형');
    expect((filtered.match(/<article/g) ?? []).length).toBe(4);
  });

  it('제목은 보이는 h1 하나이고 전체 목록은 "전체 굿즈"다', () => {
    const html = render('all');

    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('<h1 class="wc-listing-head__title">전체 굿즈</h1>');
  });

  it('정렬 7종을 인기도·최신 등록순·판매량·가격·리뷰 순서의 네이티브 select 로 주고 현재 정렬을 선택 상태로 둔다', () => {
    const html = render('all', { sort: 'price_desc' });

    expect(sortLabels(html)).toEqual(['추천순', '인기도순', '최신 등록순', '판매량순', '낮은 가격순', '높은 가격순', '리뷰 많은순']);
    expect(html).toMatch(/<option[^>]*value="price_desc"[^>]*selected[^>]*>높은 가격순<\/option>/);
    expect(html).toMatch(/<label class="wc-sr-only" for="[^"]+">정렬 기준<\/label>/);
    expect(html).not.toContain('이름 가나다순');
    expect(html).not.toContain('오래된순');
  });

  it('이름순·오래된순 URL 은 화면에서 뺐으므로 기본값(추천순)으로 떨어진다', () => {
    const html = render('all', { sort: 'name_asc' });

    expect(html).toMatch(/<option[^>]*value="recommended"[^>]*selected/);
    expect(html.indexOf('홍실 피규어')).toBeLessThan(html.indexOf('메이플 인형'));
  });

  it('카드에 굿즈명·가격·운영 배지 칩·할인율·품절을 싣고 상세로 링크한다 — SALE 배지 대신 할인율이다', () => {
    const html = render('all');

    expect(html).toContain('href="/shop/a"');
    expect(html).toContain('홍실 피규어');
    expect(html).toContain('₩30,000');
    expect(html).toContain('<span class="wc-x-chip wc-x-chip--tag">NEW</span>');
    /* 메이플 인형: 정가 60000 → 판매가 50000 = 17%. 옛 SALE 배지는 그리지 않고 취소선 정가도 없다. */
    expect(html).toContain('<span class="wc-price__rate">17%</span>');
    expect(html).not.toContain('SALE');
    expect(html).toContain('SOLD OUT');
    expect(html).toContain('class="wc-x-grid"');
    expect(html).toContain('data-density="listing"');
    expect(html).not.toContain('class="wc-product-grid"');
  });

  it('그리드 카드에는 장바구니 담기 버튼을 두지 않는다', () => {
    expect(render('all')).not.toContain('담기');
  });

  /* LD-4(#326 결정 번복): 모든 상품 카드에 위시 하트. 목록 페이지가 위시 ID 집합을 한 번 내려 주고
     카드는 그 집합으로 초기 상태만 정한다. 어드민 미리보기처럼 상태를 받지 않은 자리에는 하트가 없다. */
  it('위시 상태를 받으면 카드마다 링크 밖에 하트를 두고 찜한 굿즈만 눌린 상태로 시작한다', () => {
    const html = render('all', {}, catalog, undefined, { viewerId: 'viewer-1', goodIds: ['b'] });
    const hearts = [...html.matchAll(/<button[^>]*class="wc-list-heart[^"]*"[^>]*>/g)].map((match) => match[0]);

    expect(hearts).toHaveLength(4);
    expect(html).toContain('aria-label="홍실 키링 위시리스트에서 빼기"');
    expect(html).toContain('aria-label="홍실 피규어 위시리스트에 담기"');
    expect(hearts.filter((heart) => heart.includes('aria-pressed="true"'))).toHaveLength(1);
    for (const anchor of html.match(/<a\b[^>]*>[\s\S]*?<\/a>/g) ?? []) expect(anchor).not.toContain('wc-list-heart');
  });

  it('게스트에게도 하트를 보이되 눌린 상태로 그리지 않고, 위시 상태가 없으면 하트를 그리지 않는다', () => {
    const guest = render('all', {}, catalog, undefined, { viewerId: null, goodIds: [] });
    expect((guest.match(/class="wc-list-heart"/g) ?? []).length).toBe(4);
    expect(guest).not.toContain('aria-pressed="true"');

    expect(render('all', {}, catalog, undefined, null)).not.toContain('wc-list-heart');
    expect(render('all')).not.toContain('wc-list-heart');
  });

  /* CL-02: 목록 카드 별점은 카탈로그 스냅샷의 공개 리뷰 요약에서 온다 — 리뷰 없는 굿즈는 별점이 없다. */
  it('draws card ratings from the catalog review summaries only for reviewed goods', () => {
    const html = render('all', {}, { ...catalog, reviewSummaries: { b: { count: 7, average: 4.6 } } } as typeof catalog);

    expect((html.match(/class="wc-product-card__rating"/g) ?? []).length).toBe(1);
    expect(html).toContain('평점 5점 만점에 4.6점, 리뷰 7개');
  });

  it('한 페이지(20개)를 넘길 때만 VIEW MORE 를 노출하고 20장까지만 그린다', () => {
    const many = {
      ips: [ip('ip1', '홍실')],
      goods: Array.from({ length: 25 }, (_, index) => good(`m${index}`, 'ip1')),
    };
    const html = render('all', {}, many);

    expect(html).toContain('class="wc-view-more wc-listing-more"');
    expect(html).toContain('>VIEW MORE</button>');
    expect((html.match(/<article/g) ?? []).length).toBe(20);
    expect(render('all')).not.toContain('wc-view-more');
  });

  it('서버가 이어 주는 목록(paging)은 받은 목록을 자르지 않고 hasMore 로 VIEW MORE 를 정한다', () => {
    const many = {
      ips: [ip('ip1', '홍실')],
      goods: Array.from({ length: 25 }, (_, index) => good(`m${index}`, 'ip1')),
    };
    const paged = render('all', {}, many, undefined, undefined, { paging: { loading: false, hasMore: false, onLoadMore: () => undefined } });
    expect((paged.match(/<article/g) ?? []).length).toBe(25);
    expect(paged).not.toContain('wc-view-more');

    const more = render('all', {}, many, undefined, undefined, { paging: { loading: false, hasMore: true, onLoadMore: () => undefined } });
    expect(more).toContain('>VIEW MORE</button>');

    const failed = render('all', {}, many, undefined, undefined, { paging: { loading: false, error: '굿즈를 더 불러오지 못했습니다.', hasMore: true, onLoadMore: () => undefined, onReload: () => undefined } });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain('목록 새로 불러오기');
  });
});

describe('빈 상태', () => {
  it('스코프 자체가 비면 준비 중 안내와 굿즈샵 링크만 남긴다(굿즈샵 전체는 링크 없이)', () => {
    const empty = render('new', {}, { ips: catalog.ips, goods: [] });

    expect(empty).toContain('아직 준비 중이에요');
    expect(empty).toContain('굿즈샵 둘러보기');
    expect(empty).toContain('href="/shop"');
    expect(empty).not.toContain('wc-x-grid');
    expect(empty).not.toContain('<select');
    /* NEW 는 비었으면 정렬을 고를 이유가 없어 탭 줄도 없다. 제목은 남는다. */
    expect(empty).toContain('<h1 class="wc-listing-head__title">NEW</h1>');
    expect(empty).not.toContain('wc-listing-tabs');

    const all = render('all', {}, { ips: catalog.ips, goods: [] });
    expect(all).toContain('아직 준비 중이에요');
    expect(all).not.toContain('굿즈샵 둘러보기');
  });
});

describe('NEW — 탭 줄이 곧 정렬이다(D4)', () => {
  it('NEW 배지 굿즈만 담고 정렬 셀렉트가 없으며 탭 6종을 순서대로 링크로 둔다', () => {
    const html = render('new');

    expect(html).toContain('<h1 class="wc-listing-head__title">NEW</h1>');
    expect(html).toContain('홍실 피규어');
    expect(html).not.toContain('메이플 인형');
    expect(html).not.toContain('<select');
    expect(html).toContain('<nav aria-label="정렬" class="wc-listing-tabs">');
    const tabs = [...html.matchAll(/<a\b[^>]*class="wc-listing-tabs__link"[^>]*>([^<]+)<\/a>/g)].map((match) => match[1]);
    expect(tabs).toEqual(['인기도순', '최신 등록순', '판매량순', '낮은 가격순', '높은 가격순', '리뷰 많은순']);
  });

  it('기본은 최신 등록순 탭이 현재이고 탭 URL 은 기본값을 싣지 않는다', () => {
    const html = render('new');
    const current = [...html.matchAll(/<a\b[^>]*aria-current="page"[^>]*>([^<]+)<\/a>/g)].map((match) => match[1]);

    expect(current).toEqual(['최신 등록순']);
    expect(html).toMatch(/<a aria-current="page" class="wc-listing-tabs__link" href="\/shop">최신 등록순<\/a>/);
    expect(html).toContain('href="/shop?sort=popular"');
    expect(html).toContain('href="/shop?sort=reviews"');
  });

  it('?sort 로 고른 탭이 현재이고 이름순·추천순 같은 값은 최신 등록순으로 떨어진다', () => {
    const sales = render('new', { sort: 'sales' });
    expect([...sales.matchAll(/<a\b[^>]*aria-current="page"[^>]*>([^<]+)<\/a>/g)].map((match) => match[1])).toEqual(['판매량순']);

    const fallback = render('new', { sort: 'recommended' });
    expect([...fallback.matchAll(/<a\b[^>]*aria-current="page"[^>]*>([^<]+)<\/a>/g)].map((match) => match[1])).toEqual(['최신 등록순']);
  });
});

describe('BEST — 기간 탭 + 판매 랭킹 순서', () => {
  it('기간 탭 4개(실시간·일간·주간·월간)와 정렬 셀렉트를 그리고 기본은 실시간이다', () => {
    const html = render('best', {}, catalog, ['d', 'b']);
    const tabs = [...html.matchAll(/<a\b[^>]*class="wc-listing-tabs__link"[^>]*>([^<]+)<\/a>/g)].map((match) => match[1]);

    expect(html).toContain('<h1 class="wc-listing-head__title">BEST</h1>');
    expect(html).toContain('<nav aria-label="기간" class="wc-listing-tabs">');
    expect(tabs).toEqual(['실시간', '일간', '주간', '월간']);
    expect([...html.matchAll(/<a\b[^>]*aria-current="page"[^>]*>([^<]+)<\/a>/g)].map((match) => match[1])).toEqual(['실시간']);
    expect(html).toContain('href="/shop?period=weekly"');
    expect(sortLabels(html)).toEqual(['추천순', '인기도순', '최신 등록순', '판매량순', '낮은 가격순', '높은 가격순', '리뷰 많은순']);
    /* 순위 숫자 배지는 Figma 에 없다. */
    expect(html).not.toMatch(/wc-product-card__rank|순위 \d/);
  });

  it('?period 가 현재 탭이 되고 탭 링크는 정렬을 함께 보존한다', () => {
    const html = render('best', { period: 'weekly', sort: 'price_asc' }, catalog, ['d', 'b']);

    expect([...html.matchAll(/<a\b[^>]*aria-current="page"[^>]*>([^<]+)<\/a>/g)].map((match) => match[1])).toEqual(['주간']);
    expect(html).toContain('href="/shop?period=monthly&amp;sort=price_asc"');
    expect(html).toContain('href="/shop?sort=price_asc"');
    expect(html).toMatch(/<option[^>]*value="price_asc"[^>]*selected/);
  });

  it('랭킹 순서를 그대로 그리고 랭킹에 없는 굿즈는 담지 않는다', () => {
    const html = render('best', {}, catalog, ['d', 'b']);

    expect(html.indexOf('메이플 인형')).toBeLessThan(html.indexOf('홍실 키링'));
    expect(html).not.toContain('홍실 피규어');
    expect((html.match(/<article/g) ?? []).length).toBe(2);
  });

  it('다른 정렬은 순위 목록 안에서만 다시 줄 세운다', () => {
    const html = render('best', { sort: 'price_asc' }, catalog, ['d', 'b']);

    expect(html.indexOf('홍실 키링')).toBeLessThan(html.indexOf('메이플 인형'));
    expect(html).not.toContain('메이플 키링');
  });

  it('빈 기간은 "이 기간에 집계된 굿즈가 없어요" + 다른 기간 안내이고 탭 줄은 남긴다', () => {
    const html = render('best', { period: 'daily' }, catalog, []);

    expect(html).toContain('이 기간에 집계된 굿즈가 없어요');
    expect(html).toContain('다른 기간을 골라 보세요.');
    expect(html).toContain('wc-listing-tabs');
    expect([...html.matchAll(/<a\b[^>]*aria-current="page"[^>]*>([^<]+)<\/a>/g)].map((match) => match[1])).toEqual(['일간']);
    expect(html).not.toContain('<select');
    expect(html).not.toContain('wc-x-grid');
    expect(html).not.toContain('굿즈샵 둘러보기');
  });

  it('랭킹을 읽지 못하면 가짜 순위 대신 실패 안내를 그린다(빈 기간과 다른 문구)', () => {
    const html = render('best', {}, catalog, [], undefined, { rankingFailed: true });

    expect(html).toContain('순위를 불러오지 못했어요.');
    expect(html).toContain('잠시 후 다시 확인해주세요.');
    expect(html).not.toContain('이 기간에 집계된 굿즈가 없어요');
    expect(html).toContain('wc-listing-tabs');
  });
});

describe('카테고리 화면 — 칩·제목·하위 탭', () => {
  const id = (n: number) => `5a4c3000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const node = (n: number, name: string, parent: number | null): StorefrontCategoryNode => ({
    id: id(n), parentId: parent === null ? null : id(parent), name, depth: parent === null ? 1 : 2, imageUrl: null, navigable: true,
  });
  const tree = [node(1, '문구용품', null), node(11, '다이어리', 1), node(12, '스티커', 1), node(2, '인형', null)];

  it('전체 굿즈는 칩 영역(전체 선택) 아래 "전체 굿즈" 제목이고 하위 탭은 없다', () => {
    const html = render('all', {}, catalog, undefined, undefined, { categoryNav: buildCategoryListingNav(tree, null) });

    expect(html).toContain('aria-label="카테고리"');
    expect(html).toMatch(/<a aria-current="page" class="wc-listing-chip" href="\/shop">전체<\/a>/);
    expect(html).toContain('<h1 class="wc-listing-head__title">전체 굿즈</h1>');
    expect(html).not.toContain('wc-listing-tabs');
    expect(html.indexOf('wc-listing-chips')).toBeLessThan(html.indexOf('wc-listing-head'));
  });

  it('전시 노드를 보면 1단계 이름 제목 + 하위 탭(전체·자식)이고 현재 탭이 선택이다', () => {
    const displayId = id(12);
    const query = { ...parseListingSearchParams({}, 'all').query, displayCategory: displayId };
    const html = renderToStaticMarkup(<Shop categoryNav={buildCategoryListingNav(tree, displayId)} query={query} result={selectShopGoods(catalog, query)} title="스티커" view="all" />);

    expect(html).toContain('<h1 class="wc-listing-head__title">문구용품</h1>');
    expect([...html.matchAll(/<a\b[^>]*class="wc-listing-tabs__link"[^>]*>([^<]+)<\/a>/g)].map((match) => match[1])).toEqual(['전체', '다이어리', '스티커']);
    expect([...html.matchAll(/<a\b[^>]*aria-current="page"[^>]*>([^<]+)<\/a>/g)].map((match) => match[1])).toEqual(['문구용품', '스티커']);
    expect(html).toContain('<nav aria-label="하위 분류" class="wc-listing-tabs">');
    expect(sortLabels(html)).toHaveLength(7);
  });

  it('어드민 미리보기처럼 title 만 넘기면 칩·탭 없이 제목과 정렬만 그린다', () => {
    const query = { ...parseListingSearchParams({}, 'all').query, displayCategory: id(1) };
    const html = renderToStaticMarkup(<Shop onQueryChange={() => undefined} query={query} result={selectShopGoods(catalog, query)} title="QA 인형 전시" view="all" />);

    expect(html).toContain('<h1 class="wc-listing-head__title">QA 인형 전시</h1>');
    expect(html).not.toContain('wc-listing-chips');
    expect(html).not.toContain('wc-listing-tabs');
    expect(html).toContain('<select');
  });

  /* L5: 카테고리 전시 RPC 가 인기도·판매량·리뷰 많은순까지 받는다 — 서버 페이지네이션 목록도 같은 정렬 7종이다. */
  it('카테고리 전시도 같은 7종 정렬을 연다', () => {
    const query = { ...parseListingSearchParams({}, 'all').query, displayCategory: id(1) };
    const html = renderToStaticMarkup(<Shop query={query} result={selectShopGoods(catalog, query)} title="전시" view="all" />);
    const values = [...html.matchAll(/<option[^>]*value="([^"]+)"/g)].map((match) => match[1]);

    expect(values).toEqual(['recommended', 'popular', 'newest', 'sales', 'price_asc', 'price_desc', 'reviews']);
  });

  it('전시 구성의 영상·추천 밴드(children)는 칩 영역과 제목 줄 사이에 선다', () => {
    const html = renderToStaticMarkup(<Shop categoryNav={buildCategoryListingNav(tree, id(1))} query={{ ...parseListingSearchParams({}, 'all').query, displayCategory: id(1) }} result={selectShopGoods(catalog, parseListingSearchParams({}, 'all').query)} view="all"><section id="media-band">영상</section></Shop>);

    expect(html.indexOf('wc-listing-chips')).toBeLessThan(html.indexOf('media-band'));
    expect(html.indexOf('media-band')).toBeLessThan(html.indexOf('wc-listing-head'));
  });
});

describe('스트립 배너 (Figma · 11 CL-09)', () => {
  function banner(id: string, slot: CollectionBanner['slot'], overrides: Partial<CollectionBanner> = {}): CollectionBanner {
    return {
      id,
      slot,
      title: `배너 ${id}`,
      subtitle: null,
      imageUrl: `https://cdn.test/${id}.webp`,
      mobileImageUrl: null,
      href: null,
      imageAlt: '',
      imageDim: 'none',
      textColor: 'black',
      endsAt: null,
      ...overrides,
    };
  }

  function renderWith(view: ListingView, banners: CollectionBanner[], params: Record<string, string> = {}, bestGoodIds?: string[]) {
    return render(view, params, catalog, bestGoodIds, undefined, { banners });
  }

  it('배너가 없으면 배너 마크업도 빈 머리 컨테이너도 없다 — 제목 줄로 바로 시작한다', () => {
    const html = render('all');

    expect(html).not.toContain('wc-strip-banners');
    expect(html).toMatch(/<main class="wc-root wc-listing"><div class="wc-container wc-container--wide"><header class="wc-listing-head">/);
  });

  /* 데스크톱 위 여백은 배너가 첫 줄일 때만 0이다(wc-listing.css `[data-lead='banner']`) — 배너가 없으면 제목 줄·칩이 헤더에 들러붙지 않게 여백을 남긴다. */
  it('배너가 첫 줄이면 목록 루트에 data-lead="banner" 를 달고 배너가 없으면 달지 않는다', () => {
    expect(renderWith('best', [banner('b1', 'best')], {}, ['d', 'b'])).toContain('<main class="wc-root wc-listing" data-lead="banner">');
    expect(renderWith('all', [banner('a1', 'all')])).toContain('<main class="wc-root wc-listing" data-lead="banner">');
    expect(renderWith('best', [], {}, ['d', 'b'])).not.toContain('data-lead');
    expect(renderWith('new', [banner('a1', 'all')])).not.toContain('data-lead');

    const query = { ...parseListingSearchParams({}, 'all').query, displayCategory: '00000000-0000-4000-8000-000000000001' };
    const html = renderToStaticMarkup(<Shop
      displayBanner={{ id: 'category-1', title: '겨울 여행', subtitle: null, imageUrl: 'https://cdn.test/c.webp', mobileImageUrl: null, href: null, imageAlt: '', imageDim: 'none', textColor: 'black' }}
      query={query}
      result={selectShopGoods(catalog, query)}
      title="전시"
      view="all"
    />);
    expect(html).toContain('<main class="wc-root wc-listing" data-lead="banner">');
  });

  it('굿즈샵 전체 배너(all 슬롯)는 컨테이너 안 맨 앞, 제목 줄 앞에 서고 다른 슬롯은 섞이지 않는다', () => {
    const html = renderWith('all', [banner('a1', 'all'), banner('a2', 'all'), banner('b1', 'best')]);

    expect(html).toContain('data-slot="all"');
    expect(html).toContain('aria-roledescription="carousel"');
    expect(html).toContain('배너 a1');
    expect(html).toContain('배너 a2');
    expect(html).not.toContain('배너 b1');
    expect(html.indexOf('wc-strip-banners')).toBeGreaterThan(html.indexOf('class="wc-container wc-container--wide"'));
    expect(html.indexOf('wc-strip-banners')).toBeLessThan(html.indexOf('wc-listing-head'));
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it('BEST·NEW 배너는 한 장이고 NEW 는 NEW 슬롯 배너만 받는다 — 배너가 있어도 제목 줄이 그대로 보인다', () => {
    const best = renderWith('best', [banner('b1', 'best', { subtitle: '지금 많이 찾는 굿즈' }), banner('b2', 'best')], {}, ['d', 'b']);
    expect(best).toContain('배너 b1');
    expect(best).not.toContain('배너 b2');
    expect(best).not.toContain('aria-roledescription="carousel"');
    expect(best).toContain('지금 많이 찾는 굿즈');
    expect(best).toContain('<h1 class="wc-listing-head__title">BEST</h1>');

    const fresh = renderWith('new', [banner('n1', 'new'), banner('a1', 'all')]);
    expect(fresh).toContain('배너 n1');
    expect(fresh).not.toContain('배너 a1');
  });

  it('카테고리 전시는 컬렉션 배너를 그리지 않고 전시 구성의 배너(displayBanner)를 같은 틀로 그린다', () => {
    const query = { ...parseListingSearchParams({}, 'all').query, displayCategory: '00000000-0000-4000-8000-000000000001' };
    const html = renderToStaticMarkup(<Shop
      banners={[banner('a1', 'all')]}
      displayBanner={{ id: 'category-1', title: '겨울 여행', subtitle: null, imageUrl: 'https://cdn.test/c.webp', mobileImageUrl: null, href: null, imageAlt: '', imageDim: 'none', textColor: 'black' }}
      query={query}
      result={selectShopGoods(catalog, query)}
      title="전시"
      view="all"
    />);

    expect(html).not.toContain('배너 a1');
    expect(html).toContain('겨울 여행');
    expect(html).toContain('data-slot="category"');
    expect(collectionBannerSlotFor('all', query)).toBeNull();
  });

  it('검색·IP관 컬렉션에는 배너 슬롯이 없다', () => {
    expect(collectionBannerSlotFor('search', {})).toBeNull();
    expect(collectionBannerSlotFor('ip', {})).toBeNull();
    expect(collectionBannerSlotFor('best', {})).toBe('best');
  });

  it('카드팩으로 가는 배너도 받은 대로 그린다 — 목적지 게이트는 서버 로더가 이미 걸었다(l8b-ui-2)', () => {
    const open = renderWith('best', [banner('packs', 'best', { href: '/packs' })], {}, ['d', 'b']);
    expect(open).toContain('href="/packs"');

    const closed = renderWith('best', [], {}, ['d', 'b']);
    expect(closed).not.toContain('wc-strip-banners');
  });

  it('스코프가 빈 BEST 도 배너는 그대로 두고 빈 기간 안내를 잇는다', () => {
    const html = renderWith('best', [banner('b1', 'best')], {}, []);

    expect(html).toContain('배너 b1');
    expect(html).toContain('이 기간에 집계된 굿즈가 없어요');
  });
});
