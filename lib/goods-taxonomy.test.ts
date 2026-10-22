import { describe, expect, it } from 'vitest';
import { goodDisplayBadges } from './goods-taxonomy';

describe('goodDisplayBadges', () => {
  it('저장 배지에 할인 파생 SALE 을 더한다', () => {
    expect(goodDisplayBadges({ badge: 'NEW', price: 12000, compareAtPrice: 18000 })).toEqual(['NEW', 'SALE']);
    expect(goodDisplayBadges({ badge: null, price: 12000, compareAtPrice: 18000, showDiscountRate: true })).toEqual(['SALE']);
  });

  it('정가가 판매가보다 높지 않으면 SALE 이 아니다', () => {
    expect(goodDisplayBadges({ badge: null, price: 12000, compareAtPrice: 12000 })).toEqual([]);
    expect(goodDisplayBadges({ badge: null, price: 12000, compareAtPrice: null })).toEqual([]);
    expect(goodDisplayBadges({ badge: 'EXCLUSIVE', price: 12000 })).toEqual(['EXCLUSIVE']);
  });

  /* PD-15 — 할인율 표시를 끈 굿즈(#543)는 목록·상세가 할인가만 보인다. 배지만 할인을 광고하면 안 된다. */
  it('할인율 표시를 끈 굿즈에는 SALE 을 파생하지 않는다', () => {
    expect(goodDisplayBadges({ badge: 'NEW', price: 12000, compareAtPrice: 18000, showDiscountRate: false })).toEqual(['NEW']);
  });
});
