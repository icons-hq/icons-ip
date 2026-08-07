import { krw } from './format';

/* 배송비 정책의 단일 진실원(#174 · 결정 D5). 어드민 토글은 두지 않는다 —
   값이 바뀌면 이 파일을 고치고 배포한다.

   주의: 여기 값은 "지금 담으면 얼마인가"를 보여주는 표시용 파생일 뿐이다.
   실제 청구액은 place_order RPC가 같은 정책으로 다시 계산해
   orders.shipping_fee에 스냅샷으로 남긴다. 과거 주문의 영수증은
   이 상수가 바뀌어도 변하지 않는다. */

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
