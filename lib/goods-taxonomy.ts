/* 굿즈 분류·배지의 표준 값 (#326 migration 20260828100000).
 *
 * DB CHECK(goods_type_check·goods_badge_check)와 같은 목록이어야 한다 — 여기가
 * 어드민 폼 select 옵션과 굿즈샵 필터 축의 진실원이고, DB 는 마지막 방어선이다.
 * 분류 마스터 테이블 없이 값 표준화로 시작한다는 결정(#326 승인 기본값)이라,
 * 카테고리 추가는 이 목록과 CHECK 를 함께 고치는 마이그레이션 작업이다.
 *
 * SALE 배지는 여기 없다 — 저장 값이 아니라 compare_at_price > price 에서
 * 파생된다(할인 없는 SALE 배지라는 모순을 스키마가 금지한다).
 */

export const GOOD_TYPES = [
  '피규어',
  '인형',
  '키링',
  '아크릴',
  '문구',
  '쿠션',
  '파우치',
  '세트',
] as const;

export type GoodType = (typeof GOOD_TYPES)[number];

export function isGoodType(value: unknown): value is GoodType {
  return typeof value === 'string' && (GOOD_TYPES as readonly string[]).includes(value);
}

export const GOOD_BADGES = ['NEW', 'EXCLUSIVE'] as const;

export type GoodBadge = (typeof GOOD_BADGES)[number];

export function isGoodBadge(value: unknown): value is GoodBadge {
  return typeof value === 'string' && (GOOD_BADGES as readonly string[]).includes(value);
}

/** 카드에 표기할 배지 목록 — 저장 배지에 할인 파생 SALE 을 더한다. */
export function goodDisplayBadges(good: {
  badge: string | null;
  price: number;
  compareAtPrice?: number | null;
}): string[] {
  const badges: string[] = [];
  if (good.badge) badges.push(good.badge);
  if (typeof good.compareAtPrice === 'number' && good.compareAtPrice > good.price) {
    badges.push('SALE');
  }
  return badges;
}
