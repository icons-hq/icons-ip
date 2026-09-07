import { krw } from './format';

/* 배송비의 **진실원은 이제 DB 의 `shipping_policies` 다**(현업 슬라이스 2).
   주문 청구는 `shipping_fee_for_lines` 가 정책에서 계산하고, 여기 값은 정책이
   기본값일 때와 같은 숫자를 가진 **표시용 근사치**로만 남는다.

   정책이 여럿인 장바구니(묶음배송 꺼진 상품·도서산간)에서는 이 근사치가 실제와
   다를 수 있다 — 화면 견적을 서버 함수로 받아오는 것이 다음 조각이다.

   과거 주문의 영수증은 orders.shipping_fee 스냅샷을 쓰므로 정책이 바뀌어도 변하지 않는다. */

/** 기본 배송비. 도서산간 추가요금은 보류다(H6). */
export const SHIPPING_FEE = 3000;

/** 이 금액 **이상**이면 배송비를 받지 않는다. */
export const FREE_SHIPPING_THRESHOLD = 50000;

/** 굿즈 소계로 배송비를 정한다. 빈 장바구니(소계 0)는 청구 대상이 아니다. */
export function shippingFeeFor(subtotal: number): number {
  if (subtotal <= 0) return 0;
  return subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;
}

/** 무료배송까지 남은 금액. 이미 도달했으면 0이다. */
export function freeShippingRemainder(subtotal: number): number {
  return Math.max(0, FREE_SHIPPING_THRESHOLD - Math.max(0, subtotal));
}

/** 영수증의 배송비 줄 표기. 장바구니·체크아웃·주문상세가 같은 문구를 쓴다. */
export function shippingFeeLabel(shippingFee: number): string {
  return shippingFee <= 0 ? '무료' : krw(shippingFee);
}
