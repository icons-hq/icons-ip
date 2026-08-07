/*
 * 배송비 정책값 (계획 D5).
 *
 * 어드민 토글로 두지 않는다 — 단일 상수로 관리하고 바꿀 때 배포한다.
 * 상품이 늘고 임계를 자주 손대게 되면 그때 어드민으로 승격한다.
 *
 * 도서산간·제주 추가 요금은 보류 상태다(H6). 권역 판정과 요금표가 필요한데
 * SKU 3종에는 과해서, 안내 문구로만 처리한다.
 */

/** 기본 배송비 (KRW) */
export const SHIPPING_FEE = 3000;

/** 이 금액 이상이면 배송비가 붙지 않는다 (KRW) */
export const FREE_SHIPPING_THRESHOLD = 50000;

/**
 * 굿즈 합계에 붙는 배송비.
 * 담긴 굿즈가 없으면 배송 자체가 없으므로 0이다.
 */
export function shippingFeeFor(subtotal: number): number {
  if (subtotal <= 0) return 0;
  return subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;
}
