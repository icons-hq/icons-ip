import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Good, Ip, Stock } from '@/lib/data';
import {
  parseShopSearchParams,
  selectShopGoods,
  type ShopView,
} from '@/lib/shop-catalog';
import {
  EMPTY_SHOP_FILTER_DRAFT,
  Shop,
  setDraftPriceRange,
  shopFilterDraftFromQuery,
  shopQueryString,
  toggleDraftValue,
} from './Shop';

vi.mock('next/navigation', () => ({
  usePathname: () => '/shop',
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

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
) {
  const query = parseShopSearchParams(params, {
    view,
    validIpIds: new Set(source.ips.map((item) => item.id)),
  });
  const result = selectShopGoods(source, query, bestGoodIds);
  return renderToStaticMarkup(<Shop query={query} result={result} view={view} />);
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
    expect(text(render('all'))).toContain('전체 4개 굿즈');
    expect(text(render('all', { ip: 'ip1' }))).toContain('전체 2/4개 굿즈');
  });

  it('정렬 4종을 네이티브 select 로 주고 현재 정렬을 선택 상태로 둔다', () => {
    const html = render('all', { sort: 'price_desc' });

    expect(html).toContain('추천순');
    expect(html).toContain('최신순');
    expect(html).toContain('낮은 가격순');
    expect(html).toMatch(/<option[^>]*value="price_desc"[^>]*selected[^>]*>높은 가격순<\/option>/);
  });

  it('IP·타입 facet 을 개수와 함께 그리고 선택된 값은 체크한다', () => {
    const html = render('all', { ip: 'ip2' });

    expect(text(html)).toContain('홍실 (2)');
    expect(text(html)).toContain('메이플 (2)');
    expect(text(html)).toContain('키링 (2)');
    expect(html).toContain('IP (1)');
    expect(html).toContain('상품 타입 (0)');
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

  it('그리드 카드에는 장바구니·위시 버튼을 두지 않는다', () => {
    const html = render('all');

    expect(html).not.toContain('담기');
    expect(html).not.toContain('wc-wish-heart');
  });

  it('한 페이지를 넘길 때만 더 보기를 노출한다', () => {
    const many = {
      ips: [ip('ip1', '홍실')],
      goods: Array.from({ length: 25 }, (_, index) => good(`m${index}`, 'ip1')),
    };

    expect(render('all', {}, many)).toContain('wc-view-more');
    expect(render('all')).not.toContain('wc-view-more');
  });

  it('모바일 필터 트리거와 전체 초기화를 제공한다', () => {
    const html = render('all', { ip: 'ip1' });

    expect(html).toContain('필터 및 정렬');
    expect(html).toContain('전체 초기화');
    expect(html).toContain('wc-filter-trigger');
  });
});

describe('굿즈샵 빈 상태', () => {
  it('필터 결과가 없으면 초기화 안내를 띄우고 정렬 컨트롤을 감춘다', () => {
    const html = render('all', { min: '90000' });

    expect(text(html)).toContain('전체 0/4개 굿즈');
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

  it('NEW 는 제목과 부제를 노출하고 NEW 배지 굿즈만 담는다', () => {
    const html = render('new');

    expect(html).toMatch(/<h1[^>]*>NEW<\/h1>/);
    expect(html).toContain('새로 나온 굿즈를 모아 봤어요.');
    expect(html).toContain('홍실 피규어');
    expect(html).not.toContain('메이플 인형');
  });

  it('BEST 는 큐레이션 순서를 그대로 그린다', () => {
    const html = render('best', {}, catalog, ['d', 'b']);

    expect(html).toMatch(/<h1[^>]*>BEST<\/h1>/);
    expect(html).toContain('지금 가장 사랑받는 굿즈예요.');
    expect(html.indexOf('메이플 인형')).toBeLessThan(html.indexOf('홍실 키링'));
  });
});
