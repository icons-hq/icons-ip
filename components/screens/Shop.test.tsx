import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Good, Ip, Stock } from '@/lib/data';
import type { CollectionBanner } from '@/lib/collection-banners';
import type { ListingWishlist } from '@/lib/listing-wishlist';
import {
  parseShopSearchParams,
  selectShopGoods,
  type ShopView,
} from '@/lib/shop-catalog';
import {
  collectionBannerSlotFor,
  EMPTY_SHOP_FILTER_DRAFT,
  Shop,
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

/* 카운트·facet 라벨은 굵기 강조 태그가 문자열을 쪼갠다 — 읽히는 문장으로 단언한다. */
function text(html: string) {
  return html.replace(/<[^>]+>/g, '');
}

function render(
  view: ShopView,
  params: Record<string, string | string[] | undefined> = {},
  source: { ips: Ip[]; goods: Good[] } = catalog,
  bestGoodIds?: string[],
  wishlist?: ListingWishlist | null,
) {
  const query = parseShopSearchParams(params, {
    view,
    validIpIds: new Set(source.ips.map((item) => item.id)),
  });
  const result = selectShopGoods(source, query, bestGoodIds);
  return renderToStaticMarkup(<Shop query={query} result={result} view={view} wishlist={wishlist} />);
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

describe('굿즈샵 목록', () => {
  it('wc 스코프 안에서 컬렉션 블록을 그린다', () => {
    expect(render('all')).toContain('class="wc-root wc-collection"');
  });

  it('필터가 없으면 전체 개수만, 있으면 선택/전체를 함께 보여준다', () => {
    expect(text(render('all'))).toContain('전체 › 4개 굿즈');
    expect(text(render('all', { ip: 'ip1' }))).toContain('전체 › 2/4개 굿즈');
  });

  /* '전체 ›' 머리는 보조 위계이고 수량 문구만 굵다 — 모바일은 머리를 감춘다(R-03 §1.2·§1.8, CL-05). */
  it('수량 줄의 머리와 구분 글리프를 수량 문구와 갈라 두고 글리프는 읽지 않게 한다', () => {
    const html = render('all');

    expect(html).toContain('<span class="wc-collection__count-scope">전체<span aria-hidden="true" class="wc-collection__count-sep"> › </span></span>');
    expect(html).toContain('<strong>4개 굿즈</strong>');
  });

  it('정렬 7종을 레퍼런스 순서의 네이티브 select 로 주고 현재 정렬을 선택 상태로 둔다(12 LD-13)', () => {
    const html = render('all', { sort: 'price_desc' });
    const labels = [...html.matchAll(/<option[^>]*>([^<]+)<\/option>/g)].map((match) => match[1]);

    expect(labels).toEqual(['추천순', '이름 가나다순', '이름 역순', '낮은 가격순', '높은 가격순', '오래된순', '최신순']);
    expect(html).toMatch(/<option[^>]*value="price_desc"[^>]*selected[^>]*>높은 가격순<\/option>/);
    expect(html).not.toContain('베스트셀러');
  });

  it('URL 의 이름순·오래된순을 그대로 반영해 그린다', () => {
    const named = render('all', { sort: 'name_asc' });
    expect(named).toMatch(/<option[^>]*value="name_asc"[^>]*selected/);
    expect(named.indexOf('메이플 인형')).toBeLessThan(named.indexOf('홍실 피규어'));
  });

  it('IP·타입 facet 을 개수와 함께 그리고 선택된 값은 체크한다', () => {
    const html = render('all', { ip: 'ip2' });

    expect(text(html)).toContain('홍실 (2)');
    expect(text(html)).toContain('메이플 (2)');
    expect(text(html)).toContain('키링 (2)');
    expect(html).toContain('IP (1)');
    expect(html).toContain('타입 (0)');
    expect(html).toMatch(/<input[^>]*checked=""[^>]*value="ip2"/);
  });

  it('가격 슬라이더 상한과 라벨은 스코프 최고가에서 온다', () => {
    const html = render('all');

    expect(html).toContain('₩0 ~ ₩50,000');
    expect(html).toMatch(/<input[^>]*max="50000"[^>]*type="range"/);
  });

  it('카드에 굿즈명·가격·배지·품절을 싣고 상세로 링크한다', () => {
    const html = render('all');

    expect(html).toContain('href="/shop/a"');
    expect(html).toContain('홍실 피규어');
    expect(html).toContain('₩30,000');
    expect(html).toContain('NEW');
    expect(html).toContain('SALE');
    expect(html).toContain('SOLD OUT');
    expect(html).toContain('class="wc-product-grid"');
  });

  it('그리드 카드에는 장바구니 담기 버튼을 두지 않는다', () => {
    expect(render('all')).not.toContain('담기');
  });

  /* LD-4(#326 결정 번복): 모든 상품 카드 우상단에 위시 하트. 목록 페이지가 위시 ID 집합을 한 번 내려 주고
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

  it('한 페이지를 넘길 때만 VIEW MORE 를 노출한다', () => {
    const many = {
      ips: [ip('ip1', '홍실')],
      goods: Array.from({ length: 25 }, (_, index) => good(`m${index}`, 'ip1')),
    };

    expect(render('all', {}, many)).toContain('class="wc-view-more"');
    expect(render('all', {}, many)).toContain('>VIEW MORE</button>');
    expect(render('all')).not.toContain('wc-view-more');
  });

  it('모바일 필터 트리거와 전체 초기화를 제공한다', () => {
    const html = render('all', { ip: 'ip1' });

    expect(html).toContain('aria-label="필터, 1개 적용됨"');
    expect(html).toContain('전체 초기화');
    expect(html).toContain('wc-filter-trigger');
  });
});

describe('굿즈샵 빈 상태', () => {
  it('필터 결과가 없으면 초기화 안내를 띄우고 정렬 컨트롤을 감춘다', () => {
    const html = render('all', { min: '90000' });

    expect(text(html)).toContain('전체 › 0/4개 굿즈');
    expect(html).toContain('조건에 맞는 굿즈가 없어요');
    expect(html).toContain('필터를 줄이거나 초기화해 보세요.');
    expect(html).not.toContain('wc-collection__sort');
  });

  it('스코프 자체가 비면 준비 중 안내와 굿즈샵 링크만 남긴다', () => {
    const html = render('best', {}, catalog, []);

    expect(html).toContain('아직 준비 중이에요');
    expect(html).toContain('굿즈샵 둘러보기');
    expect(html).toContain('href="/shop"');
    expect(html).not.toContain('wc-product-grid');
    expect(html).not.toContain('wc-filter-group');
  });
});

describe('컬렉션 뷰별 머리말', () => {
  it('굿즈샵은 제목을 시각적으로 숨긴 h1 으로만 둔다', () => {
    expect(render('all')).toMatch(/<h1 class="wc-sr-only">굿즈샵<\/h1>/);
  });

  /* 레퍼런스 NEW 컬렉션에는 제목이 없다(11 CL-08) — 굿즈샵처럼 h1 은 시각 숨김으로만 둔다. */
  it('NEW 는 보이는 제목·부제 없이 시각 숨김 h1 만 두고 NEW 배지 굿즈만 담는다', () => {
    const html = render('new');

    expect(html).toMatch(/<h1 class="wc-sr-only">NEW<\/h1>/);
    expect(html).not.toContain('wc-section-heading');
    expect(html).not.toContain('새로 나온 굿즈를 모아 봤어요.');
    expect(html).toContain('홍실 피규어');
    expect(html).not.toContain('메이플 인형');
  });

  /* L5: 카테고리 전시 RPC 가 컬렉션과 같은 7종을 받는다 — 서버 페이지네이션 목록도 같은 정렬 문법이다(CL-10). */
  it('카테고리 전시는 서버 페이지네이션이 받는 정렬(컬렉션과 같은 7종)을 연다', () => {
    const query = { ...parseShopSearchParams({}, { view: 'all', validIpIds: new Set(['ip1', 'ip2']) }), displayCategory: '00000000-0000-4000-8000-000000000001' };
    const html = renderToStaticMarkup(<Shop query={query} result={selectShopGoods(catalog, query)} title="전시" view="all" />);
    const values = [...html.matchAll(/<option[^>]*value="([^"]+)"/g)].map((match) => match[1]);

    expect(values).toEqual(['recommended', 'name_asc', 'name_desc', 'price_asc', 'price_desc', 'oldest', 'newest']);
  });

  it('BEST 는 큐레이션 순서를 그대로 그린다', () => {
    const html = render('best', {}, catalog, ['d', 'b']);

    expect(html).toMatch(/<h1[^>]*>BEST<\/h1>/);
    expect(html).toContain('지금 가장 사랑받는 굿즈예요.');
    expect(html.indexOf('메이플 인형')).toBeLessThan(html.indexOf('홍실 키링'));
  });
});

describe('컬렉션 머리 배너 (11 CL-09 · L8b)', () => {
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

  function renderWith(view: ShopView, banners: CollectionBanner[], params: Record<string, string> = {}, bestGoodIds?: string[]) {
    const query = parseShopSearchParams(params, { view, validIpIds: new Set(catalog.ips.map((item) => item.id)) });
    return renderToStaticMarkup(<Shop banners={banners} query={query} result={selectShopGoods(catalog, query, bestGoodIds)} view={view} />);
  }

  it('배너가 없으면 컬렉션 루트에 배너 수식어도 배너 마크업도 없다(지금 화면 그대로)', () => {
    const html = render('all');

    expect(html).toContain('class="wc-root wc-collection"');
    expect(html).not.toContain('wc-collection--banner');
    expect(html).not.toContain('wc-collection-banners');
  });

  it('굿즈샵 전체 배너는 컨테이너 밖 전폭으로, 목록 앞에 선다', () => {
    const html = renderWith('all', [banner('a1', 'all'), banner('a2', 'all'), banner('b1', 'best')]);

    expect(html).toContain('class="wc-root wc-collection wc-collection--banner"');
    expect(html).toContain('wc-collection-banners--wide');
    expect(html.indexOf('wc-collection-banners--wide')).toBeLessThan(html.indexOf('class="wc-container"'));
    expect(html).toContain('배너 a1');
    expect(html).toContain('배너 a2');
    /* 다른 컬렉션 슬롯의 배너는 섞이지 않는다. */
    expect(html).not.toContain('배너 b1');
    expect(html).toMatch(/<h1 class="wc-sr-only">굿즈샵<\/h1>/);
    /* 페이지 제목이 배너보다 먼저 읽힌다(l8b-qa-5) — BEST·NEW 와 같은 순서. */
    expect(html.indexOf('<h1 class="wc-sr-only">굿즈샵</h1>')).toBeLessThan(html.indexOf('wc-collection-banners--wide'));
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it('스코프가 빈 굿즈샵 전체도 시각 숨김 h1 이 전폭 배너 앞이다(l8b-qa-5)', () => {
    const query = parseShopSearchParams({}, { view: 'all', validIpIds: new Set() });
    const html = renderToStaticMarkup(<Shop banners={[banner('a1', 'all')]} query={query} result={selectShopGoods({ ...catalog, goods: [] }, query)} view="all" />);

    expect(html).toContain('아직 준비 중이에요');
    expect(html.indexOf('<h1 class="wc-sr-only">굿즈샵</h1>')).toBeLessThan(html.indexOf('wc-collection-banners--wide'));
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it('BEST 배너가 있으면 보이는 텍스트 제목을 걷고 콘텐츠 폭 배너가 머리말이 된다', () => {
    const html = renderWith('best', [banner('b1', 'best', { subtitle: '지금 많이 찾는 굿즈' })], {}, ['d', 'b']);

    expect(html).toMatch(/<h1 class="wc-sr-only">BEST<\/h1>/);
    expect(html).not.toContain('wc-section-heading');
    expect(html).toContain('wc-collection-banners--contained');
    expect(html.indexOf('class="wc-container"')).toBeLessThan(html.indexOf('wc-collection-banners--contained'));
    expect(html).toContain('지금 많이 찾는 굿즈');
  });

  it('NEW 는 NEW 슬롯 배너만 받는다', () => {
    const html = renderWith('new', [banner('n1', 'new'), banner('a1', 'all')]);

    expect(html).toContain('배너 n1');
    expect(html).not.toContain('배너 a1');
    expect(html).toContain('wc-collection-banners--contained');
  });

  it('카테고리 전시(?displayCategory=)는 같은 화면이어도 배너를 그리지 않는다', () => {
    const query = { ...parseShopSearchParams({}, { view: 'all', validIpIds: new Set(['ip1', 'ip2']) }), displayCategory: '00000000-0000-4000-8000-000000000001' };
    const html = renderToStaticMarkup(<Shop banners={[banner('a1', 'all')]} query={query} result={selectShopGoods(catalog, query)} title="전시" view="all" />);

    expect(html).not.toContain('wc-collection-banners');
    expect(html).not.toContain('wc-collection--banner');
    expect(collectionBannerSlotFor('all', query)).toBeNull();
  });

  it('검색·IP관 컬렉션에는 배너 슬롯이 없다', () => {
    expect(collectionBannerSlotFor('search', {})).toBeNull();
    expect(collectionBannerSlotFor('ip', {})).toBeNull();
    expect(collectionBannerSlotFor('best', {})).toBe('best');
  });

  it('머리말·여백 판정과 실제 배너가 어긋나지 않는다 — 카드팩으로 가는 배너도 받은 대로 그리고, 빈 목록이면 텍스트 제목과 여백이 남는다(l8b-ui-2·l8b-data-3)', () => {
    /* 목적지 게이트는 서버 로더(getCollectionBanners)가 건다. 화면이 받은 배너를 클라이언트 컨텍스트(초기값 꺼짐)로 다시 걷으면
       첫 HTML 에서 배너만 빠지고 h1 시각 숨김·padding-top 0 은 남는다 — 그 어긋남이 없어야 한다. */
    const gatedOpen = renderWith('best', [banner('packs', 'best', { href: '/packs' })], {}, ['d', 'b']);
    expect(gatedOpen).toContain('wc-collection-banners--contained');
    expect(gatedOpen).toContain('href="/packs"');
    expect(gatedOpen).toContain('wc-collection--banner');

    const gatedClosed = renderWith('best', [], {}, ['d', 'b']);
    expect(gatedClosed).not.toContain('wc-collection-banners');
    expect(gatedClosed).not.toContain('wc-collection--banner');
    expect(gatedClosed).toContain('wc-section-heading');
    expect(gatedClosed).not.toMatch(/<h1 class="wc-sr-only">BEST<\/h1>/);
  });

  it('BEST 배너가 여러 장 와도 첫 장 하나만 — 슬라이더가 되지 않는다(l8b-ui-1)', () => {
    const html = renderWith('best', [banner('b1', 'best'), banner('b2', 'best')], {}, ['d', 'b']);

    expect(html).toContain('배너 b1');
    expect(html).not.toContain('배너 b2');
    expect(html).not.toContain('aria-roledescription="carousel"');
  });

  it('스코프가 빈 BEST 도 배너는 그대로 두고 준비 중 안내를 잇는다', () => {
    const html = renderWith('best', [banner('b1', 'best')], {}, []);

    expect(html).toContain('wc-collection-banners--contained');
    expect(html).toContain('아직 준비 중이에요');
  });
});
