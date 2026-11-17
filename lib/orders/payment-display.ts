import type { CheckoutPaymentMethod } from '../checkout';

/**
 * 고객 주문 상세의 결제수단 표시(MD-0037). `get_my_order_payment_display` RPC가 private 근거 테이블에서 꺼낸
 * 표시용 문자열만 담는다. 결제 키·결과 코드·거래 id는 여기에 없다.
 */
export interface OrderPaymentDisplay {
  provider: string;
  /** 결제사가 보고한 결제 방식(토스 '카드'·'간편결제'…, 나이스페이·코페이 'CARD'). 근거가 없으면 null. */
  method: string | null;
  /** 카드번호 마스킹·간편결제사 같은 보조 표기. 근거가 없으면 null. */
  detail: string | null;
  approvedAt: string | null;
}

const DISPLAY_KEYS = ['provider', 'method', 'detail', 'approvedAt'] as const;
const PROVIDER_MAX_LENGTH = 32;
const METHOD_MAX_LENGTH = 50;
const DETAIL_MAX_LENGTH = 100;
/** Postgres jsonb가 내보내는 timestamptz(`2026-11-17T05:00:00.123456+00:00`)와 `Z` 표기를 받는다. */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

function plainRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? (value as Record<string, unknown>) : null;
}

function boundedText(value: unknown, maxLength: number): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || text !== value || text.length > maxLength) return undefined;
  return text;
}

/**
 * RPC 결과를 엄격히 읽는다. 키가 정확히 4개가 아니거나 문자열 길이·형식이 어긋나면 null이다 —
 * 화면은 그때 대체 라벨('카드·간편결제')로 그린다.
 */
export function parseOrderPaymentDisplay(value: unknown): OrderPaymentDisplay | null {
  const record = plainRecord(value);
  if (!record) return null;
  const keys = Object.keys(record);
  if (keys.length !== DISPLAY_KEYS.length || !DISPLAY_KEYS.every((key) => keys.includes(key))) return null;

  const provider = boundedText(record.provider, PROVIDER_MAX_LENGTH);
  const method = boundedText(record.method, METHOD_MAX_LENGTH);
  const detail = boundedText(record.detail, DETAIL_MAX_LENGTH);
  if (!provider || method === undefined || detail === undefined) return null;

  const approvedAt = record.approvedAt;
  if (approvedAt !== null) {
    if (typeof approvedAt !== 'string' || !ISO_TIMESTAMP.test(approvedAt) || Number.isNaN(Date.parse(approvedAt))) return null;
  }
  return { provider, method, detail, approvedAt };
}

const UNKNOWN_METHOD_LABEL = '카드·간편결제';

/** 괄호 보조 표기. 방식과 같은 글자(토스가 카드번호·간편결제사 없이 방식만 알려 준 경우)는 중복이라 뺀다. */
function withDetail(label: string, method: string | null, detail: string | null): string {
  if (!detail || detail.toLowerCase() === method?.toLowerCase()) return label;
  return `${label} (${detail})`;
}

/**
 * 고객 화면의 결제수단 라벨.
 * 무통장 입금 → '무통장 입금' / 근거 없음 → '카드·간편결제' / 카드(`카드`·`CARD`) → '신용·체크카드 (마스킹)' /
 * 간편결제 → '간편결제 (결제사)' / 그 밖 방식(계좌이체·휴대폰·가상계좌)은 결제사가 준 이름 그대로.
 */
export function orderPaymentMethodLabel(paymentMethod: CheckoutPaymentMethod, display: OrderPaymentDisplay | null): string {
  if (paymentMethod === 'bank_transfer') return '무통장 입금';
  if (!display) return UNKNOWN_METHOD_LABEL;
  const { method, detail } = display;
  if (method === null) return withDetail(UNKNOWN_METHOD_LABEL, null, detail);
  if (method === '카드' || method === 'CARD') return withDetail('신용·체크카드', method, detail);
  if (method === '간편결제') return withDetail('간편결제', method, detail);
  return method;
}
