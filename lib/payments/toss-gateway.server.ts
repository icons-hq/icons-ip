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
  isTossClientKey,
  isTossKeyPairAligned,
  isTossProviderOrderId,
  isTossSecretKey,
} from './toss-config.mjs';

// 토스페이먼츠 v2 코어 API(https://docs.tosspayments.com/reference). 주문서형(구
// 결제위젯) v2가 공용하는 결제 API로, 승인은 POST /v1/payments/confirm, 조회는
// GET /v1/payments/orders/{orderId}다. 2026-09-01 공식문서 MCP 실조회 기준.
const TOSS_API_ORIGIN = 'https://api.tosspayments.com';
const MAX_RESPONSE_BYTES = 64 * 1024;
// 승인 POST /v1/payments/confirm의 시한. 카드사·간편결제사 승인 지연이 8초를 넘기면
// 여기서 abort한 뒤 조회로 가는데, 그 시점의 조회는 아직 승인 전이라 404→unknown이고
// 실제 승인은 provider 쪽에서 뒤늦게 성립한다 — 결과적으로 정상 결제가 웹훅 재전송에
// 의존하게 된다. 문서 127은 승인 응답 시간 상한을 규정하지 않으므로, confirm 라우트
// 예산(maxDuration 60초 = 승인 25 + 409 재요청 25 + 조회 8 + DB) 안에서 승인에 가장
// 긴 시한을 준다.
const CONFIRM_TIMEOUT_MS = 25_000;
// 조회 GET·취소 POST의 시한. 조회는 멱등이라 짧게 끊고 다음 트리거(웹훅 재전송·내부
// reconcile)에 맡기는 편이 낫고, 취소는 응답 본문이 아니라 fresh 조회가 판정하므로
// 오래 기다릴 이유가 없다.
const REQUEST_TIMEOUT_MS = 8_000;
// 승인 409(IDEMPOTENT_REQUEST_PROCESSING) 뒤 같은 키로 재요청하기 전 대기. 문서 122가
// 대기 시간을 규정하지 않으므로 "처리 중"이 끝날 여지를 주는 최소값이며, 라우트 예산
// (승인 25 + 대기 1 + 재요청 25 + 조회 8) 안에 들어간다.
const RETRY_DELAY_MS = 1_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_PRODUCT_CODE = /^P[0-9a-f]{32}$/i;
// 토스 paymentKey는 최대 200자 고유 문자열이라는 계약 외 형식 명세가 없다 — DB
// finalizer의 200자 상한과 제어문자 금지만 강제한다.
const PROVIDER_PAYMENT_KEY = /^[\x21-\x7e]{1,200}$/;
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,300}$/;
// 에러 코드 표(문서 ID 59, 142종)에서 뽑은 결정적 거절 코드. 카드사/수단 거절과
// 한도·지원 범위 위반은 재조회해도 결과가 바뀌지 않는다.
const DECLINED_CODES = new Set([
  'REJECT_CARD_COMPANY',
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

/** orderId 조회의 공통 판독 결과(inquireByOrderId). */
type OrderInquiry =
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
   * orderId 조회(GET /v1/payments/orders/{orderId})의 공통 판독 — confirm 재확인·
   * reconcile·refund 사전/사후 조회 세 곳이 같은 규칙을 쓴다.
   *
   * 401·403은 본문 코드와 무관하게 키·설정 오류다. 이 endpoint를 주문서형 시크릿 키
   * (gsk)가 호출할 수 있다는 명문이 공식문서에 없고(문서 121 "주문서형, 결제창형 연동
   * 키 > 시크릿 키"의 코어 API 목록은 결제 승인·결제 취소·paymentKey로 결제 조회·거래
   * 조회·정산 조회·수동 정산 조회뿐이다), 문서 59 에러 표에서 401 UNAUTHORIZED_KEY·
   * 403 API_KEY_ACCESS_DENIED(IP 접근 정책)·403 FORBIDDEN_REQUEST는 모두 키·상점
   * 설정 축이다(문서 127 orderId 조회 절은 실패 시 "HTTP 상태 코드와 함께 에러 객체"
   * 만 약속한다). 이를 unknown으로 흡수하면 웹훅 재전송 7회가 전부 5xx로 소진되고
   * 환불은 provider_unavailable로 잘못 라벨링된다. 그 밖의 비200 응답도 본문 code가
   * CONFIGURATION_CODES(400 INVALID_API_KEY 등)면 같은 축이다. 404·5xx·미지 4xx·
   * 타임아웃은 기존 unknown 규칙 그대로다.
   */
  async function inquireByOrderId(attempt: PaymentAttempt): Promise<OrderInquiry> {
    let inquiry: ProviderResponse;
    try {
      inquiry = await providerFetch(
        `/v1/payments/orders/${encodeURIComponent(attempt.providerOrderId)}`,
        { method: 'GET', timeoutMs: requestTimeoutMs },
      );
    } catch {
      return { kind: 'unavailable' };
    }
    const code = inquiry.parsed ? errorCode(inquiry.payload) : null;
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

  /**
   * confirm이 모호하게 끝났을 때 orderId 조회로 실상태를 확인해 분기한다(스펙:
   * confirm 실패를 즉시 실패로 단정하지 않는다). 조회까지 모호하면 unknown으로
   * 보존해 reconcile(#390)에 넘기고, 키·설정 오류는 needs_review로 격리한다.
   */
  async function recheckByInquiry(
    attempt: PaymentAttempt,
    options: { readonly notFoundOutcome?: 'declined'; readonly notFoundReason?: string } = {},
  ): Promise<ConfirmOutcome> {
    const inquiry = await inquireByOrderId(attempt);
    if (inquiry.kind === 'unavailable') {
      return baseOutcome(attempt, 'unknown', 'provider_unavailable') as ConfirmOutcome;
    }
    if (inquiry.kind === 'not_found') {
      if (options.notFoundOutcome === 'declined') {
        return baseOutcome(
          attempt,
          'declined',
          options.notFoundReason ?? 'provider_payment_not_found',
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
    const payment = inquiry.payment;
    if (payment.status === 'DONE') {
      if (!paymentMatchesAttempt(payment, attempt)) {
        return baseOutcome(attempt, 'needs_review', 'provider_identity_mismatch') as ConfirmOutcome;
      }
      return baseOutcome(
        attempt,
        'approved',
        'provider_approved_after_recheck',
        approvedEvidence(payment),
      ) as ConfirmOutcome;
    }
    if (payment.status === 'ABORTED') {
      return baseOutcome(attempt, 'declined', 'provider_declined', {
        resultCode: 'ABORTED',
      }) as ConfirmOutcome;
    }
    if (payment.status === 'EXPIRED') {
      return baseOutcome(attempt, 'canceled', 'provider_payment_expired', {
        resultCode: 'EXPIRED',
      }) as ConfirmOutcome;
    }
    if (paymentFullyCanceled(payment, attempt)) {
      return baseOutcome(attempt, 'canceled', 'provider_payment_canceled', {
        resultCode: 'CANCELED',
      }) as ConfirmOutcome;
    }
    if (payment.status === 'CANCELED' || payment.status === 'PARTIAL_CANCELED') {
      // 우리는 부분취소를 발행하지 않는다 — 전액 취소 검증(금액·잔액 대조)을
      // 통과하지 못한 취소 상태는 자동 종결하지 않는다.
      return baseOutcome(attempt, 'needs_review', 'provider_cancellation_mismatch') as ConfirmOutcome;
    }
    // READY·IN_PROGRESS 등 비종결 상태는 추측 종결하지 않는다.
    return baseOutcome(attempt, 'unknown', 'provider_payment_in_progress') as ConfirmOutcome;
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
          // 문서 122: "첫 번째 요청이 처리 중일 때 같은 요청을 다시 보내면 HTTP 409 -
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
        return recheckByInquiry(input.attempt);
      }

      if (confirmResult.status === 200) {
        if (!plainRecord(confirmResult.payload) || confirmResult.payload.status !== 'DONE') {
          return baseOutcome(input.attempt, 'unknown', 'provider_invalid_response', {
            providerPaymentKey: paymentKey,
          }) as ConfirmOutcome;
        }
        if (
          !paymentMatchesAttempt(confirmResult.payload, input.attempt)
          || confirmResult.payload.paymentKey !== paymentKey
        ) {
          return baseOutcome(input.attempt, 'needs_review', 'provider_identity_mismatch', {
            providerPaymentKey: paymentKey,
            resultCode: 'DONE_identity_mismatch',
          }) as ConfirmOutcome;
        }
        return baseOutcome(
          input.attempt,
          'approved',
          'provider_approved',
          approvedEvidence(confirmResult.payload),
        ) as ConfirmOutcome;
      }

      const code = errorCode(confirmResult.payload);
      if (code === 'PAY_PROCESS_CANCELED') {
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
        return recheckByInquiry(input.attempt, {
          notFoundOutcome: 'declined',
          notFoundReason: 'provider_session_expired',
        });
      }
      if (code === 'ALREADY_PROCESSED_PAYMENT' || confirmResult.status === 409) {
        // 이미 처리됐다는 신호(중복 콜백) 또는 재요청 뒤에도 409(멱등 처리 중) —
        // 실상태를 조회로 수렴한다.
        return recheckByInquiry(input.attempt);
      }
      if (confirmResult.status >= 500) {
        return recheckByInquiry(input.attempt);
      }
      // 그 밖의 4xx 미지 코드도 추측하지 않고 조회로 확인한다.
      return recheckByInquiry(input.attempt);
    },

    /**
     * 조회 API 기반 자동 정합화(#390). 이 outcome 어휘는 결제 재정합(미종결
     * attempt)과 환불 재정합(reconcileRefund) 두 문맥이 공유한다 — 환불 재정합은
     * 'canceled'를 "원거래 전액 취소 확인"으로 읽어 환불 승인으로 승격하므로,
     * canceled는 전액 취소 검증(paymentFullyCanceled)을 통과했을 때만 돌려주고
     * EXPIRED·미승인 실패 확정은 declined로 돌려준다.
     */
    async reconcile(attempt) {
      assertAttempt(attempt);
      const inquiry = await inquireByOrderId(attempt);
      if (inquiry.kind === 'unavailable') {
        return baseOutcome(attempt, 'unknown', 'provider_unavailable');
      }
      if (inquiry.kind === 'not_found') {
        // orderId 조회는 승인된 결제만 돌려준다. 승인 가능 시한(attempt TTL
        // 안 결제창 오픈 + 결제창 유효 30분 + 인증 후 승인 10분 + 버퍼)이
        // 지난 404는 이 주문으로 승인이 성립할 수 없다는 확정 사실이다 —
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
      const payment = inquiry.payment;
      if (payment.status === 'DONE') {
        if (!paymentMatchesAttempt(payment, attempt)) {
          return baseOutcome(attempt, 'needs_review', 'provider_identity_mismatch');
        }
        return baseOutcome(
          attempt,
          'approved',
          'provider_reconciled_approved',
          approvedEvidence(payment),
        );
      }
      if (paymentFullyCanceled(payment, attempt)) {
        return baseOutcome(
          attempt,
          'canceled',
          'provider_payment_canceled',
          canceledEvidence(payment),
        );
      }
      if (payment.status === 'CANCELED' || payment.status === 'PARTIAL_CANCELED') {
        return baseOutcome(attempt, 'needs_review', 'provider_cancellation_mismatch');
      }
      if (payment.status === 'ABORTED') {
        return baseOutcome(attempt, 'declined', 'provider_declined', { resultCode: 'ABORTED' });
      }
      if (payment.status === 'EXPIRED') {
        return baseOutcome(attempt, 'declined', 'provider_payment_expired', {
          resultCode: 'EXPIRED',
        });
      }
      return baseOutcome(attempt, 'unknown', 'provider_payment_in_progress');
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
      if (
        !safeString(request.reason, 200)
        || !IDEMPOTENCY_KEY.test(request.idempotencyKey)
      ) {
        return baseOutcome(attempt, 'needs_review', 'provider_refund_request_invalid') as RefundOutcome;
      }

      // 취소 결과 판정은 취소 API 응답 body가 아니라 fresh 조회만 진실원으로
      // 삼는다(웹훅 본문 불신과 같은 규율). 이미 전액 취소된 건은 성공으로
      // 수렴하고, 부분취소·잔여 balance는 우리가 만든 상태가 아니므로 격리한다.
      async function inquireForRefund(): Promise<
        | { readonly kind: 'canceled'; readonly payment: Record<string, unknown> }
        | { readonly kind: 'done'; readonly payment: Record<string, unknown> }
        | { readonly kind: 'not_found' }
        | { readonly kind: 'not_refundable' }
        | { readonly kind: 'configuration_error'; readonly code: string }
        | { readonly kind: 'ambiguous' }
      > {
        const inquiry = await inquireByOrderId(attempt);
        if (inquiry.kind === 'unavailable' || inquiry.kind === 'http_error') {
          return { kind: 'ambiguous' };
        }
        if (inquiry.kind === 'not_found') return { kind: 'not_found' };
        if (inquiry.kind === 'configuration_error') {
          return { kind: 'configuration_error', code: inquiry.code };
        }
        const payment = inquiry.payment;
        if (paymentFullyCanceled(payment, attempt)) return { kind: 'canceled', payment };
        if (
          payment.status === 'DONE'
          && payment.orderId === attempt.providerOrderId
          && integerAmount(payment.totalAmount) === attempt.amount
          && safeString(payment.paymentKey, 200)
          && PROVIDER_PAYMENT_KEY.test(payment.paymentKey as string)
        ) {
          return { kind: 'done', payment };
        }
        return { kind: 'not_refundable' };
      }

      const before = await inquireForRefund();
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
