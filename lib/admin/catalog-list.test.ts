import { describe, expect, it } from 'vitest';
import type { AdminGoodRecord, AdminIpRecord } from './catalog.server';
import {
  adminGoodListHref,
  adminGoodStatus,
  adminIpListHref,
  buildAdminGoodList,
  buildAdminIpList,
  normalizeAdminGoodListFilters,
  normalizeAdminIpListFilters,
} from './catalog-list';

const notice = {
  maker: '주식회사 아이콘스',
  origin: '대한민국',
  material: '아크릴',
  size: '80 x 60 x 20mm',
  madeOn: '2026-07',
  asManager: '아이콘스 고객센터',
  asContact: '02-000-0000',
};

function good(overrides: Partial<AdminGoodRecord> & Pick<AdminGoodRecord, 'id'>): AdminGoodRecord {
  return {
    archivedAt: null,
    ipId: 'hwasan',
    name: `굿즈 ${overrides.id}`,
    type: '아크릴',
    price: 10000,
    compareAtPrice: null,
    badge: null,
    stock: 'ok',
    stockQty: 10,
    allowBankTransfer: true,
    bg: null,
    imagePath: null,
    notice,
    description: null,
    galleryPaths: [],
    galleryUrls: [],
    detailImagePath: null,
    detailImageUrl: null,
    ...overrides,
  };
}

function ip(overrides: Partial<AdminIpRecord> & Pick<AdminIpRecord, 'id'>): AdminIpRecord {
  return {
    archivedAt: null,
    title: `IP ${overrides.id}`,
    sub: null,
    verticalKey: 'webtoon',
    tagline: null,
    synopsis: null,
    glyph: null,
    bg: null,
    imagePath: null,
    featured: false,
    fansCount: 0,
    ...overrides,
  };
}

const ips = [
  ip({ id: 'hwasan', title: '화산강림' }),
  ip({ id: 'rilakkuma', title: '리락쿠마', verticalKey: 'character', fansCount: 40 }),
  ip({ id: 'old', title: '지난 IP', archivedAt: '2026-07-01T00:00:00.000Z' }),
];

const goods = [
  good({ id: 'g100', name: '화산강림 아크릴 스탠드', price: 22000, stock: 'low', stockQty: 3 }),
  good({ id: 'g101', name: '화산강림 엽서', price: 3000, type: '문구', stockQty: 50 }),
  good({ id: 'g200', name: '리락쿠마 키링', ipId: 'rilakkuma', price: 15000, stock: 'ok', stockQty: 0 }),
  good({ id: 'g201', name: '리락쿠마 쿠션', ipId: 'rilakkuma', price: 39000, stock: 'soldout', stockQty: 8 }),
  good({ id: 'g900', name: '지난 굿즈', ipId: 'old', archivedAt: '2026-07-01T00:00:00.000Z' }),
];

describe('normalizeAdminGoodListFilters', () => {
  it('빈 쿼리는 전체 목록 1페이지 기본값이 된다', () => {
    expect(normalizeAdminGoodListFilters({})).toEqual({
      tab: 'all',
      ip: '',
      type: '',
      stock: 'all',
      field: 'all',
      query: '',
      sort: null,
      dir: 'asc',
      page: 1,
      size: 20,
      selected: null,
    });
  });

  it('허용 목록 밖의 값·배열·이상한 숫자는 기본값으로 돌린다', () => {
    const filters = normalizeAdminGoodListFilters({
      tab: 'hidden',
      type: '없는 유형',
      stock: ['ok', 'low'],
      field: 'sku',
      sort: 'createdAt',
      dir: 'sideways',
      page: '0',
      size: '33',
      selected: 'g100; drop table',
      ip: '../etc',
    });

    expect(filters).toMatchObject({
      tab: 'all',
      type: '',
      stock: 'all',
      field: 'all',
      sort: null,
      dir: 'asc',
      page: 1,
      size: 20,
      selected: null,
      ip: '',
    });
  });

  it('유효한 조건은 그대로 좁혀 담고 검색어는 100자에서 자른다', () => {
    const filters = normalizeAdminGoodListFilters({
      tab: 'soldout',
      type: '아크릴',
      stock: 'zero',
      field: 'ip',
      query: ` ${'가'.repeat(150)} `,
      sort: 'price',
      dir: 'desc',
      page: '3',
      size: '100',
      selected: 'new',
      ip: 'hwasan',
    });

    expect(filters).toMatchObject({
      tab: 'soldout',
      type: '아크릴',
      stock: 'zero',
      field: 'ip',
      sort: 'price',
      dir: 'desc',
      page: 3,
      size: 100,
      selected: 'new',
      ip: 'hwasan',
    });
    expect(filters.query).toHaveLength(100);
  });
});

describe('adminGoodListHref', () => {
  const base = normalizeAdminGoodListFilters({});

  it('기본값만 있으면 경로 하나로 끝난다', () => {
    expect(adminGoodListHref(base)).toBe('/admin/catalog/goods');
  });

  it('기본값이 아닌 조건만 URL에 남기고 패치는 그 위에 덮는다', () => {
    const filters = { ...base, tab: 'low' as const, query: '스탠드', sort: 'price' as const, dir: 'desc' as const, page: 2, size: 50 };

    expect(adminGoodListHref(filters)).toBe(
      '/admin/catalog/goods?tab=low&query=%EC%8A%A4%ED%83%A0%EB%93%9C&sort=price&dir=desc&page=2&size=50',
    );
    expect(adminGoodListHref(filters, { page: 1, selected: 'g100' })).toBe(
      '/admin/catalog/goods?tab=low&query=%EC%8A%A4%ED%83%A0%EB%93%9C&sort=price&dir=desc&size=50&selected=g100',
    );
  });

  it('정렬이 없으면 방향도 싣지 않고, 오름차순은 기본이라 뺀다', () => {
    expect(adminGoodListHref(base, { dir: 'desc' })).toBe('/admin/catalog/goods');
    expect(adminGoodListHref(base, { sort: 'name', dir: 'asc' })).toBe('/admin/catalog/goods?sort=name');
  });
});

describe('adminGoodStatus', () => {
  it('보관 > 품절(운영 soldout 또는 수량 0) > 재고 부족 > 판매중 순으로 판정한다', () => {
    expect(adminGoodStatus({ archivedAt: '2026-07-01', stock: 'ok', stockQty: 10 })).toBe('archived');
    expect(adminGoodStatus({ archivedAt: null, stock: 'soldout', stockQty: 10 })).toBe('soldout');
    expect(adminGoodStatus({ archivedAt: null, stock: 'ok', stockQty: 0 })).toBe('soldout');
    expect(adminGoodStatus({ archivedAt: null, stock: 'low', stockQty: 2 })).toBe('low');
    expect(adminGoodStatus({ archivedAt: null, stock: 'ok', stockQty: 2 })).toBe('selling');
  });
});

describe('buildAdminGoodList', () => {
  const base = normalizeAdminGoodListFilters({});

  it('탭 건수는 검색·필터 안에서 세고, 전체 탭은 서버 순서를 지킨다', () => {
    const list = buildAdminGoodList(goods, ips, base);

    expect(list.counts).toEqual({ all: 5, selling: 1, low: 1, soldout: 2, archived: 1 });
    expect(list.rows.map((row) => row.good.id)).toEqual(['g100', 'g101', 'g200', 'g201', 'g900']);
    expect(list.rows[0].ipTitle).toBe('화산강림');
    expect(list.total).toBe(5);
  });

  it('탭은 상태로 좁히되 다른 탭의 건수는 그대로 보여준다', () => {
    const list = buildAdminGoodList(goods, ips, { ...base, tab: 'soldout' });

    expect(list.rows.map((row) => row.good.id)).toEqual(['g200', 'g201']);
    expect(list.counts.low).toBe(1);
    expect(list.total).toBe(2);
  });

  it('검색은 이름·ID·IP 이름을 대소문자 없이 찾고 검색 유형으로 좁힌다', () => {
    expect(buildAdminGoodList(goods, ips, { ...base, query: '리락' }).rows.map((row) => row.good.id))
      .toEqual(['g200', 'g201']);
    expect(buildAdminGoodList(goods, ips, { ...base, query: 'G10', field: 'id' }).rows.map((row) => row.good.id))
      .toEqual(['g100', 'g101']);
    expect(buildAdminGoodList(goods, ips, { ...base, query: '리락', field: 'name' }).rows.map((row) => row.good.id))
      .toEqual(['g200', 'g201']);
    expect(buildAdminGoodList(goods, ips, { ...base, query: '화산', field: 'id' }).rows).toEqual([]);
  });

  it('IP·유형·재고 필터는 AND 로 걸리고 탭 건수도 그 안에서 센다', () => {
    const byIp = buildAdminGoodList(goods, ips, { ...base, ip: 'hwasan' });
    expect(byIp.rows.map((row) => row.good.id)).toEqual(['g100', 'g101']);
    expect(byIp.counts).toEqual({ all: 2, selling: 1, low: 1, soldout: 0, archived: 0 });

    expect(buildAdminGoodList(goods, ips, { ...base, ip: 'hwasan', type: '문구' }).rows.map((row) => row.good.id))
      .toEqual(['g101']);
    expect(buildAdminGoodList(goods, ips, { ...base, stock: 'zero' }).rows.map((row) => row.good.id))
      .toEqual(['g200']);
    expect(buildAdminGoodList(goods, ips, { ...base, stock: 'soldout' }).rows.map((row) => row.good.id))
      .toEqual(['g201']);
  });

  it('정렬은 안정적이고 IP 정렬은 IP 이름을 기준으로 한다', () => {
    expect(buildAdminGoodList(goods, ips, { ...base, sort: 'price', dir: 'desc' }).rows.map((row) => row.good.id))
      .toEqual(['g201', 'g100', 'g200', 'g900', 'g101']);
    expect(buildAdminGoodList(goods, ips, { ...base, sort: 'ip' }).rows.map((row) => row.ipTitle))
      .toEqual(['리락쿠마', '리락쿠마', '지난 IP', '화산강림', '화산강림']);
    /* 같은 가격(g900·g101 이 아닌 동일값)은 서버 순서를 지킨다. */
    const samePrice = [good({ id: 'a', price: 5 }), good({ id: 'b', price: 5 }), good({ id: 'c', price: 1 })];
    expect(buildAdminGoodList(samePrice, ips, { ...base, sort: 'price', dir: 'desc' }).rows.map((row) => row.good.id))
      .toEqual(['a', 'b', 'c']);
  });

  it('페이지는 범위 밖이면 마지막 페이지로 보정하고 전체 건수는 유지한다', () => {
    const many = Array.from({ length: 45 }, (_, index) => good({ id: `g${index}` }));

    const second = buildAdminGoodList(many, ips, { ...base, page: 2 });
    expect(second.rows.map((row) => row.good.id)).toEqual(many.slice(20, 40).map((row) => row.id));
    expect(second).toMatchObject({ page: 2, size: 20, total: 45 });

    const beyond = buildAdminGoodList(many, ips, { ...base, page: 9 });
    expect(beyond.page).toBe(3);
    expect(beyond.rows).toHaveLength(5);

    const empty = buildAdminGoodList([], ips, { ...base, page: 4 });
    expect(empty).toMatchObject({ page: 1, total: 0, rows: [] });
  });
});

describe('IP 목록', () => {
  const verticals = [
    { key: 'webtoon', label: '웹툰' },
    { key: 'character', label: '캐릭터' },
  ];
  const base = normalizeAdminIpListFilters({});

  it('기본값·허용 목록·href 규칙은 굿즈 목록과 같다', () => {
    expect(base).toEqual({
      tab: 'all', vertical: '', query: '', sort: null, dir: 'asc', page: 1, size: 20, selected: null,
    });
    expect(normalizeAdminIpListFilters({ tab: 'hidden', sort: 'price', vertical: ['a', 'b'] }))
      .toMatchObject({ tab: 'all', sort: null, vertical: '' });
    expect(adminIpListHref(base)).toBe('/admin/catalog/ips');
    expect(adminIpListHref(base, { tab: 'archived', vertical: 'webtoon', sort: 'goods', dir: 'desc', selected: 'new' }))
      .toBe('/admin/catalog/ips?tab=archived&vertical=webtoon&sort=goods&dir=desc&selected=new');
  });

  it('굿즈 수(활성/전체)와 버티컬 라벨을 붙이고 탭 건수를 센다', () => {
    const list = buildAdminIpList(ips, goods, verticals, base);

    expect(list.counts).toEqual({ all: 3, active: 2, archived: 1 });
    expect(list.rows.map((row) => [row.ip.id, row.activeGoodsCount, row.goodsCount, row.verticalLabel])).toEqual([
      ['hwasan', 2, 2, '웹툰'],
      ['rilakkuma', 2, 2, '캐릭터'],
      ['old', 0, 1, '웹툰'],
    ]);
  });

  it('버티컬·검색·탭·정렬을 적용한다', () => {
    expect(buildAdminIpList(ips, goods, verticals, { ...base, vertical: 'webtoon' }).rows.map((row) => row.ip.id))
      .toEqual(['hwasan', 'old']);
    expect(buildAdminIpList(ips, goods, verticals, { ...base, query: 'RILA' }).rows.map((row) => row.ip.id))
      .toEqual(['rilakkuma']);
    expect(buildAdminIpList(ips, goods, verticals, { ...base, tab: 'archived' }).rows.map((row) => row.ip.id))
      .toEqual(['old']);
    expect(buildAdminIpList(ips, goods, verticals, { ...base, sort: 'fans', dir: 'desc' }).rows.map((row) => row.ip.id))
      .toEqual(['rilakkuma', 'hwasan', 'old']);
    expect(buildAdminIpList(ips, goods, verticals, { ...base, sort: 'goods', dir: 'desc' }).rows.map((row) => row.ip.id))
      .toEqual(['hwasan', 'rilakkuma', 'old']);
  });
});
