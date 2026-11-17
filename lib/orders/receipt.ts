import type { CheckoutPaymentMethod } from '../checkout';
import type { OrderDetailStatus } from '../orders';

/**
 * 고객 결제 영수증·거래명세서의 순수 계약(MD-0038). 영수증 URL은 저장하지 않는다 — `/orders/[id]/receipt`가
 * 요청 때마다 결제사에 조회해 이동시킨다. 결제사 영수증 규격을 공식 문서로 확인한 provider만 여기에 둔다.
 */
export const ORDER_RECEIPT_PROVIDERS = ['toss'] as const;
export type OrderReceiptProvider = (typeof ORDER_RECEIPT_PROVIDERS)[number];

/** 영수증을 못 불러왔을 때 주문 상세로 돌아오는 질의(`?receipt=unavailable`). */
export const ORDER_RECEIPT_NOTICE_PARAM = 'receipt';
export const ORDER_RECEIPT_NOTICE_UNAVAILABLE = 'unavailable';
/** 주문 상세의 결제 정보 섹션 id(영수증 실패 안내가 이 앵커로 돌아온다). */
export const ORDER_RECEIPT_SECTION_ID = 'order-payment';

/** 영수증을 발급할 수 있는 결제 상태. 결제 뒤 취소·환불된 결제도 매출전표는 남는다. */
const RECEIPT_PAYMENT_STATUSES: ReadonlySet<string> = new Set(['paid', 'canceled', 'refunded']);
/** 거래명세서를 발급하는 주문 상태(결제가 끝났고 취소되지 않은 주문). */
const STATEMENT_ORDER_STATUSES: ReadonlySet<OrderDetailStatus> = new Set<OrderDetailStatus>([
  'paid',
  'confirmed',
  'shipping',
  'delivered',
  'done',
]);

export function orderReceiptHref(orderId: string): string {
  return `/orders/${orderId}/receipt`;
}

export function orderStatementHref(orderId: string): string {
  return `/orders/${orderId}/statement`;
}

function isReceiptProvider(provider: string | null | undefined): provider is OrderReceiptProvider {
  return (ORDER_RECEIPT_PROVIDERS as readonly string[]).includes(provider ?? '');
}

/**
 * 결제 영수증 버튼을 그릴 수 있는 주문인가. 카드 결제 + 영수증을 지원하는 provider + 결제가 성립한 상태일 때만이다.
 * 무통장 입금·결제 전 주문은 버튼 없이 거래명세서로 안내한다.
 */
export function orderReceiptAvailable(input: {
  paymentMethod: CheckoutPaymentMethod;
  payment: { provider?: string | null; status: string } | null;
}): boolean {
  if (input.paymentMethod !== 'card' || !input.payment) return false;
  return isReceiptProvider(input.payment.provider) && RECEIPT_PAYMENT_STATUSES.has(input.payment.status);
}

export function orderStatementAvailable(status: OrderDetailStatus): boolean {
  return STATEMENT_ORDER_STATUSES.has(status);
}

const TOSS_RECEIPT_HOST = 'tosspayments.com';
const TOSS_RECEIPT_URL_MAX_LENGTH = 2048;
/** 공백·제어문자·역슬래시가 섞이면 URL 파서마다 호스트를 다르게 읽을 수 있어 처음부터 거절한다. */
const UNSAFE_URL_CHARACTERS = /[\u0000- \u007f\\]/;

/**
 * 토스 `receipt.url`을 303 이동 대상으로 써도 되는가. https이고 호스트가 `tosspayments.com` 또는 그 하위 도메인이며,
 * 계정 정보·비표준 포트가 없고 2048자 이하일 때만 참이다(열린 리디렉션 방지).
 */
export function isAllowedTossReceiptUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > TOSS_RECEIPT_URL_MAX_LENGTH) return false;
  if (UNSAFE_URL_CHARACTERS.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return false;
  return url.hostname === TOSS_RECEIPT_HOST || url.hostname.endsWith(`.${TOSS_RECEIPT_HOST}`);
}
