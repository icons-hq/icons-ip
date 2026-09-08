import { krw } from './format';

export type ShippingPolicy = Readonly<{ baseFee: number; freeThreshold: number }>;

/* #438: 표시용 정책 조회는 이 함수로 모은다. #422에서 출고지 설정으로
   조회 소스를 교체한다. 실제 청구액은 SQL 정책 조회로 다시 계산하고
   orders.shipping_fee에 고정하므로 과거 주문은 정책 변경의 영향을 받지 않는다. */
export function getShippingPolicy(): ShippingPolicy {
  return { baseFee: 3000, freeThreshold: 50000 };
}

/** 굿즈 소계로 배송비를 정한다. 빈 장바구니(소계 0)는 청구 대상이 아니다. */
export function shippingFeeFor(subtotal: number): number {
  if (subtotal <= 0) return 0;
  const policy = getShippingPolicy();
  return subtotal >= policy.freeThreshold ? 0 : policy.baseFee;
}

/** 무료배송까지 남은 금액. 이미 도달했으면 0이다. */
export function freeShippingRemainder(subtotal: number): number {
  return Math.max(0, getShippingPolicy().freeThreshold - Math.max(0, subtotal));
}

/** 영수증의 배송비 줄 표기. 장바구니·체크아웃·주문상세가 같은 문구를 쓴다. */
export function shippingFeeLabel(shippingFee: number): string {
  return shippingFee <= 0 ? '무료' : krw(shippingFee);
}
