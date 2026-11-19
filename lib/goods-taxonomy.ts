/* 굿즈 배지의 표준 값 (#326 migration 20260828100000).
 *
 * 배지는 DB CHECK(goods_badge_check)와 같은 목록이어야 한다 — 여기가 어드민 폼 select 옵션의
 * 진실원이고, DB 는 마지막 방어선이다.
 *
 * 상품 유형은 ADR-0044로 폐기됐다. 굿즈의 종류는 대표 카테고리이고, 상품에 유형 칸이 없다.
 *
 * SALE 배지는 여기 없다 — 저장 값이 아니라 compare_at_price > price 에서
 * 파생된다(할인 없는 SALE 배지라는 모순을 스키마가 금지한다).
 */

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
