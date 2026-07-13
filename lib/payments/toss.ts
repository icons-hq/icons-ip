/* 토스페이먼츠 연동 순수 계약 — IO 없는 인코딩·판정 로직(#88).
 * 승인·조회·취소 API 호출은 ./toss-api.ts, 라우트 배선은 app/api/*. */

/** v1 결제 목적 — wallet(충전)은 ADR-0003으로 폐기돼 발급하지 않는다. */
export type TossPaymentPurpose = 'order' | 'ticket';

export interface TossOrderRef {
  purpose: TossPaymentPurpose;
  refId: string;
}

const ORDER_ID_PATTERN = /^(order|ticket)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** 토스 orderId(6~64자, 영숫자·-·_) 안에 결제 목적과 내부 uuid를 함께 싣는다. */
export function buildTossOrderId(purpose: TossPaymentPurpose, refId: string): string {
  return `${purpose}_${refId}`;
}

/** 웹훅·콜백의 orderId → 내부 참조. 우리 발급 형식이 아니면 null. */
export function parseTossOrderId(orderId: unknown): TossOrderRef | null {
  if (typeof orderId !== 'string') return null;
  const match = ORDER_ID_PATTERN.exec(orderId);
  if (!match) return null;
  return { purpose: match[1] as TossPaymentPurpose, refId: match[2] };
}

/** 토스 API 인증 헤더 — base64(secretKey + ':') Basic 스킴. */
export function tossBasicAuthHeader(secretKey: string): string {
  return `Basic ${Buffer.from(`${secretKey}:`).toString('base64')}`;
}

/** 토스 Payment.status — 이 목록 밖의 값은 확정하지 않는다(스펙 변화 방어). */
export const TOSS_PAYMENT_STATUSES = [
  'READY',
  'IN_PROGRESS',
  'WAITING_FOR_DEPOSIT',
  'DONE',
  'CANCELED',
  'PARTIAL_CANCELED',
  'ABORTED',
  'EXPIRED',
] as const;
export type TossPaymentStatus = (typeof TOSS_PAYMENT_STATUSES)[number];

export interface NormalizedTossPayment {
  paymentKey: string;
  orderId: string;
  status: TossPaymentStatus;
  totalAmount: number;
}

export type WebhookEvent =
  | { kind: 'payment_status_changed'; paymentKey: string }
  | { kind: 'other'; eventType: string }
  | { kind: 'invalid' };

/** 웹훅 본문 방어적 파싱 — payload는 신뢰하지 않고 paymentKey만 꺼내 재조회에 쓴다. */
export function parseWebhookEvent(body: unknown): WebhookEvent {
  if (typeof body !== 'object' || body === null) return { kind: 'invalid' };
  const { eventType, data } = body as { eventType?: unknown; data?: unknown };
  if (typeof eventType !== 'string' || !eventType) return { kind: 'invalid' };
  if (eventType !== 'PAYMENT_STATUS_CHANGED') return { kind: 'other', eventType };

  const paymentKey =
    typeof data === 'object' && data !== null ? (data as { paymentKey?: unknown }).paymentKey : undefined;
  if (typeof paymentKey !== 'string' || !paymentKey) return { kind: 'invalid' };
  return { kind: 'payment_status_changed', paymentKey };
}

/** 조회 API 응답 → 확정에 필요한 필드. 형식이 어긋나면 null(확정 금지). */
export function normalizeTossPayment(data: unknown): NormalizedTossPayment | null {
  if (typeof data !== 'object' || data === null) return null;
  const { paymentKey, orderId, status, totalAmount } = data as {
    paymentKey?: unknown;
    orderId?: unknown;
    status?: unknown;
    totalAmount?: unknown;
  };
  if (typeof paymentKey !== 'string' || !paymentKey) return null;
  if (typeof orderId !== 'string' || !orderId) return null;
  if (!TOSS_PAYMENT_STATUSES.includes(status as TossPaymentStatus)) return null;
  if (typeof totalAmount !== 'number' || !Number.isFinite(totalAmount)) return null;
  return { paymentKey, orderId, status: status as TossPaymentStatus, totalAmount };
}

export type WebhookAction =
  | { kind: 'confirm'; ref: TossOrderRef }
  | { kind: 'reflect_cancel'; ref: TossOrderRef }
  | { kind: 'record_failure'; ref: TossOrderRef }
  | { kind: 'unsupported' }
  | { kind: 'ignore'; reason: 'foreign_order_id' | 'in_progress' };

export type ConfirmRpcOutcome = 'unfulfillable' | 'retryable';

/** 확정 RPC 예외 → 처리 방침. 주문 레벨 만료·확정 불가만 토스 자동 취소로 흡수한다.
 * 'payment not payable' 같은 payments 행 레벨 오류를 여기 넣으면 이행 가능한 결제를
 * 자동 환불하게 되므로, 매칭은 주문/예매 상태 메시지로만 좁힌다. */
export function mapConfirmRpcError(message: string): ConfirmRpcOutcome {
  if (message.includes('order expired') || message.includes('order not payable')) return 'unfulfillable';
  return 'retryable';
}

/** 재조회로 검증된 결제 상태 → 우리 쪽 반영 액션. */
export function decideWebhookAction(payment: NormalizedTossPayment): WebhookAction {
  const ref = parseTossOrderId(payment.orderId);
  if (!ref) return { kind: 'ignore', reason: 'foreign_order_id' };

  switch (payment.status) {
    case 'DONE':
      return { kind: 'confirm', ref };
    case 'CANCELED':
      return { kind: 'reflect_cancel', ref };
    case 'PARTIAL_CANCELED':
      // v1은 부분 취소를 발행하지 않는다 — 발생 자체가 이상 상태라 재시도로 노출한다.
      return { kind: 'unsupported' };
    case 'ABORTED':
    case 'EXPIRED':
      return { kind: 'record_failure', ref };
    default:
      return { kind: 'ignore', reason: 'in_progress' };
  }
}
