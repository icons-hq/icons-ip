/**
 * 운송장(택배사 + 송장번호) 표시와 검증의 단일 진실원.
 *
 * 택배사를 늘리려면 SHIPPING_CARRIERS에 항목 하나만 추가하면 된다. DB는 코드
 * 형식(`^[a-z0-9_]{2,32}$`)만 강제하므로 마이그레이션 없이 확장된다.
 *
 * 현재 ICONS의 실제 계약 택배사는 한진택배 하나뿐이라 목록도 하나다(계획 §5.1).
 * 계약하지 않은 택배사를 미리 넣으면 운영자가 잘못 고를 수 있어 넣지 않는다.
 * 배송조회 URL은 물류 사양 확인(#177) 때 실제 계약 기준으로 재확인해야 한다.
 */
export interface ShippingCarrier {
  code: string;
  label: string;
  trackingUrl: (trackingNumber: string) => string;
}

export const SHIPPING_CARRIERS: readonly ShippingCarrier[] = [
  {
    code: 'hanjin',
    label: '한진택배',
    trackingUrl: (trackingNumber) => (
      'https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do'
      + `?mCode=MN038&schLang=KR&wblnumText2=${encodeURIComponent(trackingNumber)}`
    ),
  },
];

/** DB의 orders.tracking_number check와 같은 형식이다. 양쪽을 함께 바꾼다. */
const TRACKING_NUMBER_PATTERN = /^[A-Z0-9]{8,30}$/;

export interface OrderShipment {
  carrier: string;
  carrierLabel: string;
  trackingNumber: string;
  trackingUrl: string;
}

function findCarrier(code: string) {
  return SHIPPING_CARRIERS.find((carrier) => carrier.code === code) ?? null;
}

export function isShippingCarrierCode(value: string): boolean {
  return findCarrier(value) !== null;
}

export function shippingCarrierLabel(code: string): string | null {
  return findCarrier(code)?.label ?? null;
}

/** 운영자가 하이픈·공백을 섞어 붙여넣어도 저장 형태를 하나로 고정한다. */
export function normalizeTrackingNumber(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

export function isTrackingNumber(value: string): boolean {
  return TRACKING_NUMBER_PATTERN.test(value);
}

export function orderShipment(
  carrier: string | null,
  trackingNumber: string | null,
): OrderShipment | null {
  if (!carrier || !trackingNumber) return null;

  const found = findCarrier(carrier);
  if (!found) return null;

  const normalized = normalizeTrackingNumber(trackingNumber);
  if (!isTrackingNumber(normalized)) return null;

  return {
    carrier: found.code,
    carrierLabel: found.label,
    trackingNumber: normalized,
    trackingUrl: found.trackingUrl(normalized),
  };
}
