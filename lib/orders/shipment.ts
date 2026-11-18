/**
 * 운송장(택배사 + 운송장번호) 표시와 검증.
 *
 * 택배사 목록의 진실원은 이 파일이 아니라 DB의 `public.shipping_carriers`
 * 레지스트리다(#251). 여기 있는 것은 그 레지스트리를 받아 판정하는 순수 함수뿐이고,
 * 상수 목록은 남기지 않는다 — 앱에 목록을 하나 더 두면 "택배사 추가는 등록만으로"가
 * 곧바로 거짓이 되고, 두 목록이 갈라지는 순간 저장은 되는데 조회는 안 되는 운송장이
 * 생긴다.
 *
 * 레지스트리를 읽는 쪽은 `lib/orders/shipment.server.ts`다.
 */

export interface ShippingCarrier {
  code: string;
  label: string;
  /** 지금 새로 고를 수 있는 택배사인지. 비활성 택배사도 기존 주문에서는 조회된다. */
  active: boolean;
  /** `{trackingNumber}` 자리에 운송장번호가 들어가는 조회 URL. */
  trackingUrlTemplate: string;
  /**
   * 택배사별 운송장번호 형식(정규식, 하이픈·공백을 뺀 대문자 번호에 전체 일치). 없으면 공통 형식만 본다.
   * DB 등록 판정(`private.tracking_number_format_ok`)과 같은 값이다 — 앱 검사는 줄별 안내용이고 최종 판정은 DB다.
   */
  trackingNumberPattern?: string | null;
  /** 사람이 읽는 형식 규칙(예: `숫자 13자리`). 형식 정규식과 함께 있다. */
  trackingNumberRule?: string | null;
}

export type ShippingCarrierRegistry = readonly ShippingCarrier[];

export const TRACKING_NUMBER_PLACEHOLDER = '{trackingNumber}';

/** DB의 order_shipments.tracking_number check와 같은 형식이다. 양쪽을 함께 바꾼다. */
const TRACKING_NUMBER_PATTERN = /^[A-Z0-9]{8,30}$/;

/** DB의 shipping_carriers_code_check와 같은 형식이다. */
const CARRIER_CODE_PATTERN = /^[a-z0-9_]{2,32}$/;

export interface OrderShipment {
  carrier: string;
  carrierLabel: string;
  trackingNumber: string;
  trackingUrl: string;
}

export function findShippingCarrier(
  registry: ShippingCarrierRegistry,
  code: string,
): ShippingCarrier | null {
  return registry.find((carrier) => carrier.code === code) ?? null;
}

/**
 * 조회 URL.
 *
 * 운송장번호는 `^[A-Z0-9]{8,30}$`라 퍼센트 인코딩이 필요 없다. 그래도
 * `encodeURIComponent`를 거치는 이유는 이 함수가 검증을 통과하지 않은 값으로도
 * 불릴 수 있어서다 — 인코딩이 없으면 레지스트리 템플릿이 그대로 열린 주입점이 된다.
 */
export function shippingCarrierTrackingUrl(
  carrier: ShippingCarrier,
  trackingNumber: string,
): string {
  return carrier.trackingUrlTemplate.replaceAll(
    TRACKING_NUMBER_PLACEHOLDER,
    encodeURIComponent(trackingNumber),
  );
}

/** 레지스트리에 등록된 코드인지. 비활성 택배사도 등록은 등록이다. */
export function isShippingCarrierCode(
  registry: ShippingCarrierRegistry,
  value: string,
): boolean {
  return findShippingCarrier(registry, value) !== null;
}

/** 지금 새 운송장에 붙일 수 있는 택배사인지. 드롭다운·일괄 등록 검증이 쓴다. */
export function isSelectableShippingCarrier(
  registry: ShippingCarrierRegistry,
  value: string,
): boolean {
  return findShippingCarrier(registry, value)?.active === true;
}

/** 드롭다운에 그릴 택배사. 비활성은 새로 고를 수 없으므로 뺀다. */
export function selectableShippingCarriers(
  registry: ShippingCarrierRegistry,
): ShippingCarrier[] {
  return registry.filter((carrier) => carrier.active);
}

export function shippingCarrierLabel(
  registry: ShippingCarrierRegistry,
  code: string,
): string | null {
  return findShippingCarrier(registry, code)?.label ?? null;
}

/** 레지스트리에 넣을 수 있는 코드 형식인지. DB CHECK와 같은 규칙이다. */
export function isShippingCarrierCodeFormat(value: string): boolean {
  return CARRIER_CODE_PATTERN.test(value);
}

/** 운영자가 하이픈·공백을 섞어 붙여넣어도 저장 형태를 하나로 고정한다. */
export function normalizeTrackingNumber(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

export function isTrackingNumber(value: string): boolean {
  return TRACKING_NUMBER_PATTERN.test(value);
}

/** 레지스트리 정규식을 읽는다. JS가 읽지 못하는 식이면 앱 검사를 건너뛴다(DB가 최종 판정한다). */
function carrierPattern(carrier: Pick<ShippingCarrier, 'trackingNumberPattern'>): RegExp | null {
  if (!carrier.trackingNumberPattern) return null;
  try { return new RegExp(carrier.trackingNumberPattern); } catch { return null; }
}

/**
 * 정규화한 운송장번호가 그 택배사의 형식에 맞지 않으면 안내 문구, 맞으면 null.
 * 공통 형식(8~30자 영숫자)은 `isTrackingNumber`가 먼저 본다.
 */
export function carrierTrackingNumberIssue(
  carrier: Pick<ShippingCarrier, 'label' | 'trackingNumberPattern' | 'trackingNumberRule'>,
  trackingNumber: string,
): string | null {
  const pattern = carrierPattern(carrier);
  if (!pattern || pattern.test(trackingNumber)) return null;
  return `${carrier.label} 운송장번호는 ${carrier.trackingNumberRule ?? '정해진 형식'}입니다. 숫자가 빠지거나 더해지지 않았는지 확인해주세요.`;
}

/** 형식 규칙이 있는 사용 중 택배사의 규칙 안내(예: `한진택배 숫자 10~14자리 · 우체국택배 숫자 13자리`). 없으면 빈 문자열. */
export function trackingFormatRulesNote(registry: ShippingCarrierRegistry): string {
  return registry.filter(carrier => carrier.active && carrier.trackingNumberPattern && carrier.trackingNumberRule)
    .map(carrier => `${carrier.label} ${carrier.trackingNumberRule}`).join(' · ');
}

/**
 * 배송 건의 택배사·운송장을 화면이 쓸 수 있는 모양으로 바꾼다.
 *
 * 활성 여부는 보지 않는다. 계약이 끝난 택배사로 이미 나간 주문도 고객은 계속
 * 추적할 수 있어야 한다 — 비활성화가 과거 배송의 조회 링크를 지우면 CS가
 * 그만큼 수동이 된다.
 */
export function orderShipment(
  registry: ShippingCarrierRegistry,
  carrier: string | null,
  trackingNumber: string | null,
): OrderShipment | null {
  if (!carrier || !trackingNumber) return null;

  const found = findShippingCarrier(registry, carrier);
  if (!found) return null;

  const normalized = normalizeTrackingNumber(trackingNumber);
  if (!isTrackingNumber(normalized)) return null;

  return {
    carrier: found.code,
    carrierLabel: found.label,
    trackingNumber: normalized,
    trackingUrl: shippingCarrierTrackingUrl(found, normalized),
  };
}
