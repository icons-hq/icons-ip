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
  type: string;
  currency: string;
  method: string | null;
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
  const { paymentKey, orderId, status, totalAmount, type, currency, method } = data as {
    paymentKey?: unknown;
    orderId?: unknown;
    status?: unknown;
    totalAmount?: unknown;
    type?: unknown;
    currency?: unknown;
    method?: unknown;
  };
  if (typeof paymentKey !== 'string' || !paymentKey) return null;
  if (typeof orderId !== 'string' || !orderId) return null;
  if (!TOSS_PAYMENT_STATUSES.includes(status as TossPaymentStatus)) return null;
  if (typeof totalAmount !== 'number' || !Number.isSafeInteger(totalAmount) || totalAmount <= 0) return null;
  if (typeof type !== 'string' || !type) return null;
  if (typeof currency !== 'string' || !currency) return null;
  if (method !== null && typeof method !== 'string') return null;
  return {
    paymentKey,
    orderId,
    status: status as TossPaymentStatus,
    totalAmount,
    type,
    currency,
    method,
  };
}

export type ApprovedTossPaymentVerification =
  | { ok: true; payment: NormalizedTossPayment }
  | {
      ok: false;
      reason:
        | 'provider_response_mismatch'
        | 'unsupported_payment_contract'
        | 'unsupported_payment_method';
    };

/** 승인 API 응답을 콜백 요청과 대조한다. 위젯 v1 계약은 일반결제·원화만 허용한다. */
export function verifyApprovedTossPayment(
  data: unknown,
  expected: { paymentKey: string; orderId: string; amount: number },
): ApprovedTossPaymentVerification {
  const payment = normalizeTossPayment(data);
  if (
    !payment ||
    payment.paymentKey !== expected.paymentKey ||
    payment.orderId !== expected.orderId ||
    payment.totalAmount !== expected.amount
  ) {
    return { ok: false, reason: 'provider_response_mismatch' };
  }
  if (payment.method === '가상계좌') {
    return { ok: false, reason: 'unsupported_payment_method' };
  }
  if (payment.type !== 'NORMAL' || payment.currency !== 'KRW' || payment.status !== 'DONE') {
    return { ok: false, reason: 'unsupported_payment_contract' };
  }
  return { ok: true, payment };
}

export type TossCancellationStateVerification =
  | { ok: true; state: 'uncanceled' | 'fully_canceled' }
  | {
      ok: false;
      reason:
        | 'provider_response_mismatch'
        | 'unsupported_payment_contract'
        | 'incomplete_cancellation';
    };

/** 관리자 환불 정합화용 fresh GET 판정.
 * POST 성공이나 에러 코드만 신뢰하지 않고 provider identity·잔액·완료 취소 합계를
 * 모두 확인한 뒤에만 로컬 환불 증거로 승격한다. */
export function verifyTossCancellationState(
  data: unknown,
  expected: { paymentKey: string; orderId: string; amount: number },
): TossCancellationStateVerification {
  const payment = normalizeTossPayment(data);
  if (
    !payment
    || payment.paymentKey !== expected.paymentKey
    || payment.orderId !== expected.orderId
    || payment.totalAmount !== expected.amount
  ) {
    return { ok: false, reason: 'provider_response_mismatch' };
  }
  if (payment.type !== 'NORMAL' || payment.currency !== 'KRW') {
    return { ok: false, reason: 'unsupported_payment_contract' };
  }

  const { balanceAmount, cancels } = data as {
    balanceAmount?: unknown;
    cancels?: unknown;
  };
  if (
    typeof balanceAmount !== 'number'
    || !Number.isSafeInteger(balanceAmount)
    || balanceAmount < 0
    || balanceAmount > expected.amount
  ) {
    return { ok: false, reason: 'provider_response_mismatch' };
  }

  if (payment.status === 'DONE') {
    if (balanceAmount === expected.amount && (cancels === null || (Array.isArray(cancels) && cancels.length === 0))) {
      return { ok: true, state: 'uncanceled' };
    }
    return { ok: false, reason: 'incomplete_cancellation' };
  }

  if (payment.status !== 'CANCELED' || balanceAmount !== 0 || !Array.isArray(cancels) || !cancels.length) {
    return { ok: false, reason: 'incomplete_cancellation' };
  }

  let canceledAmount = 0;
  for (const cancel of cancels) {
    if (typeof cancel !== 'object' || cancel === null) {
      return { ok: false, reason: 'incomplete_cancellation' };
    }
    const { cancelAmount, cancelStatus } = cancel as {
      cancelAmount?: unknown;
      cancelStatus?: unknown;
    };
    if (
      typeof cancelAmount !== 'number'
      || !Number.isSafeInteger(cancelAmount)
      || cancelAmount <= 0
      || cancelStatus !== 'DONE'
    ) {
      return { ok: false, reason: 'incomplete_cancellation' };
    }
    canceledAmount += cancelAmount;
  }

  return canceledAmount === expected.amount
    ? { ok: true, state: 'fully_canceled' }
    : { ok: false, reason: 'incomplete_cancellation' };
}

export type WebhookAction =
  | { kind: 'confirm'; ref: TossOrderRef }
  | { kind: 'reflect_cancel'; ref: TossOrderRef }
  | { kind: 'record_failure'; ref: TossOrderRef }
  | { kind: 'cancel_unsupported'; ref: TossOrderRef }
  | { kind: 'unsupported' }
  | { kind: 'ignore'; reason: 'foreign_order_id' | 'in_progress' };

/** 승인 실패가 비종결(토스 측에서 성공했을 가능성이 남음)인지 — failed로 기록하면 안 되는 부류.
 * 409 IDEMPOTENT_REQUEST_PROCESSING은 같은 멱등키의 첫 요청이 아직 처리 중이라는 신호다
 * (공식 멱등키 문서: 재요청으로 결과를 확인하라). */
export function isIndeterminateTossFailure(failure: { status: number; code: string }): boolean {
  return (
    failure.status === 0 ||
    failure.status >= 500 ||
    failure.status === 409 ||
    failure.code === 'IDEMPOTENT_REQUEST_PROCESSING'
  );
}

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
  if (payment.status === 'CANCELED') return { kind: 'reflect_cancel', ref };
  if (payment.method === '가상계좌') {
    return payment.status === 'WAITING_FOR_DEPOSIT'
      ? { kind: 'cancel_unsupported', ref }
      : { kind: 'unsupported' };
  }
  if (payment.type !== 'NORMAL' || payment.currency !== 'KRW') {
    return { kind: 'unsupported' };
  }

  switch (payment.status) {
    case 'DONE':
      return { kind: 'confirm', ref };
    case 'PARTIAL_CANCELED':
      // v1은 부분 취소를 발행하지 않는다 — 발생 자체가 이상 상태라 재시도로 노출한다.
      return { kind: 'unsupported' };
    case 'WAITING_FOR_DEPOSIT':
      // v1은 가상계좌를 지원하지 않는다(위젯 설정으로만 막혀 있음). 공식 상태 다이어그램상
      // 입금 오류 시 DONE→WAITING_FOR_DEPOSIT 회귀 웹훅이 오므로, ignore로 삼키면
      // 토스 미결제·로컬 paid 불일치가 생긴다 — 발생 즉시 운영에 노출한다.
      return { kind: 'unsupported' };
    case 'ABORTED':
    case 'EXPIRED':
      return { kind: 'record_failure', ref };
    default:
      return { kind: 'ignore', reason: 'in_progress' };
  }
}
