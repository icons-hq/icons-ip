export interface CheckoutAddress {
  recipientName: string;
  phone: string;
  postalCode: string;
  address1: string;
  address2?: string;
  deliveryNote?: string;
}

export type CheckoutAddressField = keyof CheckoutAddress;
export type CheckoutAddressErrors = Partial<Record<CheckoutAddressField, string>>;

export type PlaceOrderErrorCode =
  | 'account_suspended'
  | 'empty_cart'
  | 'out_of_stock'
  | 'invalid_address'
  | 'bank_transfer_blocked'
  | 'coupon_rejected'
  | 'unavailable';

/** 주문서에서 고르는 결제수단. DB `public.order_payment_method`와 같은 값. */
export type CheckoutPaymentMethod = 'card' | 'bank_transfer';

export function normalizeCheckoutPaymentMethod(value: unknown): CheckoutPaymentMethod | null {
  return value === 'card' || value === 'bank_transfer' ? value : null;
}

export type CheckoutOrderState = 'payable' | 'checking' | 'complete' | 'closed';

const ADDRESS_KEYS = new Set([
  'recipientName',
  'phone',
  'postalCode',
  'address1',
  'address2',
  'deliveryNote',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, maxLength: number, required: boolean) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if ((required && !normalized) || normalized.length > maxLength) return null;
  return normalized;
}

export function normalizeCheckoutAddress(value: unknown): CheckoutAddress | null {
  if (!isRecord(value) || Object.keys(value).some((key) => !ADDRESS_KEYS.has(key))) return null;

  const recipientName = boundedString(value.recipientName, 50, true);
  const postalCode = boundedString(value.postalCode, 5, true);
  const address1 = boundedString(value.address1, 200, true);
  const address2 = value.address2 === undefined
    ? undefined
    : boundedString(value.address2, 200, false);
  const deliveryNote = value.deliveryNote === undefined
    ? undefined
    : boundedString(value.deliveryNote, 200, false);

  if (
    !recipientName
    || !postalCode
    || !/^\d{5}$/.test(postalCode)
    || !address1
    || address2 === null
    || deliveryNote === null
    || typeof value.phone !== 'string'
    || !/^[0-9\s()+-]+$/.test(value.phone)
  ) return null;

  const phone = value.phone.replace(/\D/g, '');
  if (phone.length < 8 || phone.length > 15) return null;

  return {
    recipientName,
    phone,
    postalCode,
    address1,
    ...(address2 === undefined ? {} : { address2 }),
    ...(deliveryNote === undefined ? {} : { deliveryNote }),
  };
}

export function checkoutAddressErrors(value: CheckoutAddress): CheckoutAddressErrors {
  const errors: CheckoutAddressErrors = {};
  const recipientName = value.recipientName.trim();
  const phone = value.phone.replace(/\D/g, '');
  const postalCode = value.postalCode.trim();
  const address1 = value.address1.trim();
  const address2 = value.address2?.trim() ?? '';
  const deliveryNote = value.deliveryNote?.trim() ?? '';

  if (!recipientName || recipientName.length > 50) {
    errors.recipientName = recipientName.length > 50
      ? '받는 분은 50자 이하로 입력해주세요.'
      : '받는 분을 입력해주세요.';
  }
  if (!/^[0-9\s()+-]+$/.test(value.phone) || phone.length < 8 || phone.length > 15) {
    errors.phone = '연락처는 숫자 8~15자리로 입력해주세요.';
  }
  if (!/^\d{5}$/.test(postalCode)) {
    errors.postalCode = '우편번호 5자리를 입력해주세요.';
  }
  if (!address1 || address1.length > 200) {
    errors.address1 = address1.length > 200
      ? '기본 주소는 200자 이하로 입력해주세요.'
      : '기본 주소를 입력해주세요.';
  }
  if (address2.length > 200) {
    errors.address2 = '상세 주소는 200자 이하로 입력해주세요.';
  }
  if (deliveryNote.length > 200) {
    errors.deliveryNote = '배송 메모는 200자 이하로 입력해주세요.';
  }

  return errors;
}

function normalizeUuid(value: unknown) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return UUID_PATTERN.test(normalized) ? normalized.toLowerCase() : null;
}

export const normalizeCheckoutKey = normalizeUuid;
export const normalizeOrderReference = normalizeUuid;

export function checkoutOrderName(itemNames: readonly string[]) {
  const firstName = itemNames[0]?.trim() || 'ICONS 굿즈';
  const suffix = itemNames.length > 1 ? ` 외 ${itemNames.length - 1}건` : '';
  const maxFirstLength = Math.max(1, 100 - suffix.length);
  return `${firstName.slice(0, maxFirstLength)}${suffix}`;
}

export function mapPlaceOrderError(message: unknown): PlaceOrderErrorCode {
  const normalized = typeof message === 'string' ? message.toLowerCase() : '';
  if (normalized.includes('account_suspended')) return 'account_suspended';
  if (normalized.includes('cart empty')) return 'empty_cart';
  if (normalized.includes('out of stock')) return 'out_of_stock';
  if (normalized.includes('invalid checkout address')) return 'invalid_address';
  if (normalized.includes('bank transfer blocked')) return 'bank_transfer_blocked';
  /* 적용해 둔 쿠폰이 주문 확정 시점 재검증에서 거부된 경우(만료·조건 미달 등).
     세부 사유는 카트가 안내한다 — 주문서는 카트로 돌아가라고만 말한다. */
  if (normalized.includes('coupon_')) return 'coupon_rejected';
  return 'unavailable';
}

export function checkoutOrderState(
  orderStatus: string,
  paymentStatus: string | null,
  expiresAt: string | null,
  now: number = Date.now(),
): CheckoutOrderState {
  // 결제가 끝난 뒤의 모든 사다리 단계는 "결제 완료"다(#250). 새 단계가 빠지면
  // 발주확인된 주문의 결제 화면이 만료된 주문처럼 닫혀 보인다.
  if (orderStatus !== 'pending' && orderStatus !== 'canceled') {
    return 'complete';
  }
  if (orderStatus !== 'pending') return 'closed';
  if (paymentStatus === 'pending' || paymentStatus === 'paid') return 'checking';
  if (!expiresAt || Date.parse(expiresAt) <= now) return 'closed';
  return 'payable';
}
