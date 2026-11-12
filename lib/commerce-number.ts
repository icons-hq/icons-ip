/**
 * 주문·상품주문·배송건 표시 번호. 16·20자리는 Excel 숫자 정밀도(15자리)를 넘으므로 늘 문자열로 다룬다.
 *
 * - 옛 형식(16자리): 주문일(KST) 8 + 종류 1 + 그날 일련번호 7. 배송건번호는 계속 이 형식이다.
 * - 주문 시각 형식(20자리, 시각 전환 뒤 주문): 주문일(KST) 8 + 주문 시각(KST 시·분) 4 + 종류 1 + 그날 일련번호 7.
 *   상품주문번호는 주문번호의 날짜·시각 앞자리를 그대로 쓴다.
 * 두 형식은 길이로 갈리고 종류 자리는 늘 끝에서 8번째다. DB `private.is_commerce_number`와 같은 규칙이다
 * ([번호 런북](docs/runbooks/order-reference-numbers.md)).
 */
export type CommerceNumberKind = 'order' | 'item' | 'shipment';

/** 화면 입력칸이 받아야 하는 가장 긴 번호(주문 시각 형식 주문번호·상품주문번호). */
export const COMMERCE_NUMBER_MAX_LENGTH = 20;

const KST_HOUR_MINUTE = '(?:[01][0-9]|2[0-3])[0-5][0-9]';
const COMMERCE_NUMBER_PATTERNS: Readonly<Record<CommerceNumberKind, RegExp>> = {
  order: new RegExp(`^[0-9]{8}(?:${KST_HOUR_MINUTE})?1[0-9]{7}$`),
  item: new RegExp(`^[0-9]{8}(?:${KST_HOUR_MINUTE})?2[0-9]{7}$`),
  shipment: /^[0-9]{8}3[0-9]{7}$/,
};

/** 종류별 번호 형식. 전역(g) 플래그가 없어 여러 곳에서 같은 객체로 test해도 된다. */
export function commerceNumberPattern(kind: CommerceNumberKind): RegExp {
  return COMMERCE_NUMBER_PATTERNS[kind];
}

export function isCommerceNumber(value: unknown, kind?: CommerceNumberKind): boolean {
  if (typeof value !== 'string') return false;
  if (kind) return COMMERCE_NUMBER_PATTERNS[kind].test(value);
  return COMMERCE_NUMBER_PATTERNS.order.test(value) || COMMERCE_NUMBER_PATTERNS.item.test(value) || COMMERCE_NUMBER_PATTERNS.shipment.test(value);
}

/** Legacy fixtures/old receipts may omit the display number; never derive a new one from a UUID. */
export function commerceReferenceLabel(id: string, number?: string | null): string {
  return typeof number === 'string' && isCommerceNumber(number) ? number : isCommerceNumber(id) ? id : id.replaceAll('-', '').slice(-8).toUpperCase();
}
