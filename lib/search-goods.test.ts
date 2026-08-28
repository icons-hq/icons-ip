import { describe, expect, it } from 'vitest';
import type { Good, Ip, Vertical } from '@/lib/data';
import { SEARCH_GOODS_PAGE_SIZE, searchGoods } from './search-goods';

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
