import { describe, expect, it } from 'vitest';
import type { Good, Ip, Vertical } from '@/lib/data';
import { SEARCH_GOODS_PAGE_SIZE, matchSearchGoods, searchGoods, searchPageWindow, selectSearchGoods } from './search-goods';
import { parseShopSearchParams, type ShopListQuery } from './shop-catalog';

const vertical: Vertical = { key: 'toy', label: '토이', color: '#111' };

const ip = (id: string, title: string): Ip => ({
  id,
  title,
  sub: '서브',
  v: vertical,
  glyph: 'A',
  bg: 'none',
  fans: 0,
  goods: 0,
  cards: 0,
  featured: false,
  tagline: '',
  synopsis: '',
});

const good = (id: string, overrides: Partial<Good> = {}): Good => ({
  id,
  name: `굿즈 ${id}`,
  ip: 'rilakkuma',
  type: '키링',
  price: 12000,
  badge: null,
  stock: 'ok',
  stockQty: 10,
  img: 'none',
  ...overrides,
});

const ips = [ip('rilakkuma', '리락쿠마'), ip('maple', '메이플스토리')];

function catalogOf(goods: Good[]) {
  return { ips, goods };
}

describe('searchGoods 매칭 축', () => {
  it('굿즈명을 대소문자 무시 부분일치로 찾는다', () => {
    const catalog = catalogOf([
      good('g1', { name: 'Rilakkuma BIG 인형' }),
      good('g2', { name: '담곰이 파우치', ip: 'maple' }),
    ]);

    const result = searchGoods(catalog, 'rilakkuma big', 1);

    expect(result.items.map((item) => item.id)).toEqual(['g1']);
    expect(result.total).toBe(1);
  });

  it('분류·배지·소속 IP 제목으로도 찾는다', () => {
    const catalog = catalogOf([
      good('g1', { name: '이름에 없음', type: '쿠션' }),
      good('g2', { name: '이름에 없음2', badge: 'EXCLUSIVE' }),
      good('g3', { name: '이름에 없음3', ip: 'maple' }),
      good('g4', { name: '이름에 없음4' }),
    ]);

    expect(searchGoods(catalog, '쿠션', 1).items.map((item) => item.id)).toEqual(['g1']);
    expect(searchGoods(catalog, 'exclusive', 1).items.map((item) => item.id)).toEqual(['g2']);
    expect(searchGoods(catalog, '메이플', 1).items.map((item) => item.id)).toEqual(['g3']);
  });

  it('저장된 검색 키워드로 찾고 굿즈명 일치 다음에 둔다', () => {
    const result = searchGoods(catalogOf([
      good('keyword', { name: '표시 이름', searchKeywords: ['  여름 굿즈 ', 'KUMA'] }),
      good('name', { name: '여름 굿즈 본품' }),
      good('other', { name: '무관' }),
    ]), '여름 굿즈', 1);

    expect(result.items.map((item) => item.id)).toEqual(['name', 'keyword']);
    expect(result.total).toBe(2);
  });

  it('어느 축에도 걸리지 않으면 제외한다', () => {
    const catalog = catalogOf([good('g1'), good('g2')]);

    expect(searchGoods(catalog, '존재하지않는어휘', 1).total).toBe(0);
  });
});

describe('searchGoods 정렬', () => {
  it('굿즈명 일치 > IP 일치 > 나머지 순으로 놓고 동순위는 카탈로그 원순서를 지킨다', () => {
    /* 세 순위를 한 질의로 가르려면 질의어가 이름·IP 제목·그 밖(분류)에 각각 심겨야 한다.
       'IP 제목의 일부'를 질의어로 삼고 같은 어휘를 이름과 분류에도 심는다. */
    const catalog = catalogOf([
      good('rest-1', { name: '무관', type: '메이플 세트' }),
      good('ip-1', { name: '무관', ip: 'maple' }),
      good('name-1', { name: '메이플 인형' }),
      good('ip-2', { name: '무관2', ip: 'maple' }),
      good('name-2', { name: '메이플 키링' }),
    ]);

    expect(searchGoods(catalog, '메이플', 1).items.map((item) => item.id))
      .toEqual(['name-1', 'name-2', 'ip-1', 'ip-2', 'rest-1']);
  });
});

describe('searchGoods 페이지', () => {
  const many = Array.from({ length: SEARCH_GOODS_PAGE_SIZE * 2 + 5 }, (_, index) => (
    good(`g${index}`, { name: `키링 ${index}` })
  ));

  it('요청 페이지만큼 슬라이스하고 페이지 수를 센다', () => {
    const first = searchGoods(catalogOf(many), '키링', 1);
    const last = searchGoods(catalogOf(many), '키링', 3);

    expect(SEARCH_GOODS_PAGE_SIZE).toBe(40);
    expect(first.items).toHaveLength(SEARCH_GOODS_PAGE_SIZE);
    expect(first.items[0].id).toBe('g0');
    expect(first.total).toBe(85);
    expect(first.pageCount).toBe(3);
    expect(last.items).toHaveLength(5);
    expect(last.items[0].id).toBe('g80');
  });

  it('범위를 벗어난 페이지는 클램프한다', () => {
    expect(searchGoods(catalogOf(many), '키링', 99).page).toBe(3);
    expect(searchGoods(catalogOf(many), '키링', 0).page).toBe(1);
    expect(searchGoods(catalogOf(many), '키링', Number.NaN).page).toBe(1);
  });

  it('결과가 없으면 page 1 · pageCount 1 이다', () => {
    const result = searchGoods(catalogOf(many), '존재하지않는어휘', 2);

    expect(result).toEqual({ items: [], total: 0, page: 1, pageCount: 1 });
  });
});

describe('searchGoods 빈 질의', () => {
  it('빈 문자열·공백만 있는 질의는 아무것도 내지 않는다', () => {
    const catalog = catalogOf([good('g1'), good('g2')]);

    expect(searchGoods(catalog, '', 1).total).toBe(0);
    expect(searchGoods(catalog, '   ', 1).total).toBe(0);
    expect(searchGoods(catalog, '', 1).items).toEqual([]);
  });
});

describe('matchSearchGoods 와일드카드', () => {
  /* 검색어의 % · _ 는 SQL 와일드카드가 아니라 글자 그대로다(검색 불변식). */
  it('%·_ 를 글자 그대로 비교한다', () => {
    const catalog = catalogOf([good('pct', { name: '100% 면 파우치' }), good('plain', { name: '면 파우치' }), good('under', { name: 'a_b 키링' })]);

    expect(matchSearchGoods(catalog, '100%').map((item) => item.id)).toEqual(['pct']);
    expect(matchSearchGoods(catalog, '%').map((item) => item.id)).toEqual(['pct']);
    expect(matchSearchGoods(catalog, '_').map((item) => item.id)).toEqual(['under']);
  });
});

describe('selectSearchGoods (SR-01)', () => {
  const listQuery = (params: Record<string, string | string[]> = {}): ShopListQuery =>
    parseShopSearchParams(params, { view: 'search', validIpIds: new Set(ips.map((item) => item.id)) });
  const catalog = catalogOf([
    good('rest', { name: '무관', ip: 'maple', type: '리락쿠마 세트', price: 7000 }),
    good('ipGood', { name: '무관2', price: 5000 }),
    good('name', { name: '리락쿠마 인형', type: '인형', price: 30000 }),
    good('name2', { name: '리락쿠마 키링', price: 9000 }),
    good('other', { name: '관계없음', ip: 'maple' }),
  ]);

  it('관련성 순서를 기본 정렬로 쓰고 facet·가격 상한은 필터 전 검색 스코프에서 센다', () => {
    const collection = selectSearchGoods(catalog, '리락쿠마', listQuery(), 1);

    expect(collection.result.goods.map((item) => item.id)).toEqual(['name', 'name2', 'ipGood', 'rest']);
    expect(collection.result.total).toBe(4);
    expect(collection.result.ipFacets).toEqual([
      { value: 'rilakkuma', label: '리락쿠마', count: 3 },
      { value: 'maple', label: '메이플스토리', count: 1 },
    ]);
    expect(collection.result.priceCeil).toBe(30000);
  });

  it('IP·타입·가격 필터와 가격 정렬을 굿즈샵과 같은 규칙으로 얹는다', () => {
    const filtered = selectSearchGoods(catalog, '리락쿠마', listQuery({ type: '인형', sort: 'price_desc' }), 1);

    expect(filtered.result.goods.map((item) => item.id)).toEqual(['name']);
    expect(filtered.result.filteredTotal).toBe(1);
    expect(filtered.result.total).toBe(4);
    expect(selectSearchGoods(catalog, '리락쿠마', listQuery({ ip: 'rilakkuma', sort: 'price_asc' }), 1).result.goods.map((item) => item.id))
      .toEqual(['ipGood', 'name2', 'name']);
  });

  it('페이지는 필터 뒤 개수로 세고 범위를 벗어나면 클램프한다', () => {
    const many = catalogOf(Array.from({ length: SEARCH_GOODS_PAGE_SIZE + 5 }, (_, index) => good(`k${index}`, { name: `키링 ${index}`, price: index < 3 ? 1000 : 9000 })));

    const all = selectSearchGoods(many, '키링', listQuery(), 2);
    expect(all.pageCount).toBe(2);
    expect(all.result.goods).toHaveLength(5);
    expect(all.result.goods[0].id).toBe(`k${SEARCH_GOODS_PAGE_SIZE}`);

    const narrowed = selectSearchGoods(many, '키링', listQuery({ max: '1000' }), 9);
    expect(narrowed.pageCount).toBe(1);
    expect(narrowed.page).toBe(1);
    expect(narrowed.result.goods).toHaveLength(3);
  });

  it('빈 질의는 빈 스코프다', () => {
    const empty = selectSearchGoods(catalog, '   ', listQuery(), 1);

    expect(empty.result.total).toBe(0);
    expect(empty.result.goods).toEqual([]);
    expect(empty.pageCount).toBe(1);
  });
});

describe('searchPageWindow (SR-03 · 11 §6 B8)', () => {
  it('고정 창으로 셀을 자르고 이전·다음은 창 단위로 건너뛴다', () => {
    expect(searchPageWindow(13, 30, 10)).toEqual({ start: 11, end: 20, prev: 10, next: 21 });
    expect(searchPageWindow(7, 30, 5)).toEqual({ start: 6, end: 10, prev: 5, next: 11 });
  });

  it('더 갈 창이 없으면 첫·마지막 페이지로 보내고, 이미 거기면 화살표를 없앤다', () => {
    expect(searchPageWindow(3, 7, 10)).toEqual({ start: 1, end: 7, prev: 1, next: 7 });
    expect(searchPageWindow(1, 7, 10)).toEqual({ start: 1, end: 7, prev: null, next: 7 });
    expect(searchPageWindow(7, 7, 10)).toEqual({ start: 1, end: 7, prev: 1, next: null });
  });

  it('URL 쓰레기 페이지도 창 안으로 클램프한다', () => {
    expect(searchPageWindow(Number.NaN, 30, 10).start).toBe(1);
    expect(searchPageWindow(99, 30, 10)).toEqual({ start: 21, end: 30, prev: 20, next: null });
  });
});
