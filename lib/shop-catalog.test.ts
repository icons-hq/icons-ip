import { describe, expect, it } from 'vitest';
import type { Good, Ip, Stock } from './data';
import {
  SHOP_DEFAULT_SORT,
  SHOP_PAGE_SIZE,
  SHOP_SORTS,
  SHOP_SORT_LABELS,
  parseShopSearchParams,
  selectShopGoods,
  type ShopListQuery,
} from './shop-catalog';

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
    img: `good-${id}`,
    ...overrides,
  };
}

const ips = [ip('ip1', '홍실'), ip('ip2', '메이플'), ip('ip3', '빈 IP')];

const goods = [
  good('a', 'ip1', { price: 30000, type: '피규어', badge: 'NEW', createdAt: '2026-08-01T00:00:00Z' }),
  good('b', 'ip1', { price: 10000, type: '키링', createdAt: '2026-08-20T00:00:00Z' }),
  good('c', 'ip2', { price: 20000, type: '키링', badge: 'NEW', stock: 'soldout', stockQty: 0 }),
  good('d', 'ip2', { price: 50000, type: '인형', compareAtPrice: 60000, createdAt: '2026-07-01T00:00:00Z' }),
];

const catalog = { ips, goods };

const validIpIds = new Set(ips.map((item) => item.id));

function query(overrides: Partial<ShopListQuery> = {}): ShopListQuery {
  return {
    ips: [],
    types: [],
    priceMin: null,
    priceMax: null,
    sort: 'recommended',
    view: 'all',
    ...overrides,
  };
}

function ids(result: { goods: Good[] }) {
  return result.goods.map((item) => item.id);
}

describe('정렬 상수', () => {
  it('정렬 4종에 모두 한국어 라벨이 있고 페이지 크기는 20이다', () => {
    expect(SHOP_SORTS).toEqual(['recommended', 'newest', 'price_asc', 'price_desc']);
    expect(SHOP_SORT_LABELS).toEqual({
      recommended: '추천순',
      newest: '최신순',
      price_asc: '낮은 가격순',
      price_desc: '높은 가격순',
    });
    expect(SHOP_PAGE_SIZE).toBe(20);
  });
});

describe('parseShopSearchParams', () => {
  it('반복된 ip 파라미터를 모으고 카탈로그에 없는 id 와 중복은 버린다', () => {
    const parsed = parseShopSearchParams(
      { ip: ['ip1', 'ghost', 'ip2', 'ip1'] },
      { view: 'all', validIpIds },
    );

    expect(parsed.ips).toEqual(['ip1', 'ip2']);
  });

  it('단일 문자열 ip 파라미터도 목록으로 받는다', () => {
    expect(parseShopSearchParams({ ip: 'ip2' }, { view: 'all', validIpIds }).ips).toEqual(['ip2']);
  });

  it('상품 타입은 표준 분류 값만 남긴다', () => {
    const parsed = parseShopSearchParams(
      { type: ['키링', '잡화', '인형'] },
      { view: 'all', validIpIds },
    );

    expect(parsed.types).toEqual(['키링', '인형']);
  });

  it('가격은 0 이상 정수만 받고 음수·비정수·빈 값은 null 이다', () => {
    const parsed = parseShopSearchParams(
      { min: '15000', max: '40000' },
      { view: 'all', validIpIds },
    );
    expect(parsed.priceMin).toBe(15000);
    expect(parsed.priceMax).toBe(40000);

    const rejected = parseShopSearchParams(
      { min: '-100', max: '20.5' },
      { view: 'all', validIpIds },
    );
    expect(rejected.priceMin).toBeNull();
    expect(rejected.priceMax).toBeNull();

    const blank = parseShopSearchParams({ min: '', max: 'abc' }, { view: 'all', validIpIds });
    expect(blank.priceMin).toBeNull();
    expect(blank.priceMax).toBeNull();

    const repeated = parseShopSearchParams({ min: ['1000', '2000'] }, { view: 'all', validIpIds });
    expect(repeated.priceMin).toBe(1000);
  });

  it('알 수 없는 정렬은 뷰별 기본값으로 떨어진다', () => {
    expect(parseShopSearchParams({ sort: 'hot' }, { view: 'all', validIpIds }).sort).toBe('recommended');
    expect(parseShopSearchParams({}, { view: 'new', validIpIds }).sort).toBe('newest');
    expect(parseShopSearchParams({}, { view: 'best', validIpIds }).sort).toBe('recommended');
    expect(SHOP_DEFAULT_SORT).toEqual({ all: 'recommended', new: 'newest', best: 'recommended' });
  });

  it('알려진 정렬 값은 그대로 쓰고 뷰를 함께 실어 보낸다', () => {
    const parsed = parseShopSearchParams({ sort: 'price_desc' }, { view: 'new', validIpIds });

    expect(parsed.sort).toBe('price_desc');
    expect(parsed.view).toBe('new');
  });

  it('파라미터가 없으면 빈 필터를 만든다', () => {
    expect(parseShopSearchParams({}, { view: 'all', validIpIds })).toEqual({
      ips: [],
      types: [],
      priceMin: null,
      priceMax: null,
      sort: 'recommended',
      view: 'all',
    });
  });
});

describe('selectShopGoods 필터', () => {
  it('필터가 없으면 카탈로그 순서 전량과 총계를 준다', () => {
    const result = selectShopGoods(catalog, query());

    expect(ids(result)).toEqual(['a', 'b', 'c', 'd']);
    expect(result.total).toBe(4);
    expect(result.filteredTotal).toBe(4);
  });

  it('IP·타입·가격 필터를 함께 적용한다', () => {
    expect(ids(selectShopGoods(catalog, query({ ips: ['ip1'] })))).toEqual(['a', 'b']);
    expect(ids(selectShopGoods(catalog, query({ types: ['키링'] })))).toEqual(['b', 'c']);
    expect(ids(selectShopGoods(catalog, query({ ips: ['ip1', 'ip2'], types: ['키링'] })))).toEqual(['b', 'c']);
  });

  it('가격 필터는 경계값을 포함하는 폐구간이다', () => {
    expect(ids(selectShopGoods(catalog, query({ priceMin: 20000, priceMax: 30000 })))).toEqual(['a', 'c']);
    expect(ids(selectShopGoods(catalog, query({ priceMin: 30001 })))).toEqual(['d']);
    expect(ids(selectShopGoods(catalog, query({ priceMax: 10000 })))).toEqual(['b']);
  });

  it('조건에 맞는 굿즈가 없어도 뷰 스코프 총계는 유지한다', () => {
    const result = selectShopGoods(catalog, query({ ips: ['ip3'] }));

    expect(result.goods).toEqual([]);
    expect(result.filteredTotal).toBe(0);
    expect(result.total).toBe(4);
  });

  it('품절 굿즈도 목록에 남는다', () => {
    expect(ids(selectShopGoods(catalog, query({ types: ['키링'] })))).toContain('c');
  });

  it('입력 배열을 변형하지 않는다', () => {
    const input = { ips: [...ips], goods: [...goods] };
    selectShopGoods(input, query({ sort: 'price_desc' }));

    expect(input.goods.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('selectShopGoods 정렬', () => {
  it('추천순은 카탈로그 원순서다', () => {
    expect(ids(selectShopGoods(catalog, query({ sort: 'recommended' })))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('추천순은 설정된 진열 순서를 먼저 쓰고 중복·미설정은 기존 ID 순서로 안정화한다', () => {
    const ordered = {
      ips,
      goods: [
        good('z', 'ip1', { displayOrder: null }),
        good('b', 'ip1', { displayOrder: 2 }),
        good('a', 'ip1', { displayOrder: 1 }),
        good('c', 'ip1', { displayOrder: 2 }),
      ],
    };

    expect(ids(selectShopGoods(ordered, query()))).toEqual(['a', 'b', 'c', 'z']);
    expect(ids(selectShopGoods(ordered, query({ types: ['키링'] })))).toEqual(['a', 'b', 'c', 'z']);
  });

  it('사용자가 고른 최신순·가격순은 진열 순서를 덮어쓴다', () => {
    const ordered = {
      ips,
      goods: [
        good('late', 'ip1', { displayOrder: 1, price: 20000, createdAt: '2026-09-10T00:00:00Z' }),
        good('early', 'ip1', { displayOrder: 2, price: 10000, createdAt: '2026-09-01T00:00:00Z' }),
      ],
    };

    expect(ids(selectShopGoods(ordered, query({ sort: 'newest' })))).toEqual(['late', 'early']);
    expect(ids(selectShopGoods(ordered, query({ sort: 'price_asc' })))).toEqual(['early', 'late']);
  });

  it('BEST 큐레이션은 공통 진열 순서보다 앞선다', () => {
    const ordered = {
      ips,
      goods: [good('a', 'ip1', { displayOrder: 2 }), good('b', 'ip1', { displayOrder: 1 })],
    };
    expect(ids(selectShopGoods(ordered, query({ view: 'best' }), ['a', 'b']))).toEqual(['a', 'b']);
  });

  it('가격순은 오름·내림차순으로 정렬한다', () => {
    expect(ids(selectShopGoods(catalog, query({ sort: 'price_asc' })))).toEqual(['b', 'c', 'a', 'd']);
    expect(ids(selectShopGoods(catalog, query({ sort: 'price_desc' })))).toEqual(['d', 'a', 'c', 'b']);
  });

  it('최신순은 등록 시각 내림차순이고 시각이 없는 굿즈는 뒤로 원순서를 지킨다', () => {
    expect(ids(selectShopGoods(catalog, query({ sort: 'newest' })))).toEqual(['b', 'a', 'd', 'c']);
  });

  it('등록 시각이 없는 굿즈끼리는 카탈로그 순서를 유지한다', () => {
    const undated = { ips, goods: [good('x', 'ip1'), good('y', 'ip1'), good('z', 'ip1', { createdAt: '2026-01-01T00:00:00Z' })] };

    expect(ids(selectShopGoods(undated, query({ sort: 'newest' })))).toEqual(['z', 'x', 'y']);
  });
});

describe('selectShopGoods 뷰', () => {
  it('NEW 뷰는 NEW 배지 굿즈만 스코프로 잡는다', () => {
    const result = selectShopGoods(catalog, query({ view: 'new' }));

    expect(ids(result)).toEqual(['a', 'c']);
    expect(result.total).toBe(2);
  });

  it('BEST 뷰는 큐레이션 순서를 따르고 없는 id 와 중복은 무시한다', () => {
    const result = selectShopGoods(catalog, query({ view: 'best' }), ['d', 'ghost', 'b', 'd']);

    expect(ids(result)).toEqual(['d', 'b']);
    expect(result.total).toBe(2);
  });

  it('BEST 뷰의 추천순은 큐레이션 순서이고 다른 정렬은 그 스코프 안에서만 다시 정렬한다', () => {
    expect(ids(selectShopGoods(catalog, query({ view: 'best' }), ['d', 'b']))).toEqual(['d', 'b']);
    expect(ids(selectShopGoods(catalog, query({ view: 'best', sort: 'price_asc' }), ['d', 'b']))).toEqual(['b', 'd']);
  });

  it('BEST 큐레이션이 비면 빈 스코프다', () => {
    const result = selectShopGoods(catalog, query({ view: 'best' }));

    expect(result.goods).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.priceCeil).toBe(0);
  });
});

describe('selectShopGoods facet', () => {
  it('IP facet 은 뷰 스코프 기준 카운트를 카탈로그 순서로 주고 0건 IP 는 뺀다', () => {
    expect(selectShopGoods(catalog, query()).ipFacets).toEqual([
      { value: 'ip1', label: '홍실', count: 2 },
      { value: 'ip2', label: '메이플', count: 2 },
    ]);
  });

  it('타입 facet 은 표준 분류 순서를 따르고 0건 타입은 뺀다', () => {
    expect(selectShopGoods(catalog, query()).typeFacets).toEqual([
      { value: '피규어', label: '피규어', count: 1 },
      { value: '인형', label: '인형', count: 1 },
      { value: '키링', label: '키링', count: 2 },
    ]);
  });

  it('facet 과 가격 상한은 필터가 아니라 뷰 스코프에서 나온다', () => {
    const filtered = selectShopGoods(catalog, query({ ips: ['ip1'], priceMax: 10000 }));

    expect(filtered.ipFacets.map((facet) => facet.value)).toEqual(['ip1', 'ip2']);
    expect(filtered.priceCeil).toBe(50000);

    const newView = selectShopGoods(catalog, query({ view: 'new' }));
    expect(newView.ipFacets).toEqual([
      { value: 'ip1', label: '홍실', count: 1 },
      { value: 'ip2', label: '메이플', count: 1 },
    ]);
    expect(newView.priceCeil).toBe(30000);
  });

  it('빈 카탈로그는 빈 facet 과 0 상한을 준다', () => {
    const empty = selectShopGoods({ ips: [], goods: [] }, query());

    expect(empty.ipFacets).toEqual([]);
    expect(empty.typeFacets).toEqual([]);
    expect(empty.priceCeil).toBe(0);
    expect(empty.total).toBe(0);
  });
});

describe('고객 계층 카테고리', () => {
  const categories = [
    { id: 'root', parentId: null, name: '생활', code: 'life', depth: 1, sortOrder: 0 },
    { id: 'child', parentId: 'root', name: '문구', code: 'stationery', depth: 2, sortOrder: 0 },
    { id: 'leaf', parentId: 'child', name: '노트', code: 'note', depth: 3, sortOrder: 0 },
    { id: 'last', parentId: 'leaf', name: '줄노트', code: 'lined', depth: 4, sortOrder: 0 },
  ];
  const catalog = { ips, categories, goods: [good('g1', 'ip1', { categoryId: 'last' }), good('g2', 'ip1')] };
  const parse = (params: Record<string, string | string[]>) => parseShopSearchParams(params, { view: 'all', validIpIds: new Set(['ip1']), validCategoryIds: new Set(categories.map((category) => category.id)) });
  it('상위 분류는 4단계 하위 굿즈까지 포함하고 미분류는 전체에 남는다', () => {
    expect(selectShopGoods(catalog, parse({})).goods).toHaveLength(2);
    const result = selectShopGoods(catalog, parse({ category: ['root', 'child'] }));
    expect(result.goods.map((item) => item.id)).toEqual(['g1']);
    expect(result.categoryFacets?.map((facet) => facet.count)).toEqual([1, 1, 1, 1]);
  });
  it('활성 공개 분류만 URL에서 받고 기존 유형 필터와 결합한다', () => {
    expect(parse({ category: 'archived' }).categories).toEqual([]);
    expect(selectShopGoods(catalog, parse({ category: 'root', type: '문구' })).goods).toHaveLength(0);
    expect(selectShopGoods({ ...catalog, categories: [] }, parseShopSearchParams({}, { view: 'all', validIpIds: new Set(['ip1']) })).goods).toHaveLength(2);
  });
});
