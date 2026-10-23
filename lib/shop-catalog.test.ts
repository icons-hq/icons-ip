import { describe, expect, it } from 'vitest';
import type { Good, Ip, Stock } from './data';
import {
  SHOP_DEFAULT_SORT,
  SHOP_PAGE_SIZE,
  SHOP_PREORDER_TYPE,
  SHOP_SORTS,
  SHOP_SORT_LABELS,
  SHOP_VIEW_SORTS,
  isPreorderGood,
  parseShopSearchParams,
  selectCollectionGoods,
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
  it('서버 페이지네이션 정렬 4종은 DB 화이트리스트와 같고 페이지 크기는 20이다', () => {
    /* get_category_display_page 가 받는 값과 하나라도 어긋나면 카테고리 전시 페이지가 실패한다. */
    expect(SHOP_SORTS).toEqual(['recommended', 'newest', 'price_asc', 'price_desc']);
    expect(SHOP_PAGE_SIZE).toBe(20);
  });

  it('모든 정렬에 한국어 라벨이 있다 — 이름 가나다순·역순·오래된순이 더해졌다(12 LD-13)', () => {
    expect(SHOP_SORT_LABELS).toEqual({
      recommended: '추천순',
      relevance: '관련성순',
      name_asc: '이름 가나다순',
      name_desc: '이름 역순',
      price_asc: '낮은 가격순',
      price_desc: '높은 가격순',
      oldest: '오래된순',
      newest: '최신순',
    });
  });

  it('목록은 레퍼런스 순서의 7종, 검색은 관련성·가격 3종을 고르게 한다(베스트셀러 보류)', () => {
    const collection = ['recommended', 'name_asc', 'name_desc', 'price_asc', 'price_desc', 'oldest', 'newest'];
    expect(SHOP_VIEW_SORTS.all).toEqual(collection);
    expect(SHOP_VIEW_SORTS.new).toEqual(collection);
    expect(SHOP_VIEW_SORTS.best).toEqual(collection);
    expect(SHOP_VIEW_SORTS.ip).toEqual(collection);
    expect(SHOP_VIEW_SORTS.search).toEqual(['relevance', 'price_asc', 'price_desc']);
    for (const sorts of Object.values(SHOP_VIEW_SORTS)) expect(sorts).not.toContain('best_selling');
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
    expect(parseShopSearchParams({}, { view: 'search', validIpIds }).sort).toBe('relevance');
    expect(parseShopSearchParams({}, { view: 'ip', validIpIds }).sort).toBe('recommended');
    expect(SHOP_DEFAULT_SORT).toEqual({ all: 'recommended', new: 'newest', best: 'recommended', ip: 'recommended', search: 'relevance' });
  });

  it('정렬 값은 그 뷰가 고르게 하는 목록 안에서만 받는다', () => {
    expect(parseShopSearchParams({ sort: 'name_asc' }, { view: 'all', validIpIds }).sort).toBe('name_asc');
    expect(parseShopSearchParams({ sort: 'oldest' }, { view: 'ip', validIpIds }).sort).toBe('oldest');
    /* 검색은 관련성·가격만 있다 — 다른 값은 관련성으로 떨어진다. */
    expect(parseShopSearchParams({ sort: 'name_asc' }, { view: 'search', validIpIds }).sort).toBe('relevance');
    expect(parseShopSearchParams({ sort: 'price_asc' }, { view: 'search', validIpIds }).sort).toBe('price_asc');
    expect(parseShopSearchParams({ sort: 'relevance' }, { view: 'all', validIpIds }).sort).toBe('recommended');
  });

  it('예약판매는 타입 축의 값으로 받는다', () => {
    expect(parseShopSearchParams({ type: [SHOP_PREORDER_TYPE, '키링', 'PRE-ORDER'] }, { view: 'all', validIpIds }).types)
      .toEqual([SHOP_PREORDER_TYPE, '키링']);
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

  it('오래된순은 등록 시각 오름차순이고 시각이 없는 굿즈는 역시 뒤로 원순서를 지킨다', () => {
    expect(ids(selectShopGoods(catalog, query({ sort: 'oldest' })))).toEqual(['d', 'a', 'b', 'c']);
    const undated = { ips, goods: [good('x', 'ip1'), good('y', 'ip1'), good('z', 'ip1', { createdAt: '2026-01-01T00:00:00Z' })] };
    expect(ids(selectShopGoods(undated, query({ sort: 'oldest' })))).toEqual(['z', 'x', 'y']);
  });

  it('이름순은 숫자 → 한글 가나다 → 영문이고 숫자는 자연수로 비교한다', () => {
    const named = {
      ips,
      goods: [
        good('n1', 'ip1', { name: '키링' }),
        good('n2', 'ip1', { name: 'Acrylic' }),
        good('n3', 'ip1', { name: '10번 세트' }),
        good('n4', 'ip1', { name: '가방' }),
        good('n5', 'ip1', { name: '2번 세트' }),
      ],
    };

    expect(ids(selectShopGoods(named, query({ sort: 'name_asc' })))).toEqual(['n5', 'n3', 'n4', 'n1', 'n2']);
    expect(ids(selectShopGoods(named, query({ sort: 'name_desc' })))).toEqual(['n2', 'n1', 'n4', 'n3', 'n5']);
  });

  it('이름이 같은 굿즈는 진열(스코프) 순서를 지킨다', () => {
    const same = { ips, goods: [good('s2', 'ip1', { name: '같은 이름' }), good('s1', 'ip1', { name: '같은 이름' })] };

    expect(ids(selectShopGoods(same, query({ sort: 'name_asc' })))).toEqual(['s2', 's1']);
    expect(ids(selectShopGoods(same, query({ sort: 'name_desc' })))).toEqual(['s2', 's1']);
  });
});

describe('selectCollectionGoods 스코프', () => {
  it('검색 스코프는 관련성 순서가 추천 기준이고 진열 순서로 다시 줄 세우지 않는다', () => {
    const scope = [good('late', 'ip1', { displayOrder: 9 }), good('early', 'ip1', { displayOrder: 1 })];
    const result = selectCollectionGoods(scope, { ips }, query({ view: 'search', sort: 'relevance' }));

    expect(ids(result)).toEqual(['late', 'early']);
    expect(ids(selectCollectionGoods(scope, { ips }, query({ view: 'search', sort: 'price_asc' })))).toEqual(['late', 'early']);
  });

  it('IP관 스코프는 굿즈샵과 같은 진열 순서·facet 규칙을 쓴다', () => {
    const scope = goods.filter((item) => item.ip === 'ip1');
    const result = selectCollectionGoods(scope, { ips }, query({ view: 'ip' }));

    expect(ids(result)).toEqual(['a', 'b']);
    expect(result.total).toBe(2);
    expect(result.ipFacets).toEqual([{ value: 'ip1', label: '홍실', count: 2 }]);
    expect(result.priceCeil).toBe(30000);
  });
});

describe('예약판매 타입 값 (11 §3 Δ6 · CL-11)', () => {
  const preorderSupply = {
    mode: 'preorder' as const, availableQty: 5, policyId: '11111111-1111-4111-8111-111111111111', policyRevision: 1,
    state: 'open' as const, startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-11-01T00:00:00Z', expectedShipDate: '2026-11-20',
    calculatedAt: '2026-10-20T00:00:00Z', nextChangeAt: '2026-11-01T00:00:00Z',
  };
  const preorder = good('p1', 'ip1', {
    type: '피규어',
    options: [{ id: 'v1', name: '기본', code: 'P1', price: 10000, stockQty: 5, isDefault: true, attributes: {}, supply: preorderSupply }],
  });
  const scoped = { ips, goods: [...goods, preorder] };

  it('예약판매 옵션을 가진 굿즈를 판별한다', () => {
    expect(isPreorderGood(preorder)).toBe(true);
    expect(isPreorderGood(goods[0])).toBe(false);
  });

  it('스코프에 예약판매 굿즈가 있을 때만 타입 facet 끝에 값 하나로 붙인다', () => {
    expect(selectShopGoods(scoped, query()).typeFacets.at(-1)).toEqual({ value: SHOP_PREORDER_TYPE, label: SHOP_PREORDER_TYPE, count: 1 });
    expect(selectShopGoods(catalog, query()).typeFacets.map((facet) => facet.value)).not.toContain(SHOP_PREORDER_TYPE);
  });

  it('타입 그룹 안에서 예약판매와 분류 값은 OR 로 고른다', () => {
    expect(ids(selectShopGoods(scoped, query({ types: [SHOP_PREORDER_TYPE] })))).toEqual(['p1']);
    expect(ids(selectShopGoods(scoped, query({ types: [SHOP_PREORDER_TYPE, '인형'] })))).toEqual(['d', 'p1']);
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

  /* 좁힌 스코프(검색·IP관)는 IP·타입처럼 결과가 있는 카테고리만 보인다 — 0개 값을 고르면 빈 목록뿐이다(l4-ui-7).
     지금 고른 값과 그 조상은 0개여도 남겨 해제할 길과 트리 모양을 지킨다. */
  it('결과 0개 카테고리는 숨기고 고른 카테고리와 그 조상은 0개여도 남긴다', () => {
    const tree = [
      ...categories,
      { id: 'toy', parentId: null, name: '인형', code: 'toy', depth: 1, sortOrder: 1 },
      { id: 'cushion', parentId: 'toy', name: '쿠션', code: 'cushion', depth: 2, sortOrder: 0 },
    ];
    const scoped = { ips, categories: tree, goods: [good('g1', 'ip1', { categoryId: 'leaf' }), good('g2', 'ip1')] };
    const parseTree = (params: Record<string, string | string[]>) => parseShopSearchParams(params, { view: 'search', validIpIds: new Set(['ip1']), validCategoryIds: new Set(tree.map((category) => category.id)) });
    const facets = (params: Record<string, string | string[]>) => selectCollectionGoods(scoped.goods, scoped, parseTree(params)).categoryFacets?.map((facet) => `${facet.value}:${facet.count}`);

    expect(facets({})).toEqual(['root:1', 'child:1', 'leaf:1']);
    expect(facets({ category: 'cushion' })).toEqual(['root:1', 'child:1', 'leaf:1', 'toy:0', 'cushion:0']);
    expect(selectCollectionGoods([good('g2', 'ip1')], scoped, parseTree({})).categoryFacets).toEqual([]);
  });
});

describe('목록 카드 별점 (CL-02)', () => {
  it('carries only the result goods’ review summaries and omits the field without catalog summaries', () => {
    const withSummaries = { ips, goods, reviewSummaries: { a: { count: 2, average: 4.5 }, d: { count: 1, average: 3 } } };

    expect(selectShopGoods(withSummaries, query({ ips: ['ip1'] })).reviewSummaries).toEqual({ a: { count: 2, average: 4.5 } });
    expect(selectShopGoods(catalog, query())).not.toHaveProperty('reviewSummaries');
  });
});
