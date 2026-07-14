import { describe, expect, it } from 'vitest';
import type { Good, Stock } from './data';
import { ALL_IPS, selectShopGoods } from './shop-catalog';

function good(id: string, ipId: string, overrides: Partial<Good> = {}): Good {
  return {
    id,
    ip: ipId,
    name: `Good ${id}`,
    type: '키링',
    price: 10000,
    badge: null,
    stock: 'ok' as Stock,
    stockQty: 10,
    img: `good-${id}`,
    ...overrides,
  };
}

describe('selectShopGoods', () => {
  const goods = [
    good('a', 'ip1', { price: 30000 }),
    good('b', 'ip1', { price: 10000 }),
    good('c', 'ip2', { price: 20000 }),
  ];

  it('IP로 필터링하고 전체 IP는 모두 노출한다', () => {
    expect(selectShopGoods(goods, { ipId: 'ip1', sort: '인기순' }).map((g) => g.id)).toEqual(['a', 'b']);
    expect(selectShopGoods(goods, { ipId: ALL_IPS, sort: '인기순' }).map((g) => g.id)).toEqual(['a', 'b', 'c']);
  });

  it('가격순으로 오름/내림차순 정렬한다', () => {
    expect(selectShopGoods(goods, { ipId: ALL_IPS, sort: '낮은 가격' }).map((g) => g.id)).toEqual(['b', 'c', 'a']);
    expect(selectShopGoods(goods, { ipId: ALL_IPS, sort: '높은 가격' }).map((g) => g.id)).toEqual(['a', 'c', 'b']);
  });

  it('신상품은 신상 badge를 앞으로 두고 나머지 순서를 유지한다', () => {
    const withBadges = [
      good('a', 'ip1'),
      good('b', 'ip1', { badge: '신상' }),
      good('c', 'ip1', { badge: '한정' }),
    ];
    expect(selectShopGoods(withBadges, { ipId: ALL_IPS, sort: '신상품' }).map((g) => g.id)).toEqual(['b', 'a', 'c']);
  });

  it('인기순은 원본 순서를 유지하고 입력 배열을 변형하지 않는다', () => {
    const input = [...goods];
    expect(selectShopGoods(input, { ipId: ALL_IPS, sort: '인기순' }).map((g) => g.id)).toEqual(['a', 'b', 'c']);
    selectShopGoods(input, { ipId: ALL_IPS, sort: '낮은 가격' });
    expect(input.map((g) => g.id)).toEqual(['a', 'b', 'c']);
  });
});
