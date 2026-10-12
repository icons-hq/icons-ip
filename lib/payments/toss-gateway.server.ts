import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  ConfirmOutcome,
  PaymentAttempt,
  PaymentGateway,
  PaymentOperationOutcome,
  PaymentProviderEvidence,
  PreparedCheckout,
  RefundOutcome,
} from './gateway';
import {
  TOSS_WIDGET_VARIANT_KEY,
  isTossAllowedMerchantId,
  isTossClientKey,
  isTossKeyPairAligned,
  isTossProviderOrderId,
  isTossSecretKey,
  tossKeyMode,
} from './toss-config.mjs';

// 토스페이먼츠 v2 코어 API(공식문서 129, https://docs.tosspayments.com/reference). 주문서형
// (구 결제위젯) v2가 공용하는 결제 API로, 승인은 POST /v1/payments/confirm, 취소는
// POST /v1/payments/{paymentKey}/cancel, 조회는 paymentKey를 알면 GET /v1/payments/{paymentKey},
// 모르면 GET /v1/payments/orders/{orderId}다. 주문서형 시크릿 키(gsk)가 쓸 수 있다고
// 명시된 코어 API는 "결제 승인, 결제 취소, paymentKey로 결제 조회, 거래 조회, 정산 조회,
// 수동 정산 조회"뿐이라(공식문서 122 /reference/using-api/api-keys) orderId 조회는
// paymentKey가 없는 재정합에만 남긴다. 문서 ID는 2026-10-12 MCP 실조회 기준이고, ID가
// 바뀌어도 찾을 수 있게 경로를 함께 적는다.
const TOSS_API_ORIGIN = 'https://api.tosspayments.com';
const MAX_RESPONSE_BYTES = 64 * 1024;
// 승인 POST /v1/payments/confirm의 시한. 카드사·간편결제사 승인 지연이 8초를 넘기면
// 여기서 abort한 뒤 조회로 가는데, 그 시점의 조회는 아직 승인 전이라 404→unknown이고
// 실제 승인은 provider 쪽에서 뒤늦게 성립한다 — 결과적으로 정상 결제가 웹훅 재전송에
// 의존하게 된다. 문서 129는 승인 응답 시간 상한을 규정하지 않으므로, confirm 라우트
// 예산(maxDuration 60초) 안에서 승인에 가장 긴 시한을 준다. 최악 경로는 두 갈래다 —
// 첫 요청이 이 시한까지 가면 409는 오지 않고 곧장 조회 8초로 가므로 ≤33초 + DB, 409는
// 처리 중인 중복 요청에 대한 즉시 응답이라 그 경로는 (즉시 409) + 대기 1초 + 재요청
// ≤25초 + 조회 8초 ≈ 34초 + DB다(25+25+8을 직렬로 더한 59초는 성립하지 않는 경로다).
// 승인된 결제가 허용 밖 결제수단이면 취소 8초 + 확인 조회 8초가 더해져 최악 ≈ 50초 + DB다.
const CONFIRM_TIMEOUT_MS = 25_000;
// 조회 GET·취소 POST의 시한. 조회는 멱등이라 짧게 끊고 다음 트리거(웹훅 재전송·내부
// reconcile)에 맡기는 편이 낫고, 취소는 응답 본문이 아니라 fresh 조회가 판정하므로
// 오래 기다릴 이유가 없다. 예외는 가상계좌 입금 전 취소(declineUnsupportedMethod) —
// 취소 응답 본문의 CANCELED로 판정한다(문서 129 "가상계좌 입금 전에 결제가 취소된
// 경우도 이 상태로 전환"; 입금 전이라 잔액이 없고, 웹훅 10초 예산 안에서 fresh 조회
// 1회를 더 쓰지 않기 위해서다).
const REQUEST_TIMEOUT_MS = 8_000;
// 승인 409(IDEMPOTENT_REQUEST_PROCESSING) 뒤 같은 키로 재요청하기 전 대기. 문서 123
// (/reference/using-api/authorization#멱등키-헤더)이 대기 시간을 규정하지 않으므로 "처리
// 중"이 끝날 여지를 주는 최소값이다. 409는 처리 중인 중복 요청에 대한 즉시 응답이라 이
// 경로는 (즉시 409) + 대기 1 + 재요청 ≤25 + 조회 8 ≈ 34초 + DB로 라우트 예산 60초 안에
// 든다(첫 요청이 시한까지 가면 409 없이 조회로 간다).
const RETRY_DELAY_MS = 1_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_PRODUCT_CODE = /^P[0-9a-f]{32}$/i;
// 토스 paymentKey는 최대 200자 고유 문자열이라는 계약 외 형식 명세가 없다 — DB
// finalizer의 200자 상한과 제어문자 금지만 강제한다.
const PROVIDER_PAYMENT_KEY = /^[\x21-\x7e]{1,200}$/;
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,300}$/;
// 에러 코드 표(문서 ID 59, 142종)에서 뽑은 결정적 거절 코드. 카드사/수단 거절과
// 한도·지원 범위 위반은 재조회해도 결과가 바뀌지 않는다. 표는 불완전하다 —
// REJECT_CARD_PAYMENT("한도초과 혹은 잔액부족으로 결제에 실패했습니다")는 문서 11의
// 승인 API 에러 재현 예시인데 표에 없다. 표 밖 4xx는 confirm이 조회로 재확인한다.
const DECLINED_CODES = new Set([
  'REJECT_CARD_COMPANY',
  'REJECT_CARD_PAYMENT',
  'REJECT_ACCOUNT_PAYMENT',
  'INVALID_REJECT_CARD',
  'INVALID_STOPPED_CARD',
  'INVALID_CARD',
  'INVALID_CARD_NUMBER',
  'INVALID_CARD_EXPIRATION',
  'INVALID_CARD_PASSWORD',
  'INVALID_CARD_IDENTITY',
  'INVALID_CARD_COMPANY',
  'BELOW_MINIMUM_AMOUNT',
  'BELOW_ZERO_AMOUNT',
  'EXCEED_MAX_AMOUNT',
  'EXCEED_MAX_PAYMENT_AMOUNT',
  'EXCEED_MAX_DAILY_PAYMENT_COUNT',
  'EXCEED_MAX_AUTH_COUNT',
  'EXCEEDS_TRANSFER_AMOUNT_MAXIMUM',
  'NOT_SUPPORTED_CARD_TYPE',
  'NOT_SUPPORTED_METHOD',
  'NOT_SUPPORTED_MONTHLY_INSTALLMENT_PLAN',
  'NOT_ALLOWED_POINT_USE',
  'NOT_ALLOWED_INSTALLMENT_BELOW_AMOUNT',
  'MAINTAINED_METHOD',
  'PAY_PROCESS_ABORTED',
]);
// 취소 API가 결제 상태·상점 정책상 취소 불가를 명시한 코드 — 재시도해도 결과가
// 같으므로 needs_review로 격리해 운영 판단에 태운다.
const CANCEL_REJECTED_CODES = new Set([
  'NOT_CANCELABLE_PAYMENT',
  'NOT_CANCELABLE_AMOUNT',
  'NOT_MATCHES_REFUNDABLE_AMOUNT',
  'EXCEED_MAX_REFUND_AMOUNT',
  'EXCEED_MAX_REFUND_DUE',
  'NOT_ALLOWED_PARTIAL_REFUND',
  'NOT_SUPPORTED_REFUND',
  'REFUND_REJECTED',
  'INVALID_REFUND_AMOUNT',
  'NOT_FOUND_PAYMENT',
]);
// 가상계좌 결제를 발견 즉시 취소할 때의 cancelReason(문서 129: 필수, ≤200자).
const UNSUPPORTED_METHOD_CANCEL_REASON = '지원하지 않는 결제수단(가상계좌)';
// 허용 밖 결제수단으로 승인된(DONE) 결제를 되돌릴 때의 cancelReason.
const DISALLOWED_METHOD_CANCEL_REASON = '지원하지 않는 결제수단';
// Phase 1 계약 결제수단. Payment.method 열거는 카드·가상계좌·간편결제·휴대폰·계좌이체·
// 문화상품권·도서문화상품권·게임문화상품권이다(문서 129 /reference#payment-객체).
const ALLOWED_PAYMENT_METHODS = new Set(['카드', '간편결제']);
// 허용 밖이지만 승인 직후 전액 취소가 문서상 성립하는 수단. 결제수단 정책(공식문서 17
// /guides/v2/get-started/payment-methods)과 취소 가이드(공식문서 8 /guides/v2/cancel-payment):
// 계좌이체는 180일 안에 출금 계좌로 실시간 환불되고(환불 계좌 불필요 — 문서 129의
// refundReceiveAccount는 "가상계좌 결제에만 필수"), 휴대폰은 결제일 당월 말일까지 당일
// 취소되며, 상품권은 1년 안에 실시간으로 잔액이 복원된다. 승인 직후라 세 기한 모두 안이다
// (휴대폰의 월말 경계·번호 이동처럼 취소가 거절되는 경우는 needs_review로 남는다). 이
// 목록 밖(가상계좌는 별도 가드, 문서에 없는 새 수단·method 누락)은 취소 조건을 문서로
// 확인할 수 없으므로 취소하지 않고 needs_review로 사람에게 넘긴다.
const CANCELABLE_DISALLOWED_METHODS = new Set([
  '계좌이체',
  '휴대폰',
  '문화상품권',
  '도서문화상품권',
  '게임문화상품권',
]);
const PAYMENT_STATUS = /^[A-Z_]{2,32}$/;
// 키·상점 설정이 틀렸다는 신호. 자동 종결하면 오류가 침묵하므로 needs_review로
// 격리해 운영 관측에 태운다.
const CONFIGURATION_CODES = new Set([
  'UNAUTHORIZED_KEY',
  'INVALID_API_KEY',
  'INVALID_CLIENT_KEY',
  'FORBIDDEN_REQUEST',
  'API_KEY_ACCESS_DENIED',
  'INVALID_ORDER_ID',
  'DUPLICATED_ORDER_ID',
  'INVALID_REQUEST',
  'INVALID_REQUIRED_PARAM',
  'INVALID_IDEMPOTENCY_KEY',
]);
// 문서 59 에러 표의 403 중 키·상점 설정 축이 아닌 일시 코드 — FORBIDDEN_CONSECUTIVE_REQUEST
// "반복적인 요청은 허용되지 않습니다. 잠시 후 다시 시도해주세요."·NOT_AVAILABLE_BANK "은행
// 서비스 시간이 아닙니다." 조회가 이 코드로 거부되면 사람이 키를 고칠 일이 아니라 재시도로
// 풀리는 상태이므로, 401/403 일괄 설정 오류 규칙보다 먼저 unknown(provider_unavailable)으로
// 분류해 웹훅 재전송·같은 멱등키 재실행에 맡긴다.
const TRANSIENT_CODES = new Set([
  'FORBIDDEN_CONSECUTIVE_REQUEST',
  'NOT_AVAILABLE_BANK',
]);

interface TossGatewayOptions {
  readonly clientKey: string;
  readonly secretKey: string;
  readonly siteUrl: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  /** 승인 POST 시한(ms). 기본 25초, 100ms~60초. */
  readonly confirmTimeoutMs?: number;
  /** 조회 GET·취소 POST 시한(ms). 기본 8초, 100ms~60초. */
  readonly requestTimeoutMs?: number;
  /** 승인 409(멱등 처리 중) 뒤 같은 키로 재요청하기 전 대기(ms). 기본 1초, 0~10초. */
  readonly retryDelayMs?: number;
  /** 재요청 대기 구현 — 테스트 주입용. 기본은 setTimeout. */
  readonly wait?: (ms: number) => Promise<void>;
}

class TossResponseTooLargeError extends Error {}
class TossResponseBodyInvalidError extends Error {}

interface ProviderRequestInit {
  readonly method: 'GET' | 'POST';
  /** 호출별 시한 — 승인은 confirmTimeoutMs, 조회·취소는 requestTimeoutMs. */
  readonly timeoutMs: number;
  readonly idempotencyKey?: string;
  readonly body?: Record<string, unknown>;
}

interface ProviderResponse {
  readonly status: number;
  /** 본문을 JSON으로 읽었는지. false면 payload는 undefined이고 상태 코드만 믿을 수 있다. */
  readonly parsed: boolean;
  readonly payload: unknown;
}

/** 결제 조회(paymentKey·orderId)의 공통 판독 결과(inquirePayment). */
type PaymentInquiry =
  | { readonly kind: 'ok'; readonly payment: Record<string, unknown> }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'configuration_error'; readonly code: string }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'http_error' };

function configurationError(): never {
  throw new Error('invalid_toss_configuration');
}

function timeoutOption(value: number | undefined, fallback: number) {
  const timeoutMs = value ?? fallback;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    return configurationError();
  }
  return timeoutMs;
}

function normalizeSiteUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return configurationError();
  }
  const localHttp = url.protocol === 'http:'
    && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !localHttp) return configurationError();
  if (url.username || url.password || url.search || url.hash) return configurationError();
  return url.origin;
}

function assertAttempt(attempt: PaymentAttempt) {
  const prefix = attempt.purpose === 'order' ? 'O' : attempt.purpose === 'ticket' ? 'T' : null;
  if (
    !UUID.test(attempt.id)
    || attempt.provider !== 'toss'
    || prefix === null
    || attempt.currency !== 'KRW'
    || !Number.isSafeInteger(attempt.amount)
    // 카드 결제 최소 금액 100원(BELOW_MINIMUM_AMOUNT 계약). 도메인 최소 주문
    // 금액은 DB place_order가 따로 지킨다.
    || attempt.amount < 100
    || attempt.amount > 999_999_999_999
    || !isTossProviderOrderId(attempt.providerOrderId)
    || !attempt.providerOrderId.startsWith(prefix)
    || !PROVIDER_PRODUCT_CODE.test(attempt.providerProductCode)
    // 굿즈 주문의 refId(=orders.id)는 failUrl 경로 세그먼트로 나간다 — 형식 밖
    // 값이 URL에 실리지 않게 여기서 막는다.
    || (attempt.purpose === 'order' && !UUID.test(attempt.refId))
    || !Number.isFinite(Date.parse(attempt.expiresAt))
  ) {
    throw new Error('invalid_payment_attempt');
  }
}

function safeString(value: unknown, maxLength = 512): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function integerAmount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  if (typeof value === 'string' && /^(0|[1-9][0-9]{0,11})$/.test(value)) {
    const amount = Number(value);
    return Number.isSafeInteger(amount) ? amount : null;
  }
  return null;
}

function constantTimeEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function isoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function baseOutcome(
  attempt: PaymentAttempt,
  outcome: PaymentOperationOutcome['outcome'],
  reasonCode: string,
  evidence?: PaymentProviderEvidence,
): PaymentOperationOutcome {
  return {
    attemptId: attempt.id,
    provider: 'toss',
    outcome,
    reasonCode,
    ...(evidence ? { evidence } : {}),
  };
}

function errorCode(payload: unknown): string | null {
  if (!plainRecord(payload)) return null;
  return safeString(payload.code, 64) && /^[A-Z0-9_]{2,64}$/.test(payload.code)
    ? payload.code
    : null;
}

/**
 * 승인·조회 응답의 Payment 객체가 이 attempt의 결제인지 대조한다. 금액은 상태가
 * 변해도 유지되는 totalAmount 기준이다(취소 후 balanceAmount는 줄어든다).
 */
function paymentMatchesAttempt(payment: Record<string, unknown>, attempt: PaymentAttempt) {
  return payment.orderId === attempt.providerOrderId
    && payment.currency === 'KRW'
    && integerAmount(payment.totalAmount) === attempt.amount
    && safeString(payment.paymentKey, 200)
    && PROVIDER_PAYMENT_KEY.test(payment.paymentKey as string);
}

/**
 * 가상계좌 결제인지. Payment 객체의 `method`는 `가상계좌`이고(문서 129 결제수단
 * 열거) `virtualAccount` 객체가 실린다 — 둘 중 하나만 있어도 가상계좌로 본다.
 * 카드·간편결제 응답의 `virtualAccount: null`은 객체가 아니므로 걸리지 않는다.
 */
function isVirtualAccountPayment(payment: Record<string, unknown>) {
  return payment.method === '가상계좌' || plainRecord(payment.virtualAccount);
}

/**
 * 이 Payment가 우리 상점(MID)의 결제인지. Payment 객체는 `mId`(상점아이디, 최대 14자)를
 * 싣는다(문서 129 /reference#payment-객체). 결제서비스와 MID는 1:1이고(문서 24), 문서에
 * 박힌 공개 테스트 키의 결제는 우리 상점이 아니다(문서 122) — 그런 결제를 승인·취소
 * 확정·실패 판정 근거로 쓰면 다른 상점의 원장으로 우리 주문을 닫게 된다. `mId`가 없거나
 * 이 게이트웨이 키 모드의 허용 MID(toss-config.mjs — 라이브 `iconsi0xvd`, 테스트
 * `ticonsi0xvd`) 밖이면 판정에 쓰지 않는다.
 */
function merchantAllowed(payment: Record<string, unknown>, keyMode: 'live' | 'test') {
  return isTossAllowedMerchantId(payment.mId, keyMode);
}

function paymentStatusLabel(payment: Record<string, unknown>) {
  return safeString(payment.status, 32) && PAYMENT_STATUS.test(payment.status)
    ? payment.status
    : 'UNKNOWN';
}

function validPaymentKey(value: unknown): string | undefined {
  return safeString(value, 200) && PROVIDER_PAYMENT_KEY.test(value) ? value : undefined;
}

/**
 * MID가 허용 목록 밖인 결제를 만났을 때의 격리. 어떤 상태든(승인·취소·실패) 그 결제를
 * 근거로 attempt를 닫지 않고, 취소도 발행하지 않는다 — 다른 상점의 결제를 취소하지 않기
 * 위해서다. 유일한 예외는 환불의 원장 paymentKey 조회가 같은 결제의 전액 취소를 확인한
 * 경우다(refund의 inquireForRefund — 돈이 움직이지 않는 수렴). resultCode는 비밀이 아닌 짧은
 * 표지(`{status}_merchant_mismatch`)이고, 운영자가 결제를 찾을 수 있게 결제 키를 증거로
 * 남긴다(응답 키가 형식 밖이면 우리가 보낸 키).
 */
function merchantMismatchOutcome(
  attempt: PaymentAttempt,
  payment: Record<string, unknown>,
  knownPaymentKey?: string,
): PaymentOperationOutcome {
  const paymentKey = validPaymentKey(payment.paymentKey) ?? knownPaymentKey;
  return baseOutcome(attempt, 'needs_review', 'provider_merchant_mismatch', {
    ...(paymentKey ? { providerPaymentKey: paymentKey } : {}),
    resultCode: `${paymentStatusLabel(payment)}_merchant_mismatch`,
  });
}

/**
 * 조회한 Payment가 이 attempt의 전액 취소 상태인지. 부분취소는 발행하지 않는
 * 계약이므로 PARTIAL_CANCELED·잔여 balance는 전액 취소로 인정하지 않는다.
 */
function paymentFullyCanceled(payment: Record<string, unknown>, attempt: PaymentAttempt) {
  return payment.status === 'CANCELED'
    && payment.orderId === attempt.providerOrderId
    && payment.currency === 'KRW'
    && integerAmount(payment.totalAmount) === attempt.amount
    && integerAmount(payment.balanceAmount) === 0;
}

/**
 * 취소를 검증한 fresh 조회 응답에서 증거를 뽑는다.
 *
 * `providerPaymentKey`는 provider가 "이 건을 취소했다"고 말한 결제의 식별자다.
 * paymentFullyCanceled는 orderId·금액·잔액만 대조하므로, 이 키가 로컬 원장의
 * payments.payment_key와 같은지는 호출자(취소 오케스트레이터)가 다시 대조해야
 * 완료 근거가 순환하지 않는다. 형식이 계약 밖이면 아예 싣지 않는다 — 없는 키는
 * 호출자에서 격리로 읽히고, 그게 추측 종결보다 안전하다.
 */
function canceledEvidence(payment: Record<string, unknown>): PaymentProviderEvidence {
  const cancels = Array.isArray(payment.cancels) ? payment.cancels : [];
  const lastCancel = cancels.length > 0 && plainRecord(cancels[cancels.length - 1])
    ? cancels[cancels.length - 1] as Record<string, unknown>
    : null;
  const transactionKey = lastCancel && safeString(lastCancel.transactionKey, 64)
    ? lastCancel.transactionKey
    : safeString(payment.lastTransactionKey, 64)
      ? payment.lastTransactionKey
      : null;
  const canceledAt = lastCancel ? isoTimestamp(lastCancel.canceledAt) : null;
  const paymentKey = safeString(payment.paymentKey, 200)
    && PROVIDER_PAYMENT_KEY.test(payment.paymentKey)
    ? payment.paymentKey
    : undefined;
  return {
    ...(paymentKey ? { providerPaymentKey: paymentKey } : {}),
    ...(transactionKey ? { providerTransactionId: transactionKey } : {}),
    resultCode: 'CANCELED',
    ...(canceledAt ? { approvedAt: canceledAt } : {}),
  };
}

function approvedEvidence(payment: Record<string, unknown>): PaymentProviderEvidence {
  const card = plainRecord(payment.card) ? payment.card : null;
  const easyPay = plainRecord(payment.easyPay) ? payment.easyPay : null;
  const transactionId = safeString(payment.lastTransactionKey, 64)
    ? payment.lastTransactionKey
    : null;
  const approvalReference = card && safeString(card.approveNo, 8) ? card.approveNo : null;
  const method = safeString(payment.method, 32) ? payment.method : null;
  const maskedCardNumber = card && safeString(card.number, 20) ? card.number : null;
  const easyPayProvider = easyPay && safeString(easyPay.provider, 32) ? easyPay.provider : null;
  const maskedMethod = maskedCardNumber ?? easyPayProvider ?? method;
  const approvedAt = isoTimestamp(payment.approvedAt);
  return {
    providerPaymentKey: payment.paymentKey as string,
    ...(transactionId ? { providerTransactionId: transactionId } : {}),
    ...(approvalReference ? { providerApprovalReference: approvalReference } : {}),
    resultCode: 'DONE',
    ...(method ? { paymentMethod: method } : {}),
    ...(maskedMethod ? { maskedPaymentMethod: maskedMethod } : {}),
    ...(approvedAt ? { approvedAt } : {}),
  };
}

async function readBoundedJson(response: Response) {
  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new TossResponseTooLargeError();
  }
  if (!response.body) throw new SyntaxError('missing response body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new TossResponseTooLargeError();
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(joined));
}

/**
 * 토스페이먼츠 주문서형(구 결제위젯) v2 어댑터. 시크릿 키는 이 server-only 모듈의
 * 클로저 밖으로 나가지 않는다 — 클라이언트 payload에는 공개 클라이언트 키만 싣고,
 * successUrl 경로에 싣는 callback nonce는 시크릿 키 HMAC 파생이라 재-prepare에도
 * 바이트 안정적이다.
 */
export function createTossPaymentGateway(options: TossGatewayOptions): PaymentGateway {
  const clientKey = options.clientKey;
  const secretKey = options.secretKey;
  const siteUrl = normalizeSiteUrl(options.siteUrl);
  if (
    !isTossClientKey(clientKey)
    || !isTossSecretKey(secretKey)
    || !isTossKeyPairAligned(clientKey, secretKey)
  ) {
    return configurationError();
  }
  // 허용 MID는 키 모드별이다(테스트 키 결제의 mId는 `t` + 라이브 MID). 키 쌍은 위에서 같은
  // 모드로 검증됐으므로 시크릿 키의 모드가 이 게이트웨이의 모드다.
  const secretKeyMode = tossKeyMode(secretKey);
  if (secretKeyMode !== 'live' && secretKeyMode !== 'test') return configurationError();
  // 아래 함수 선언(호이스팅)에서도 좁혀진 타입을 쓰도록 선언 타입으로 고정한다.
  const keyMode: 'live' | 'test' = secretKeyMode;
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const confirmTimeoutMs = timeoutOption(options.confirmTimeoutMs, CONFIRM_TIMEOUT_MS);
  const requestTimeoutMs = timeoutOption(options.requestTimeoutMs, REQUEST_TIMEOUT_MS);
  const retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS;
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0 || retryDelayMs > 10_000) {
    return configurationError();
  }
  const wait = options.wait
    ?? ((ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); }));
  const authorizationHeader = `Basic ${Buffer.from(`${secretKey}:`, 'utf8').toString('base64')}`;

  function callbackNonce(attempt: PaymentAttempt) {
    return createHmac('sha256', secretKey)
      .update(`icons:toss:callback:v1:${attempt.id}:${attempt.providerOrderId}`, 'utf8')
      .digest('base64url');
  }

  /**
   * 코어 API 호출의 저수준 계층. 전송 실패(타임아웃·네트워크·과대 응답)는 throw하고,
   * 본문이 JSON이 아닌 응답은 상태 코드를 보존한 채 parsed:false로 돌려준다 — 401·403은
   * 본문 없이도 설정 오류로 읽어야 하기 때문이다(inquireByOrderId).
   */
  async function providerFetch(path: string, init: ProviderRequestInit): Promise<ProviderResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), init.timeoutMs);
    try {
      const response = await fetchImpl(new URL(path, TOSS_API_ORIGIN).toString(), {
        method: init.method,
        headers: {
          authorization: authorizationHeader,
          accept: 'application/json',
          ...(init.body ? { 'content-type': 'application/json' } : {}),
          ...(init.idempotencyKey ? { 'idempotency-key': init.idempotencyKey } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        cache: 'no-store',
        signal: controller.signal,
      });
      let payload: unknown;
      try {
        payload = await readBoundedJson(response);
      } catch (error) {
        // 과대 응답과 시한 내 미완(abort)은 전송 실패다. 그 밖(빈 본문·JSON 아님)은
        // 상태 코드가 이미 도착한 응답이라 status만 남긴다.
        if (error instanceof TossResponseTooLargeError || controller.signal.aborted) throw error;
        return { status: response.status, parsed: false, payload: undefined };
      }
      return { status: response.status, parsed: true, payload };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 승인·취소 호출 계약: 본문이 JSON이 아니면 throw한다 — 호출자가 조회로 수렴하는
   * 기존 규율 그대로다.
   */
  async function providerRequest(path: string, init: ProviderRequestInit) {
    const response = await providerFetch(path, init);
    if (!response.parsed) throw new TossResponseBodyInvalidError();
    return { status: response.status, payload: response.payload } as const;
  }

  /**
   * 결제 조회의 공통 판독 — paymentKey 조회(GET /v1/payments/{paymentKey})와 orderId
   * 조회(GET /v1/payments/orders/{orderId})가 같은 규칙을 쓴다. 문서 129(/reference)는 두
   * 조회 모두 성공하면 Payment 객체, 실패하면 "HTTP 상태 코드와 함께 에러 객체"만 약속한다.
   *
   * 401·403은 본문 코드와 무관하게 키·설정 오류다. 문서 59(/reference/error-codes) 에러
   * 표에서 401 UNAUTHORIZED_KEY·403 API_KEY_ACCESS_DENIED(IP 접근 정책, 문서 121
   * /reference/using-api/api-key-access-policy)·403 FORBIDDEN_REQUEST는 모두 키·상점 설정
   * 축이다. 특히 orderId 조회는 주문서형 시크릿 키(gsk)로 호출할 수 있다는 명문이 없다 —
   * 문서 122의 gsk 코어 API 목록은 결제 승인·결제 취소·paymentKey로 결제 조회·거래 조회·
   * 정산 조회·수동 정산 조회뿐이다. 이를 unknown으로 흡수하면 웹훅 재전송 7회가 전부 5xx로
   * 소진되고 환불은 provider_unavailable로 잘못 라벨링된다. 그 밖의 비200 응답도 본문 code가
   * CONFIGURATION_CODES(400 INVALID_API_KEY 등)면 같은 축이다. 404·5xx·미지 4xx·타임아웃은
   * 기존 unknown 규칙 그대로다.
   *
   * 예외는 문서 59의 일시 403(TRANSIENT_CODES) — 본문 code가 FORBIDDEN_CONSECUTIVE_REQUEST
   * (반복 요청 제한)·NOT_AVAILABLE_BANK(은행 서비스 시간 밖)면 상태가 403이어도 키 축이
   * 아니므로 401/403 규칙보다 먼저 unavailable로 읽는다. 취소 200 직후의 사후 조회가
   * 반복 요청 제한에 걸려 needs_review로 오라벨링되거나, 웹훅이 200 ack로 재전송을
   * 끊는 것을 막는다. 본문 없는 401/403은 그대로 설정 오류다.
   */
  async function inquirePayment(path: string): Promise<PaymentInquiry> {
    let inquiry: ProviderResponse;
    try {
      inquiry = await providerFetch(path, { method: 'GET', timeoutMs: requestTimeoutMs });
    } catch {
      return { kind: 'unavailable' };
    }
    const code = inquiry.parsed ? errorCode(inquiry.payload) : null;
    if (inquiry.status !== 200 && code !== null && TRANSIENT_CODES.has(code)) {
      return { kind: 'unavailable' };
    }
    if (inquiry.status === 401 || inquiry.status === 403) {
      return { kind: 'configuration_error', code: code ?? `HTTP_${inquiry.status}` };
    }
    // 본문이 JSON이 아닌 응답은 상태와 무관하게 전송 실패와 같은 축이다(기존 계약).
    if (!inquiry.parsed) return { kind: 'unavailable' };
    // 404 규칙은 호출자마다 다르다(시한 판정·declined 승격) — 코드와 무관하게 넘긴다.
    if (inquiry.status === 404) return { kind: 'not_found' };
    if (inquiry.status !== 200 && code !== null && CONFIGURATION_CODES.has(code)) {
      return { kind: 'configuration_error', code };
    }
    if (inquiry.status !== 200 || !plainRecord(inquiry.payload)) return { kind: 'http_error' };
    return { kind: 'ok', payment: inquiry.payload };
  }

  /** orderId 조회 — paymentKey를 모르는 재정합(힌트 없는 reconcile·키 없는 환불)에만 쓴다. */
  function inquireByOrderId(attempt: PaymentAttempt) {
    return inquirePayment(`/v1/payments/orders/${encodeURIComponent(attempt.providerOrderId)}`);
  }

  /**
   * paymentKey 조회 — 문서 122가 주문서형 시크릿 키에 명시한 조회다. 응답이 이 키의
   * 결제인지(paymentKey)·이 attempt의 주문인지(orderId)는 호출자가 대조한다.
   */
  function inquireByPaymentKey(paymentKey: string) {
    return inquirePayment(`/v1/payments/${encodeURIComponent(paymentKey)}`);
  }

  /**
   * 가상계좌(WAITING_FOR_DEPOSIT) 가드. Phase 1 결제수단은 카드·간편결제뿐이고 가상계좌는
   * 에스크로(구매안전서비스) 계약이 없다. 그런데 PAYMENT_STATUS_CHANGED는 가상계좌를
   * 포함한 모든 결제수단에 발송되므로(문서 41 /guides/v2/webhook, 문서 127
   * /reference/using-api/webhook-events), 결제 어드민 설정 실수로 위젯에
   * 가상계좌가 노출되면 구매자가 입금하는 순간 DONE 웹훅→reconcile→approved로 미계약
   * 가상계좌 판매가 성립한다. 그 뒤의 환불은 취소 API가 refundReceiveAccount를 요구해
   * 어댑터가 자동으로 되돌릴 수 없다. 입금 전에는 "환불해야 되는 금액이 없기 때문에 이
   * 파라미터를 추가할 필요가 없"고 "부분 취소를 할 수 없고 전체 금액 취소만" 가능하므로
   * (문서 129), 발견 즉시 cancelReason만 실어 전액 취소해 입금 경로를 닫고 declined
   * (reasonCode provider_method_not_allowed)로 종결한다. 취소가 성립하지 않으면(비200·
   * 본문 상태 미취소·전송 실패) needs_review로 격리해 운영자가 결제 어드민에서 취소한다.
   * 이 격리가 "돈이 움직이지 않은 상태"인 것은 입금 전까지다 — needs_review는 재정합
   * 대상이라 구매자가 입금하면 DONE 웹훅이 다시 조회를 태우는데, 그 DONE은
   * settleDonePayment가 approved를 막아 needs_review(resultCode DONE_virtual_account)에
   * 남긴다(환불은 refundReceiveAccount가 필요해 수동). 어휘가 canceled가 아니라 declined인
   * 이유: reconcile 계약에서 canceled는 승인 결제의 전액 취소 검증을 통과했을 때만 쓴다.
   *
   * 입금 전 취소의 성립 판정은 예외적으로 fresh 조회가 아니라 취소 응답 본문의
   * `CANCELED`다 — 문서 129 "가상계좌 입금 전에 결제가 취소된 경우도 이 상태로 전환",
   * 입금 전이라 잔액이 없고, 웹훅 10초 예산 안에서 조회 1회를 더 쓰지 않기 위해서다. 그
   * 본문도 우리 상점(MID)·이 결제·이 주문의 것일 때만 믿는다.
   *
   * 호출자는 상점(MID)과 paymentMatchesAttempt를 먼저 통과시킨다 — 이 attempt의 결제가
   * 아닌 것, 다른 상점의 결제를 취소하지 않는다.
   */
  async function declineUnsupportedMethod(
    attempt: PaymentAttempt,
    payment: Record<string, unknown>,
  ): Promise<PaymentOperationOutcome> {
    const paymentKey = payment.paymentKey as string;
    const evidence: PaymentProviderEvidence = {
      providerPaymentKey: paymentKey,
      resultCode: 'WAITING_FOR_DEPOSIT',
      ...(safeString(payment.method, 32) ? { paymentMethod: payment.method } : {}),
    };
    try {
      const cancelResult = await providerRequest(
        `/v1/payments/${encodeURIComponent(paymentKey)}/cancel`,
        {
          method: 'POST',
          timeoutMs: requestTimeoutMs,
          // 같은 attempt를 confirm·재확인 조회·reconcile 어디서 다시 만나도 같은 키다 —
          // 토스가 첫 응답을 재생하므로(문서 123) 취소가 두 번 나가지 않는다.
          idempotencyKey: `cancel-unsupported:${attempt.id}`,
          // cancelAmount 없음 = 전액 취소, refundReceiveAccount 없음 = 입금 전.
          body: { cancelReason: UNSUPPORTED_METHOD_CANCEL_REASON },
        },
      );
      if (
        cancelResult.status === 200
        && plainRecord(cancelResult.payload)
        && cancelResult.payload.status === 'CANCELED'
        && merchantAllowed(cancelResult.payload, keyMode)
        && cancelResult.payload.paymentKey === paymentKey
        && cancelResult.payload.orderId === attempt.providerOrderId
      ) {
        return baseOutcome(attempt, 'declined', 'provider_method_not_allowed', evidence);
      }
    } catch {
      // 타임아웃·과대 응답·네트워크 실패 — 취소 성립 여부가 미상이다. 아래 격리.
    }
    return baseOutcome(attempt, 'needs_review', 'provider_method_not_allowed', evidence);
  }

  /**
   * 허용 밖 결제수단 가드 — 카드·간편결제가 아닌 수단으로 승인(DONE)된 결제. Phase 1 계약
   * 결제수단은 카드·간편결제뿐인데, 그 제한은 토스 결제 어드민의 노출 설정에만 달려 있다
   * (공식문서 24 /guides/v2/payment-widget/admin). 설정 실수로 계좌이체·휴대폰·상품권이
   * 노출돼 승인되면 그 결제를 approved로 확정하지 않는다.
   *
   * 승인 직후 전액 취소가 문서상 성립하는 수단(CANCELABLE_DISALLOWED_METHODS)은 이
   * 자리에서 취소를 발행하고, 판정은 환불과 같은 규율로 취소 응답이 아니라 fresh
   * paymentKey 조회(우리 상점·이 결제·전액 취소·잔액 0)로만 한다 — 검증되면 declined
   * (provider_method_not_allowed, resultCode `CANCELED_method_not_allowed`)이고 돈은 돌아갔다.
   * 검증되지 않으면(취소 거절·전송 실패·조회 실패) needs_review(resultCode
   * `DONE_method_not_allowed`)로 격리한다 — needs_review는 재정합 대상이라 다음 웹훅·내부
   * reconcile이 같은 멱등키로 다시 시도하고(문서 123: 첫 응답 재생), 취소가 이미 성립했으면
   * 조회가 전액 취소로 닫는다. 취소 조건을 문서로 확인할 수 없는 수단(문서에 없는 새 수단·
   * method 누락)은 취소하지 않고 곧장 needs_review다.
   *
   * 멱등키 `cancel-method:{attemptId}`는 가상계좌 가드(`cancel-unsupported:`)와 같은 규율
   * (attempt 파생·경로 무관 동일)이되 이름을 나눠, 같은 attempt에서 두 가드가 서로 다른
   * 결제를 만나도 첫 응답 재생에 섞이지 않게 한다.
   *
   * 호출자(settleDonePayment)가 상점(MID)·identity·가상계좌 여부를 먼저 통과시킨다.
   */
  async function cancelDisallowedMethod(
    attempt: PaymentAttempt,
    payment: Record<string, unknown>,
  ): Promise<PaymentOperationOutcome> {
    const paymentKey = payment.paymentKey as string;
    const method = safeString(payment.method, 32) ? payment.method : undefined;
    const evidence: PaymentProviderEvidence = {
      providerPaymentKey: paymentKey,
      resultCode: 'DONE_method_not_allowed',
      ...(method !== undefined ? { paymentMethod: method } : {}),
    };
    if (method === undefined || !CANCELABLE_DISALLOWED_METHODS.has(method)) {
      return baseOutcome(attempt, 'needs_review', 'provider_method_not_allowed', evidence);
    }
    try {
      await providerRequest(
        `/v1/payments/${encodeURIComponent(paymentKey)}/cancel`,
        {
          method: 'POST',
          timeoutMs: requestTimeoutMs,
          idempotencyKey: `cancel-method:${attempt.id}`,
          // cancelAmount 없음 = 전액 취소. 이 수단들은 환불 계좌가 필요 없다(문서 129).
          body: { cancelReason: DISALLOWED_METHOD_CANCEL_REASON },
        },
      );
    } catch {
      // 타임아웃·과대 응답·네트워크 실패 — 취소가 성립했을 수 있으므로 조회가 판정한다.
    }
    const after = await inquireByPaymentKey(paymentKey);
    if (
      after.kind === 'ok'
      && merchantAllowed(after.payment, keyMode)
      && after.payment.paymentKey === paymentKey
      && paymentFullyCanceled(after.payment, attempt)
    ) {
      return baseOutcome(attempt, 'declined', 'provider_method_not_allowed', {
        ...evidence,
        resultCode: 'CANCELED_method_not_allowed',
      });
    }
    return baseOutcome(attempt, 'needs_review', 'provider_method_not_allowed', evidence);
  }

  /**
   * 조회·승인 응답이 `DONE`인 결제의 종결 판정 — 승인 200·confirm 재확인 조회·reconcile
   * 조회 세 곳이 같은 규칙을 쓴다. 순서대로 상점(MID) → identity → 가상계좌 → 결제수단을
   * 통과해야 approved다.
   *
   * 가상계좌 가드(declineUnsupportedMethod)가 입금 전 취소에 실패해 needs_review로 남은
   * 건은 재정합 대상이라, 구매자가 입금하면 DONE 웹훅→reconcile 조회 DONE이 이 분기로
   * 들어온다(문서 127 가상계좌 흐름 "WAITING_FOR_DEPOSIT →입금 완료→ DONE"). 여기서
   * approved를 돌려주면 에스크로(구매안전서비스) 계약 없는 가상계좌 판매가 성립하고, 그
   * 환불은 취소 API가 refundReceiveAccount를 요구해(문서 129 "가상계좌 결제에만 필수")
   * 어댑터가 되돌릴 수 없다. 그래서 입금 뒤 DONE은 취소도 승인도 하지 않고 needs_review에
   * 남겨 운영자가 결제 어드민에서 환불 계좌를 받아 처리한다 — resultCode
   * `DONE_virtual_account`가 입금 전(`WAITING_FOR_DEPOSIT`) 격리와 구분되는 표지다. 그 밖의
   * 허용 밖 수단은 cancelDisallowedMethod가 맡는다.
   *
   * `knownPaymentKey`는 우리가 이미 아는 결제 키다 — 승인 200에서는 successUrl 콜백의 키,
   * paymentKey 조회에서는 조회에 쓴 키. 응답의 paymentKey가 이 키와 같아야 하고, 어긋나면
   * 그 키를 증거로 남긴다.
   */
  async function settleDonePayment(
    attempt: PaymentAttempt,
    payment: Record<string, unknown>,
    reasonCode: 'provider_approved' | 'provider_approved_after_recheck' | 'provider_reconciled_approved',
    knownPaymentKey?: string,
  ): Promise<PaymentOperationOutcome> {
    if (!merchantAllowed(payment, keyMode)) {
      return merchantMismatchOutcome(attempt, payment, knownPaymentKey);
    }
    if (
      !paymentMatchesAttempt(payment, attempt)
      || (knownPaymentKey !== undefined && payment.paymentKey !== knownPaymentKey)
    ) {
      return baseOutcome(
        attempt,
        'needs_review',
        'provider_identity_mismatch',
        knownPaymentKey !== undefined
          ? { providerPaymentKey: knownPaymentKey, resultCode: 'DONE_identity_mismatch' }
          : undefined,
      );
    }
    if (isVirtualAccountPayment(payment)) {
      return baseOutcome(attempt, 'needs_review', 'provider_method_not_allowed', {
        providerPaymentKey: payment.paymentKey as string,
        resultCode: 'DONE_virtual_account',
        ...(safeString(payment.method, 32) ? { paymentMethod: payment.method } : {}),
      });
    }
    if (typeof payment.method !== 'string' || !ALLOWED_PAYMENT_METHODS.has(payment.method)) {
      return cancelDisallowedMethod(attempt, payment);
    }
    return baseOutcome(attempt, 'approved', reasonCode, approvedEvidence(payment));
  }

  /**
   * 조회한 Payment로 attempt를 판정한다 — confirm 재확인과 reconcile이 같은 규칙을 쓴다.
   * outcome 어휘는 두 문맥이 공유하는 계약이다: canceled는 전액 취소 검증
   * (paymentFullyCanceled)을 통과했을 때만 돌려주고(환불 재정합이 canceled를 "원거래 전액
   * 취소 확인"으로 읽어 환불 승인으로 승격한다), EXPIRED·ABORTED 같은 승인 불성립은
   * declined다.
   *
   * 어떤 상태든 먼저 상점(MID)을 본다 — 다른 상점의 결제로는 승인도 실패도 확정하지
   * 않는다. paymentKey로 조회했다면(`lookupPaymentKey`) 응답이 그 키·이 attempt의 주문인지도
   * 본다 — 다른 주문의 결제로 이 attempt를 닫지 않는다.
   */
  async function settleInquiredPayment(
    attempt: PaymentAttempt,
    payment: Record<string, unknown>,
    approvedReason: 'provider_approved_after_recheck' | 'provider_reconciled_approved',
    lookupPaymentKey?: string,
  ): Promise<PaymentOperationOutcome> {
    if (!merchantAllowed(payment, keyMode)) {
      return merchantMismatchOutcome(attempt, payment, lookupPaymentKey);
    }
    if (
      lookupPaymentKey !== undefined
      && (payment.paymentKey !== lookupPaymentKey || payment.orderId !== attempt.providerOrderId)
    ) {
      return baseOutcome(attempt, 'needs_review', 'provider_identity_mismatch', {
        providerPaymentKey: lookupPaymentKey,
        resultCode: `${paymentStatusLabel(payment)}_identity_mismatch`,
      });
    }
    if (payment.status === 'DONE') {
      // 가상계좌 DONE(입금 완료)·허용 밖 수단은 여기서 approved가 아니다.
      return settleDonePayment(attempt, payment, approvedReason, lookupPaymentKey);
    }
    if (payment.status === 'WAITING_FOR_DEPOSIT') {
      // 가상계좌 입금 대기 — unknown으로 두면 입금 뒤 DONE 웹훅이 이 attempt를 다시
      // 태우는데, 그때는 settleDonePayment가 막는다. 입금 전에 닫는 것이 우선이다.
      if (!paymentMatchesAttempt(payment, attempt)) {
        return baseOutcome(attempt, 'needs_review', 'provider_identity_mismatch');
      }
      return declineUnsupportedMethod(attempt, payment);
    }
    if (paymentFullyCanceled(payment, attempt)) {
      // 호출자가 원장 payment_key와 대조할 providerPaymentKey를 경로에 따라 빠뜨리지 않는다.
      return baseOutcome(
        attempt,
        'canceled',
        'provider_payment_canceled',
        canceledEvidence(payment),
      );
    }
    if (payment.status === 'CANCELED' || payment.status === 'PARTIAL_CANCELED') {
      // 우리는 부분취소를 발행하지 않는다 — 전액 취소 검증(금액·잔액 대조)을
      // 통과하지 못한 취소 상태는 자동 종결하지 않는다.
      return baseOutcome(attempt, 'needs_review', 'provider_cancellation_mismatch');
    }
    if (payment.status === 'ABORTED') {
      return baseOutcome(attempt, 'declined', 'provider_declined', { resultCode: 'ABORTED' });
    }
    if (payment.status === 'EXPIRED') {
      // 결제 유효시간 30분 경과(문서 129) — 승인 불성립 확정이지 취소 성공이 아니다.
      return baseOutcome(attempt, 'declined', 'provider_payment_expired', {
        resultCode: 'EXPIRED',
      });
    }
    // READY·IN_PROGRESS 등 비종결 상태는 추측 종결하지 않는다.
    return baseOutcome(attempt, 'unknown', 'provider_payment_in_progress');
  }

  /**
   * confirm이 모호하게 끝났을 때 콜백 paymentKey로 실상태를 조회해 분기한다(스펙: confirm
   * 실패를 즉시 실패로 단정하지 않는다). 조회까지 모호하면 unknown으로 보존해 reconcile에
   * 넘기고, 키·설정 오류는 needs_review로 격리한다.
   *
   * paymentKey 조회를 쓰는 이유: 문서 122가 주문서형 시크릿 키에 명시한 조회이고, 승인을
   * 시도한 바로 그 결제를 본다. paymentKey 조회 404(NOT_FOUND_PAYMENT, 문서 59 "존재하지
   * 않는 결제 정보")는 이 키의 결제가 우리 상점에 없다는 뜻이라, 승인 실패가 4xx로 확정된
   * 경로(문서 28: 승인 실패는 4xx/5xx)에서는 실패 확정(notFoundOutcome 'declined')이고,
   * 5xx·전송 실패처럼 승인이 뒤늦게 성립할 수 있는 경로에서는 unknown이다(기존 orderId 조회
   * 404 규칙과 같다).
   */
  async function recheckByInquiry(
    attempt: PaymentAttempt,
    paymentKey: string,
    options: {
      readonly notFoundOutcome?: 'declined';
      readonly notFoundReason?: string;
      readonly notFoundEvidence?: PaymentProviderEvidence;
    } = {},
  ): Promise<ConfirmOutcome> {
    const inquiry = await inquireByPaymentKey(paymentKey);
    if (inquiry.kind === 'unavailable') {
      return baseOutcome(attempt, 'unknown', 'provider_unavailable') as ConfirmOutcome;
    }
    if (inquiry.kind === 'not_found') {
      if (options.notFoundOutcome === 'declined') {
        return baseOutcome(
          attempt,
          'declined',
          options.notFoundReason ?? 'provider_payment_not_found',
          options.notFoundEvidence,
        ) as ConfirmOutcome;
      }
      return baseOutcome(attempt, 'unknown', 'provider_inquiry_not_found') as ConfirmOutcome;
    }
    if (inquiry.kind === 'configuration_error') {
      // 재조회해도 같은 결과다 — unknown으로 위장하지 않고 운영 관측에 태운다.
      return baseOutcome(attempt, 'needs_review', 'provider_configuration_error', {
        resultCode: inquiry.code,
      }) as ConfirmOutcome;
    }
    if (inquiry.kind === 'http_error') {
      return baseOutcome(attempt, 'unknown', 'provider_http_error') as ConfirmOutcome;
    }
    return await settleInquiredPayment(
      attempt,
      inquiry.payment,
      'provider_approved_after_recheck',
      paymentKey,
    ) as ConfirmOutcome;
  }

  /**
   * 웹훅 힌트(paymentKey)로 찾은 결제가 이 attempt를 닫을 근거인지. 웹훅 본문에는 서명이
   * 없으므로 힌트는 조회 대상을 좁힐 뿐이고, 판정은 조회 응답으로만 한다 — 응답이 우리
   * 상점(MID)·그 키·이 attempt의 주문이고, 상태가 주문 단위로 유일한 결과일 때만 쓴다.
   *
   * 한 주문번호에는 결제창을 띄울 때마다 결제(paymentKey)가 생길 수 있다(문서 127 결제
   * 상태 흐름: 결제창 실행 → READY → 유효 시간 만료 시 EXPIRED 웹훅). 반면 주문번호는
   * "이미 승인 및 취소가 진행"되면 다시 쓸 수 없다(문서 44 DUPLICATED_ORDER_ID). 그래서
   * DONE·WAITING_FOR_DEPOSIT(가상계좌 발급)·CANCELED·PARTIAL_CANCELED는 그 주문의 유일한
   * 승인 결제를 말하지만, READY·IN_PROGRESS·ABORTED·EXPIRED는 버려진 다른 결제창일 수
   * 있어 주문의 결론이 아니다 — 그런 힌트는 버리고 orderId 조회로 판정한다.
   */
  function hintIsDecisive(
    payment: Record<string, unknown>,
    attempt: PaymentAttempt,
    hintedPaymentKey: string,
  ) {
    return merchantAllowed(payment, keyMode)
      && payment.paymentKey === hintedPaymentKey
      && payment.orderId === attempt.providerOrderId
      && (
        payment.status === 'DONE'
        || payment.status === 'WAITING_FOR_DEPOSIT'
        || payment.status === 'CANCELED'
        || payment.status === 'PARTIAL_CANCELED'
      );
  }

  return {
    async prepare(attempt): Promise<PreparedCheckout> {
      assertAttempt(attempt);
      const currentTime = now();
      const expiresAt = new Date(attempt.expiresAt);
      if (!Number.isFinite(currentTime.getTime()) || expiresAt.getTime() <= currentTime.getTime()) {
        throw new Error('invalid_payment_attempt');
      }
      const nonce = callbackNonce(attempt);
      // 토스는 successUrl에 자기 쿼리(paymentKey·orderId·amount)를 붙여 리다이렉트
      // 한다. 기존 쿼리 보존은 문서가 보장하지 않으므로 단회용 callback nonce는
      // 쿼리가 아니라 경로 세그먼트로 싣는다.
      const successPath = attempt.purpose === 'order'
        ? `/api/payments/goods/confirm/toss/${nonce}`
        : `/api/payments/tickets/confirm/toss/${nonce}`;
      // failUrl 쿼리는 code·message·orderId다(문서 48 SDK 레퍼런스·28 실패 리다이렉트
      // 절: `{failUrl}?code=…&message=…&orderId=…`). 다만 그 orderId는 provider
      // 주문번호(O…)라 주문 화면의 refId가 아니고, 구매자가 결제창을 닫은
      // PAY_PROCESS_CANCELED에서는 orderId가 아예 넘어오지 않는다(문서 162 FAQ).
      // 그래서 어느 주문에서 실패했는지는 successUrl의 nonce와 같은 규율로 경로에
      // 싣는다. 평평한 '/checkout'으로 돌리면 복귀 화면이 "같은 주문에서 다시
      // 시도"를 최신 pending 주문으로 링크해, pending이 둘 이상이면 다른 주문으로
      // 유도한다. 티켓 checkout에는 인덱스 라우트가 없다 — 실패 복귀는 예매 목록으로.
      const failPath = attempt.purpose === 'order'
        ? `/checkout/${attempt.refId}`
        : '/tickets';
      return {
        attemptId: attempt.id,
        provider: 'toss',
        expiresAt: attempt.expiresAt,
        callbackNonce: nonce,
        action: {
          kind: 'client_sdk',
          payload: {
            provider: 'toss',
            clientKey,
            // 내부 사용자 식별자를 provider에 보내지 않는다 — 위젯은 SDK의
            // ANONYMOUS 상수로 초기화한다(비회원 결제 계약).
            customerKey: 'ANONYMOUS',
            // 결제의 MID는 결제 UI(variant)에 연결된 MID가 정한다(공식문서 24). 기본
            // `DEFAULT`는 다른 서비스와 공유하는 MID라, MID iconsi0xvd에 연결한 ICONS 전용
            // 결제 UI를 명시한다(toss-config.mjs TOSS_WIDGET_VARIANT_KEY).
            variantKey: TOSS_WIDGET_VARIANT_KEY,
            orderId: attempt.providerOrderId,
            orderName: attempt.purpose === 'order' ? 'ICONS 굿즈 주문' : 'ICONS 티켓 주문',
            amount: attempt.amount,
            currency: 'KRW',
            successUrl: new URL(successPath, siteUrl).toString(),
            failUrl: new URL(failPath, siteUrl).toString(),
          },
        },
      };
    },

    async confirm(input): Promise<ConfirmOutcome> {
      assertAttempt(input.attempt);
      if (!plainRecord(input.providerPayload)) {
        return baseOutcome(input.attempt, 'needs_review', 'provider_invalid_callback') as ConfirmOutcome;
      }
      const expectedNonce = callbackNonce(input.attempt);
      if (
        input.providerOrderId !== input.attempt.providerOrderId
        || !constantTimeEquals(input.callbackNonce, expectedNonce)
        || input.providerPayload.orderId !== input.attempt.providerOrderId
      ) {
        return baseOutcome(
          input.attempt,
          'needs_review',
          'provider_identity_mismatch',
        ) as ConfirmOutcome;
      }
      // successUrl 쿼리 금액은 진실원이 아니다 — 서버 저장 주문 금액과 다르면
      // 승인 API를 호출하지 않는다(문서 Critical 2.2).
      if (integerAmount(input.providerPayload.amount) !== input.attempt.amount) {
        return baseOutcome(
          input.attempt,
          'needs_review',
          'provider_amount_mismatch',
        ) as ConfirmOutcome;
      }
      const paymentKey = input.providerPayload.paymentKey;
      if (!safeString(paymentKey, 200) || !PROVIDER_PAYMENT_KEY.test(paymentKey)) {
        return baseOutcome(input.attempt, 'needs_review', 'provider_invalid_callback') as ConfirmOutcome;
      }
      if (!IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
        return baseOutcome(input.attempt, 'needs_review', 'provider_invalid_callback') as ConfirmOutcome;
      }

      const requestConfirm = () => providerRequest('/v1/payments/confirm', {
        method: 'POST',
        timeoutMs: confirmTimeoutMs,
        idempotencyKey: input.idempotencyKey,
        body: {
          paymentKey,
          orderId: input.attempt.providerOrderId,
          amount: input.attempt.amount,
        },
      });
      let confirmResult: { status: number; payload: unknown };
      try {
        confirmResult = await requestConfirm();
        if (confirmResult.status === 409) {
          // 문서 123: "첫 번째 요청이 처리 중일 때 같은 요청을 다시 보내면 HTTP 409 -
          // IDEMPOTENT_REQUEST_PROCESSING … 이 에러가 돌아오면 다시 한번 요청해서
          // 응답을 확인하세요." 문서화된 409는 이것뿐이다(문서 59 에러 표에 409 행이
          // 없다). 같은 Idempotency-Key로 정확히 1회만 재요청하고 — 키를 바꿔 재시도하는
          // 것은 문서가 위험하다고 경고하는 경로다 — 그 응답을 첫 응답과 같은 분기로
          // 읽는다. 재요청도 409면 아래에서 조회로 수렴한다.
          await wait(retryDelayMs);
          confirmResult = await requestConfirm();
        }
      } catch {
        // 타임아웃·과대 응답·네트워크 실패 — 승인이 성립했을 수 있으므로 조회로
        // 확인하고, 조회까지 실패하면 unknown으로 보존한다. 재요청 중 실패도 같다.
        return recheckByInquiry(input.attempt, paymentKey);
      }

      if (confirmResult.status === 200) {
        const payload = confirmResult.payload;
        if (
          plainRecord(payload)
          && (payload.status === 'DONE' || payload.status === 'WAITING_FOR_DEPOSIT')
          && !merchantAllowed(payload, keyMode)
        ) {
          // 승인(또는 가상계좌 발급)이 우리 상점이 아닌 MID에서 성립했다 — 키가 다른
          // 상점·문서 공개 키다. 승인으로 확정하지도, 취소하지도 않는다.
          return merchantMismatchOutcome(input.attempt, payload, paymentKey) as ConfirmOutcome;
        }
        if (plainRecord(payload) && payload.status === 'WAITING_FOR_DEPOSIT') {
          // 가상계좌 — 승인 200이지만 입금 전이라 돈은 아직 움직이지 않았다. 입금 경로를
          // 닫는다(입금 뒤 DONE은 아래 settleDonePayment가 승인을 막는다).
          if (
            !paymentMatchesAttempt(payload, input.attempt)
            || payload.paymentKey !== paymentKey
          ) {
            return baseOutcome(input.attempt, 'needs_review', 'provider_identity_mismatch', {
              providerPaymentKey: paymentKey,
              resultCode: 'WAITING_FOR_DEPOSIT_identity_mismatch',
            }) as ConfirmOutcome;
          }
          return declineUnsupportedMethod(input.attempt, payload);
        }
        if (!plainRecord(payload) || payload.status !== 'DONE') {
          return baseOutcome(input.attempt, 'unknown', 'provider_invalid_response', {
            providerPaymentKey: paymentKey,
          }) as ConfirmOutcome;
        }
        return await settleDonePayment(
          input.attempt,
          payload,
          'provider_approved',
          paymentKey,
        ) as ConfirmOutcome;
      }

      const code = errorCode(confirmResult.payload);
      if (code === 'PAY_PROCESS_CANCELED') {
        // 구매자 결제창 이탈 — 승인이 시작되지 않은 취소라 조회 경로의 전액 취소 검증
        // 대상이 아니다. 조회 경로 밖에서 canceled를 쓰는 유일한 지점이며, finalizer는
        // declined와 같이 취급하고 환불 재정합은 gateway.reconcile 결과만 읽는다.
        return baseOutcome(input.attempt, 'canceled', 'provider_user_canceled', {
          providerPaymentKey: paymentKey,
          resultCode: code,
        }) as ConfirmOutcome;
      }
      if (code !== null && DECLINED_CODES.has(code)) {
        return baseOutcome(input.attempt, 'declined', 'provider_declined', {
          providerPaymentKey: paymentKey,
          resultCode: code,
        }) as ConfirmOutcome;
      }
      if (code !== null && CONFIGURATION_CODES.has(code)) {
        return baseOutcome(input.attempt, 'needs_review', 'provider_configuration_error', {
          providerPaymentKey: paymentKey,
          resultCode: code,
        }) as ConfirmOutcome;
      }
      if (code === 'NOT_FOUND_PAYMENT_SESSION') {
        // 인증 후 승인 시한 10분을 지나 세션이 유실됐다 — 이 세션으로 더는 승인이
        // 성립할 수 없으므로 조회 404는 실패 확정으로 읽는다.
        return recheckByInquiry(input.attempt, paymentKey, {
          notFoundOutcome: 'declined',
          notFoundReason: 'provider_session_expired',
        });
      }
      if (code === 'ALREADY_PROCESSED_PAYMENT' || confirmResult.status === 409) {
        // 이미 처리됐다는 신호(중복 콜백) 또는 재요청 뒤에도 409(멱등 처리 중) —
        // 실상태를 조회로 수렴한다.
        return recheckByInquiry(input.attempt, paymentKey);
      }
      if (confirmResult.status >= 500) {
        // 5xx는 승인이 provider 쪽에서 뒤늦게 성립할 수 있다 — 조회 404도 unknown.
        return recheckByInquiry(input.attempt, paymentKey);
      }
      if (code !== null) {
        // 표 밖 4xx 코드. 승인 실패는 4xx/5xx로 온다는 계약(문서 28)과 paymentKey 조회
        // 404는 이 키의 결제가 없다는 뜻(문서 59 NOT_FOUND_PAYMENT)을 결합하면, 4xx 뒤 조회
        // 404는 이 결제로 승인이 성립하지 않았다는 확정 사실이다 — 본문 코드를 그대로
        // 믿지는 않되(조회 DONE이면 승인), 404를 unknown으로 남겨 웹훅 재전송 7회를
        // 태울 이유도 없다. 원 코드는 resultCode로 보존해 운영이 표를 보강할 수 있게 한다.
        return recheckByInquiry(input.attempt, paymentKey, {
          notFoundOutcome: 'declined',
          notFoundReason: 'provider_declined',
          notFoundEvidence: { providerPaymentKey: paymentKey, resultCode: code },
        });
      }
      // 4xx인데 본문에 코드가 없다 — 어떤 실패인지 모르니 추측하지 않고 조회로 확인한다.
      return recheckByInquiry(input.attempt, paymentKey);
    },

    /**
     * 조회 API 기반 자동 정합화(#390). 이 outcome 어휘는 결제 재정합(미종결
     * attempt)과 환불 재정합(reconcileRefund) 두 문맥이 공유한다 — 환불 재정합은
     * 'canceled'를 "원거래 전액 취소 확인"으로 읽어 환불 승인으로 승격하므로,
     * canceled는 전액 취소 검증(paymentFullyCanceled)을 통과했을 때만 돌려주고
     * EXPIRED·미승인 실패 확정은 declined로 돌려준다. confirm 재확인
     * (recheckByInquiry)도 같은 어휘를 쓴다(settleInquiredPayment).
     *
     * `hint.providerPaymentKey`(웹훅 본문 paymentKey)가 있으면 paymentKey 조회를 먼저 쓴다.
     * 힌트는 서명 없는 본문에서 왔으므로 hintIsDecisive를 통과한 응답만 판정에 쓰고, 그
     * 밖(404·키/설정 거부·전송 실패·다른 주문·다른 상점·주문의 결론이 아닌 상태)은 힌트를
     * 버리고 orderId 조회로 판정한다 — 힌트가 위조돼도 결과는 힌트가 없을 때와 같다.
     */
    async reconcile(attempt, hint) {
      assertAttempt(attempt);
      const hintedPaymentKey = validPaymentKey(hint?.providerPaymentKey);
      if (hintedPaymentKey !== undefined) {
        const hinted = await inquireByPaymentKey(hintedPaymentKey);
        if (hinted.kind === 'ok' && hintIsDecisive(hinted.payment, attempt, hintedPaymentKey)) {
          return settleInquiredPayment(
            attempt,
            hinted.payment,
            'provider_reconciled_approved',
            hintedPaymentKey,
          );
        }
      }
      const inquiry = await inquireByOrderId(attempt);
      if (inquiry.kind === 'unavailable') {
        return baseOutcome(attempt, 'unknown', 'provider_unavailable');
      }
      if (inquiry.kind === 'not_found') {
        // orderId 조회는 승인된 결제만 돌려준다(문서 129 "승인된 결제를 orderId로 조회").
        // 승인 가능 시한(attempt TTL 안 결제창 오픈 + 결제창 유효 30분 + 인증 후 승인
        // 10분 + 버퍼)이 지난 404는 이 주문으로 승인이 성립할 수 없다는 확정 사실이다 —
        // 콜백 유실이 사람 손 없이 닫히는 지점.
        const absentAfter = Date.parse(attempt.expiresAt) + 45 * 60_000;
        if (Number.isFinite(absentAfter) && now().getTime() > absentAfter) {
          return baseOutcome(attempt, 'declined', 'provider_payment_absent');
        }
        return baseOutcome(attempt, 'unknown', 'provider_inquiry_not_found');
      }
      if (inquiry.kind === 'configuration_error') {
        return baseOutcome(attempt, 'needs_review', 'provider_configuration_error', {
          resultCode: inquiry.code,
        });
      }
      if (inquiry.kind === 'http_error') {
        return baseOutcome(attempt, 'unknown', 'provider_http_error');
      }
      return settleInquiredPayment(attempt, inquiry.payment, 'provider_reconciled_approved');
    },

    async refund(request): Promise<RefundOutcome> {
      assertAttempt(request.attempt);
      const attempt = request.attempt;
      // 부분취소는 발행하지 않는다 — 법적 고지 문구(전액 환불)와 일치.
      if (request.amount !== attempt.amount) {
        return baseOutcome(
          attempt,
          'needs_review',
          'provider_refund_amount_mismatch',
        ) as RefundOutcome;
      }
      const ledgerPaymentKey = request.providerPaymentKey;
      if (
        !safeString(request.reason, 200)
        || !IDEMPOTENCY_KEY.test(request.idempotencyKey)
        || (ledgerPaymentKey !== undefined && validPaymentKey(ledgerPaymentKey) === undefined)
      ) {
        return baseOutcome(attempt, 'needs_review', 'provider_refund_request_invalid') as RefundOutcome;
      }

      // 취소 결과 판정은 취소 API 응답 body가 아니라 fresh 조회만 진실원으로
      // 삼는다(웹훅 본문 불신과 같은 규율). 이미 전액 취소된 건은 성공으로
      // 수렴하고, 부분취소·잔여 balance는 우리가 만든 상태가 아니므로 격리한다.
      // 원장이 결제 키를 알면 paymentKey 조회(문서 122가 gsk에 명시한 조회)를 쓰고, 응답이
      // 그 키·이 attempt의 주문인지 대조한다. 키가 없을 때만 orderId 조회다.
      async function inquireForRefund(): Promise<
        | { readonly kind: 'canceled'; readonly payment: Record<string, unknown> }
        | { readonly kind: 'done'; readonly payment: Record<string, unknown> }
        | { readonly kind: 'merchant_mismatch'; readonly payment: Record<string, unknown> }
        | { readonly kind: 'identity_mismatch'; readonly payment: Record<string, unknown> }
        | { readonly kind: 'not_found' }
        | { readonly kind: 'not_refundable' }
        | { readonly kind: 'configuration_error'; readonly code: string }
        | { readonly kind: 'ambiguous' }
      > {
        const inquiry = ledgerPaymentKey !== undefined
          ? await inquireByPaymentKey(ledgerPaymentKey)
          : await inquireByOrderId(attempt);
        if (inquiry.kind === 'unavailable' || inquiry.kind === 'http_error') {
          return { kind: 'ambiguous' };
        }
        if (inquiry.kind === 'not_found') return { kind: 'not_found' };
        if (inquiry.kind === 'configuration_error') {
          return { kind: 'configuration_error', code: inquiry.code };
        }
        const payment = inquiry.payment;
        // 다른 상점의 결제는 취소하지 않고, DONE 판정 근거로도 쓰지 않는다.
        if (!merchantAllowed(payment, keyMode)) {
          // 예외 하나: 원장이 아는 결제 키로 조회한 응답이 같은 결제(키·주문)이고 이미 전액
          // 취소됐다면 MID와 무관하게 환불 완료로 수렴한다. 돈은 움직이지 않고(취소 API는
          // MID 일치일 때만 부른다) 우리 원장이 confirm 때 기록한 그 결제가 취소됐다는 사실만
          // 읽는다. 이 수렴이 없으면 MID 바인딩 이전 결제(결제 UI DEFAULT로 승인된 심사 창
          // 테스트 결제 등)는 결제 어드민에서 취소해도 결제확인필요에서 나오지 못한다.
          // mId 자체는 있어야 한다(최대 14자, 문서 129) — 스키마 밖 응답은 수렴 근거가 아니다.
          if (
            ledgerPaymentKey !== undefined
            && safeString(payment.mId, 14)
            && payment.paymentKey === ledgerPaymentKey
            && payment.orderId === attempt.providerOrderId
            && paymentFullyCanceled(payment, attempt)
          ) {
            return { kind: 'canceled', payment };
          }
          return { kind: 'merchant_mismatch', payment };
        }
        if (
          ledgerPaymentKey !== undefined
          && (payment.paymentKey !== ledgerPaymentKey || payment.orderId !== attempt.providerOrderId)
        ) {
          return { kind: 'identity_mismatch', payment };
        }
        if (paymentFullyCanceled(payment, attempt)) return { kind: 'canceled', payment };
        if (
          payment.status === 'DONE'
          && payment.orderId === attempt.providerOrderId
          && integerAmount(payment.totalAmount) === attempt.amount
          && safeString(payment.paymentKey, 200)
          && PROVIDER_PAYMENT_KEY.test(payment.paymentKey as string)
          // 입금이 끝난 가상계좌는 취소 API가 refundReceiveAccount를 요구한다(문서 129
          // "가상계좌 결제에만 필수"). 어댑터는 환불 계좌를 싣지 않으므로 호출하면
          // INVALID_REQUEST로 거부돼 설정 오류로 오라벨링된다 — 호출하지 않고
          // not_refundable(needs_review)로 운영 판단에 태운다.
          && !isVirtualAccountPayment(payment)
        ) {
          return { kind: 'done', payment };
        }
        return { kind: 'not_refundable' };
      }

      function identityMismatch(payment: Record<string, unknown>) {
        return baseOutcome(attempt, 'needs_review', 'provider_identity_mismatch', {
          ...(ledgerPaymentKey !== undefined ? { providerPaymentKey: ledgerPaymentKey } : {}),
          resultCode: `${paymentStatusLabel(payment)}_identity_mismatch`,
        }) as RefundOutcome;
      }

      const before = await inquireForRefund();
      if (before.kind === 'merchant_mismatch') {
        return merchantMismatchOutcome(attempt, before.payment, ledgerPaymentKey) as RefundOutcome;
      }
      if (before.kind === 'identity_mismatch') return identityMismatch(before.payment);
      if (before.kind === 'canceled') {
        return {
          ...baseOutcome(
            attempt,
            'approved',
            'provider_already_fully_canceled',
            canceledEvidence(before.payment),
          ),
          refundedAmount: attempt.amount,
        } as RefundOutcome;
      }
      if (before.kind === 'not_found') {
        return baseOutcome(attempt, 'needs_review', 'provider_payment_not_found') as RefundOutcome;
      }
      if (before.kind === 'not_refundable') {
        return baseOutcome(attempt, 'needs_review', 'provider_payment_not_refundable') as RefundOutcome;
      }
      if (before.kind === 'configuration_error') {
        // 키·설정 오류를 일시 장애로 위장하지 않는다 — 취소 API를 호출하지 않고 격리.
        return baseOutcome(attempt, 'needs_review', 'provider_configuration_error', {
          resultCode: before.code,
        }) as RefundOutcome;
      }
      if (before.kind === 'ambiguous') {
        return baseOutcome(attempt, 'unknown', 'provider_unavailable') as RefundOutcome;
      }

      const paymentKey = before.payment.paymentKey as string;
      let cancelSucceeded = false;
      try {
        const cancelResult = await providerRequest(
          `/v1/payments/${encodeURIComponent(paymentKey)}/cancel`,
          {
            method: 'POST',
            timeoutMs: requestTimeoutMs,
            idempotencyKey: request.idempotencyKey,
            // cancelAmount를 싣지 않는다 — 값이 없으면 전액 취소가 취소 API 계약이다.
            body: { cancelReason: request.reason },
          },
        );
        const code = errorCode(cancelResult.payload);
        if (cancelResult.status === 200) {
          cancelSucceeded = true;
        } else if (code !== null && CANCEL_REJECTED_CODES.has(code)) {
          return baseOutcome(attempt, 'needs_review', 'provider_cancel_rejected', {
            providerPaymentKey: paymentKey,
            resultCode: code,
          }) as RefundOutcome;
        } else if (code !== null && CONFIGURATION_CODES.has(code)) {
          return baseOutcome(attempt, 'needs_review', 'provider_configuration_error', {
            providerPaymentKey: paymentKey,
            resultCode: code,
          }) as RefundOutcome;
        }
        // ALREADY_CANCELED_PAYMENT·409·5xx·미지 코드는 fresh 조회가 판정한다.
      } catch {
        // 타임아웃·네트워크 실패 — 취소가 성립했을 수 있으므로 조회로 확인한다.
      }

      const after = await inquireForRefund();
      if (after.kind === 'merchant_mismatch') {
        return merchantMismatchOutcome(attempt, after.payment, paymentKey) as RefundOutcome;
      }
      if (after.kind === 'identity_mismatch') return identityMismatch(after.payment);
      if (after.kind === 'canceled') {
        return {
          ...baseOutcome(
            attempt,
            'approved',
            'provider_cancel_confirmed',
            canceledEvidence(after.payment),
          ),
          refundedAmount: attempt.amount,
        } as RefundOutcome;
      }
      if (after.kind === 'done') {
        // 취소 API가 200을 줬는데 조회가 여전히 DONE이면 provider 상태가
        // 어긋난 것이다 — 자동 종결하지 않는다.
        return baseOutcome(
          attempt,
          cancelSucceeded ? 'needs_review' : 'unknown',
          cancelSucceeded ? 'provider_cancellation_incomplete' : 'provider_cancel_ambiguous',
          { providerPaymentKey: paymentKey },
        ) as RefundOutcome;
      }
      if (after.kind === 'not_refundable') {
        return baseOutcome(attempt, 'needs_review', 'provider_payment_not_refundable', {
          providerPaymentKey: paymentKey,
        }) as RefundOutcome;
      }
      if (after.kind === 'configuration_error') {
        // 취소 API가 200이었어도 조회가 키·설정 축에서 거부되면 자동 종결하지 않는다
        // — 조회만 진실원이라는 규율 그대로다.
        return baseOutcome(attempt, 'needs_review', 'provider_configuration_error', {
          providerPaymentKey: paymentKey,
          resultCode: after.code,
        }) as RefundOutcome;
      }
      return baseOutcome(attempt, 'unknown', 'provider_unavailable', {
        providerPaymentKey: paymentKey,
      }) as RefundOutcome;
    },
  };
}
