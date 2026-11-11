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
  /* MD-0003(R10): 위 분류에 맞지 않는 상품. 20261028131000_goods_type_other.sql에서 CHECK·필터 RPC와 함께 추가했다. */
  '기타',
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

/**
 * 카드에 표기할 배지 목록 — 저장 배지에 할인 파생 SALE 을 더한다.
 *
 * 할인율 표시를 끈 굿즈(#543 `show_discount_rate = false`)는 목록·상세가 취소선과 할인율 없이
 * 할인가만 보인다. 거기에 SALE 배지만 남으면 숨긴 할인을 배지가 다시 광고하는 셈이라 파생하지
 * 않는다(PD-15). 결제 금액·주문 단가와는 무관한 표시 규칙이다.
 */
export function goodDisplayBadges(good: {
  badge: string | null;
  price: number;
  compareAtPrice?: number | null;
  showDiscountRate?: boolean;
}): string[] {
  const badges: string[] = [];
  if (good.badge) badges.push(good.badge);
  if (good.showDiscountRate !== false && typeof good.compareAtPrice === 'number' && good.compareAtPrice > good.price) {
    badges.push('SALE');
  }
  return badges;
}
