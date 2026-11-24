import { describe, expect, it } from 'vitest';
import { formatGoodBadgeText, goodBadgeList, goodDisplayBadges, parseGoodBadgeText } from './goods-taxonomy';

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

/* 상품 표시문구 여러 개(migration 20261125140000). 고른 순서가 노출 순서이고 같은 값은 한 번만이다. */
describe('goodBadgeList', () => {
  it('badges를 고른 순서대로 읽고, 같은 값·빈 값은 뺀다', () => {
    expect(goodBadgeList({ badge: 'EXCLUSIVE', badges: ['EXCLUSIVE', 'NEW'] })).toEqual(['EXCLUSIVE', 'NEW']);
    expect(goodBadgeList({ badges: [' NEW ', 'new', '', 'EXCLUSIVE'] })).toEqual(['NEW', 'EXCLUSIVE']);
  });

  it('badges를 싣지 않은 옛 투영은 첫 값 badge 하나로 읽고, 빈 badges는 표시문구 없음이다', () => {
    expect(goodBadgeList({ badge: 'NEW' })).toEqual(['NEW']);
    expect(goodBadgeList({ badge: null })).toEqual([]);
    expect(goodBadgeList({ badge: 'NEW', badges: [] })).toEqual([]);
  });
});

describe('parseGoodBadgeText · formatGoodBadgeText', () => {
  it('쉼표·줄바꿈으로 나눠 적은 순서를 지키고, 대문자 표기로 맞추며, 같은 값은 한 번만 남긴다', () => {
    expect(parseGoodBadgeText('exclusive, NEW,\nNEW')).toEqual({ badges: ['EXCLUSIVE', 'NEW'], invalid: [] });
    expect(parseGoodBadgeText('NEW')).toEqual({ badges: ['NEW'], invalid: [] });
    expect(parseGoodBadgeText('  ')).toEqual({ badges: [], invalid: [] });
  });

  it('표준 값이 아닌 글자는 invalid로 돌려준다', () => {
    expect(parseGoodBadgeText('NEW, 신상, SALE')).toEqual({ badges: ['NEW'], invalid: ['신상', 'SALE'] });
  });

  it('목록을 한 칸 글자로 쓰고, 그 글자를 다시 읽으면 같은 목록이다', () => {
    expect(formatGoodBadgeText(['EXCLUSIVE', 'NEW'])).toBe('EXCLUSIVE, NEW');
    expect(parseGoodBadgeText(formatGoodBadgeText(['EXCLUSIVE', 'NEW'])).badges).toEqual(['EXCLUSIVE', 'NEW']);
    expect(formatGoodBadgeText([])).toBe('');
  });
});

describe('goodDisplayBadges · 여러 표시문구', () => {
  it('저장 표시문구를 고른 순서대로 앞에 두고 SALE은 맨 뒤 한 번만이다', () => {
    expect(goodDisplayBadges({ badge: 'EXCLUSIVE', badges: ['EXCLUSIVE', 'NEW'], price: 12000, compareAtPrice: 18000 }))
      .toEqual(['EXCLUSIVE', 'NEW', 'SALE']);
    expect(goodDisplayBadges({ badge: 'NEW', badges: ['NEW', 'NEW'], price: 12000 })).toEqual(['NEW']);
  });
});
