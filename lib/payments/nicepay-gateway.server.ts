import 'server-only';

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type {
  ConfirmOutcome,
  PaymentAttempt,
  PaymentGateway,
  PaymentOperationOutcome,
  PaymentProviderEvidence,
  PaymentReturnInput,
  PreparedCheckout,
  RefundOutcome,
} from './gateway';
import { PARTIAL_CANCEL_UNAVAILABLE_REASON } from './gateway';
import {
  NICEPAY_APPROVE_PATH,
  NICEPAY_CANCEL_URL,
  NICEPAY_INQUIRY_URL,
  NICEPAY_NET_CANCEL_PATH,
  isNicepayCallbackApiUrl,
  isNicepayMerchantId,
  isNicepayMerchantKey,
} from './nicepay-config.mjs';

// 나이스페이 웹표준 인증결제(developers.nicepay.co.kr, 2026-08-03 개편본 기준). 결제창에서
// 인증만 하고, 돈은 서버가 인증 응답의 NextAppURL로 승인 API를 부를 때만 움직인다(인증과
// 승인 분리 — "인증 성공이 승인 성공을 의미하지 않는다"). 승인 응답을 받지 못하면 망취소
// (NetCancelURL)로 되돌린다. 취소는 cancel_process.jsp, 거래조회는 trans_status.jsp이고
// 둘 다 TID 기준이다. 요청은 x-www-form-urlencoded(EUC-KR)이고 이 어댑터가 보내는 값은
// 전부 ASCII라 EUC-KR과 바이트가 같다. 응답은 CharSet=utf-8·EdiType=JSON으로 받는다.
const MAX_RESPONSE_BYTES = 64 * 1024;
// 문서 권장 Read Timeout은 30초다. 승인은 confirm 라우트 예산(maxDuration 60초) 안에서
// 망취소 시한을 남겨야 하므로 25초로 끊는다 — 그 뒤의 망취소가 결과를 정한다.
const APPROVE_TIMEOUT_MS = 25_000;
// 망취소·취소·거래조회 시한. 승인 25초 + 망취소 10초 + DB가 라우트 예산 안에 든다.
const REQUEST_TIMEOUT_MS = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_ORDER_ID = /^O[0-9a-f]{32}$/i;
const PROVIDER_PRODUCT_CODE = /^P[0-9a-f]{32}$/i;
// TID(TxTid) 30byte. DB 기록 RPC(service_record_nicepay_payment_reference)와 같은 형식이다.
const TRANSACTION_ID = /^[A-Za-z0-9]{10,30}$/;
const AUTH_TOKEN = /^[\x21-\x7e]{1,40}$/;
const SIGNATURE = /^[0-9a-fA-F]{64}$/;
const RESULT_CODE = /^[A-Za-z0-9]{4}$/;
// 응답 Amt는 12byte 좌측 0 패딩일 수 있다(승인 API 응답 표).
const RAW_AMOUNT = /^[0-9]{1,12}$/;
const APPROVAL_REFERENCE = /^[\x21-\x7e]{1,30}$/;
const CANCEL_MESSAGE = /^[\x20-\x7e]{1,100}$/;
const FALLBACK_CANCEL_MESSAGE = 'ICONS order cancellation';
// 결제창에 보이는 상품명(GoodsName ≤40byte EUC-KR). 판매 품목은 계약서 제5조의 고지 품목과
// 같아야 하므로 주문 구성을 싣지 않고 서비스 공통 이름만 싣는다.
const GOODS_NAME = 'ICONS 굿즈 주문';

const APPROVED_CODE = '3001';
// 결제창 인증 결과코드 — 구매자가 결제창에서 그만둔 경우.
const USER_CANCELED_AUTH_CODES = new Set(['I002', '9993']);
// 승인 공통 결과코드의 중복·재사용 계열. 이 attempt의 콜백은 claim이 한 번만 승인 API로
// 보내므로 정상 경로에서는 나오지 않는다 — 추측하지 않고 운영 판단에 태운다.
const DUPLICATE_APPROVE_CODES = new Set(['1621', '1622', '1651', '1681', '1682']);
// 승인이 성립했는지 응답만으로 알 수 없는 코드(카드사 타임아웃·지연·예외·통신 오류).
// 문서의 망취소 조건("승인 응답 데이터를 정상적으로 받지 못했을 때")과 같이 다룬다.
const AMBIGUOUS_APPROVE_CODES = new Set([
  '1620', 'A299', '9002', 'A213', 'A226', 'A300', 'A304', 'A306', 'A400', 'A401', 'A402', 'A403',
  'X001', 'X002', 'X003', 'X004', 'T001', 'T002', 'T003', 'T004', 'T005', 'S001', 'S002', 'S999',
]);
// 키·상점 설정이 틀렸다는 신호(API 공통·승인 공통 결과코드). 자동 종결하면 오류가 침묵하므로
// needs_review로 격리해 운영 관측에 태운다.
const CONFIGURATION_CODES = new Set([
  'A101', 'A109', 'A114', 'A117', 'A122', 'A204', 'A205', 'A211', 'A252', 'A305',
  'V201', 'V204', '9000', '9001', '1641', '1642',
]);
const CANCEL_SUCCESS_CODES = new Set(['2001', '2211']);
// 이미 취소된 거래(승인 취소 결과코드 2013 취소 완료 거래·2015 기취소성공·2219 환불 완료 거래).
const CANCEL_ALREADY_CODES = new Set(['2013', '2015', '2219']);
// 처리 중이거나 재취소를 요구하는 코드 — 결과는 거래조회가 정한다.
const CANCEL_PENDING_CODES = new Set(['2002', '2056', '2212', '2225']);
// 망취소가 되돌릴 승인이 없다고 답한 코드(취소 해당거래 없음·조회 결과 없음).
const NET_CANCEL_ABSENT_CODES = new Set(['2012', 'A118', 'A214', 'A251']);
const INQUIRY_NOT_FOUND_CODES = new Set(['A118', 'A214', 'A251']);

export interface NicepayPaymentReferenceStore {
  /**
   * 승인 API를 부르기 전에 이 attempt의 TID를 남긴다. 실패하면 throw한다 — 어댑터는
   * 기록에 실패하면 승인 API를 부르지 않는다("TID 기록 없음 = 승인 호출 없음").
   */
  record(attemptId: string, transactionId: string): Promise<void>;
  /** 이 attempt에 남은 TID 목록(중복 없음). */
  list(attemptId: string): Promise<readonly string[]>;
}

interface NicepayGatewayOptions {
  readonly merchantId: string;
  readonly merchantKey: string;
  readonly siteUrl: string;
  readonly references: NicepayPaymentReferenceStore;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  /** 승인 POST 시한(ms). 기본 25초, 100ms~60초. */
  readonly approveTimeoutMs?: number;
  /** 망취소·취소·거래조회 시한(ms). 기본 10초, 100ms~60초. */
  readonly requestTimeoutMs?: number;
}

class NicepayResponseTooLargeError extends Error {}

type NicepayResponse =
  | { readonly kind: 'ok'; readonly payload: Record<string, unknown> }
  | { readonly kind: 'unavailable' };

type TransactionInquiry =
  | { readonly kind: 'approved' }
  | { readonly kind: 'canceled' }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'configuration_error'; readonly code: string }
  | { readonly kind: 'identity_mismatch' }
  | { readonly kind: 'unavailable' };

function configurationError(): never {
  throw new Error('invalid_nicepay_configuration');
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

/**
 * 나이스페이 계약 품목은 판매 제한 굿즈다 — 티켓 attempt는 받지 않는다(티켓 gate는 닫혀 있다).
 * 최소 금액 1,000원은 DB 트리거(orders_korpay_minimum_amount, provider 무관)와 같다.
 */
function assertAttempt(attempt: PaymentAttempt) {
  if (
    !UUID.test(attempt.id)
    || attempt.provider !== 'nicepay'
    || attempt.purpose !== 'order'
    || attempt.currency !== 'KRW'
    || !Number.isSafeInteger(attempt.amount)
    || attempt.amount < 1_000
    || attempt.amount > 999_999_999_999
    || !PROVIDER_ORDER_ID.test(attempt.providerOrderId)
    || !PROVIDER_PRODUCT_CODE.test(attempt.providerProductCode)
    || !UUID.test(attempt.refId)
    || !Number.isFinite(Date.parse(attempt.expiresAt))
  ) {
    throw new Error('invalid_payment_attempt');
  }
}

function kstTimestamp(date: Date) {
  if (!Number.isFinite(date.getTime())) configurationError();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = new Map(parts.map((part) => [part.type, part.value]));
  return `${value.get('year')}${value.get('month')}${value.get('day')}${value.get('hour')}${value.get('minute')}${value.get('second')}`;
}

/** 승인일시 AuthDate(YYMMDDHHMISS, 일부 응답은 YYYYMMDDHHMISS) KST → ISO. */
function authDateIso(value: unknown) {
  if (typeof value !== 'string' || !/^(?:[0-9]{12}|[0-9]{14})$/.test(value)) return null;
  const full = value.length === 12 ? `20${value}` : value;
  const localIso = `${full.slice(0, 4)}-${full.slice(4, 6)}-${full.slice(6, 8)}`
    + `T${full.slice(8, 10)}:${full.slice(10, 12)}:${full.slice(12, 14)}+09:00`;
  const date = new Date(localIso);
  if (!Number.isFinite(date.getTime()) || kstTimestamp(date) !== full) return null;
  return date.toISOString();
}

function plainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function stringField(payload: Record<string, unknown>, field: string) {
  const value = payload[field];
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return null;
}

function rawAmount(value: string | null) {
  if (value === null || !RAW_AMOUNT.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) ? amount : null;
}

function constantTimeEquals(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function sha256Hex(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function signatureMatches(received: string | null, expected: string) {
  return received !== null
    && SIGNATURE.test(received)
    && constantTimeEquals(received.toLowerCase(), expected);
}

function resultCode(payload: Record<string, unknown>) {
  const code = stringField(payload, 'ResultCode');
  return code !== null && RESULT_CODE.test(code) ? code : null;
}

function baseOutcome(
  attempt: PaymentAttempt,
  outcome: PaymentOperationOutcome['outcome'],
  reasonCode: string,
  evidence?: PaymentProviderEvidence,
): PaymentOperationOutcome {
  return {
    attemptId: attempt.id,
    provider: 'nicepay',
    outcome,
    reasonCode,
    ...(evidence ? { evidence } : {}),
  };
}

function transactionEvidence(transactionId: string, code?: string): PaymentProviderEvidence {
  return {
    providerPaymentKey: transactionId,
    providerTransactionId: transactionId,
    ...(code ? { resultCode: code } : {}),
  };
}

async function readBoundedJson(response: Response) {
  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new NicepayResponseTooLargeError();
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
      throw new NicepayResponseTooLargeError();
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // CharSet=utf-8을 요청하지만, 응답이 기본값(EUC-KR)으로 오더라도 판정에 쓰는 필드는
  // 전부 ASCII라 EUC-KR로 다시 읽으면 된다. 한글 메시지는 판정에 쓰지 않는다.
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(joined);
  } catch {
    text = new TextDecoder('euc-kr').decode(joined);
  }
  return JSON.parse(text) as unknown;
}

/**
 * 나이스페이 웹표준 인증결제 어댑터. MerchantKey는 이 server-only 모듈의 클로저 밖으로
 * 나가지 않는다 — 브라우저에는 결제창이 요구하는 SignData(해시)와 MID만 싣는다.
 */
export function createNicepayPaymentGateway(options: NicepayGatewayOptions): PaymentGateway {
  const merchantId = options.merchantId;
  const merchantKey = options.merchantKey;
  const siteUrl = normalizeSiteUrl(options.siteUrl);
  if (!isNicepayMerchantId(merchantId) || !isNicepayMerchantKey(merchantKey)) {
    return configurationError();
  }
  const references = options.references;
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const approveTimeoutMs = timeoutOption(options.approveTimeoutMs, APPROVE_TIMEOUT_MS);
  const requestTimeoutMs = timeoutOption(options.requestTimeoutMs, REQUEST_TIMEOUT_MS);

  function callbackNonce(attempt: PaymentAttempt) {
    return createHmac('sha256', merchantKey)
      .update(`icons:nicepay:callback:v1:${attempt.id}:${attempt.providerOrderId}`, 'utf8')
      .digest('base64url');
  }

  /**
   * 폼 POST 저수준 계층. 전송 실패(타임아웃·네트워크·과대 응답)와 JSON이 아닌 응답,
   * 200이 아닌 상태는 모두 unavailable이다 — 이 응답으로는 무엇도 확정할 수 없다.
   */
  async function providerPost(url: string, fields: Record<string, string>, timeoutMs: number): Promise<NicepayResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ ...fields, CharSet: 'utf-8', EdiType: 'JSON' }).toString(),
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      });
      if (response.status !== 200) return { kind: 'unavailable' };
      const payload = await readBoundedJson(response);
      return plainRecord(payload) ? { kind: 'ok', payload } : { kind: 'unavailable' };
    } catch {
      return { kind: 'unavailable' };
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * 거래조회(trans_status.jsp). TID의 승인·취소 여부만 돌려준다(Status 0 승인·1 취소·
   * 9 거래 없음) — 주문번호·금액은 응답에 없으므로 이 조회만으로 "이 주문의 결제"임을
   * 증명할 수 없다. 호출자는 이 결과로 승인을 확정하지 않는다.
   */
  async function inquire(transactionId: string): Promise<TransactionInquiry> {
    const ediDate = kstTimestamp(now());
    const result = await providerPost(NICEPAY_INQUIRY_URL, {
      TID: transactionId,
      MID: merchantId,
      EdiDate: ediDate,
      SignData: sha256Hex(`${transactionId}${merchantId}${ediDate}${merchantKey}`),
    }, requestTimeoutMs);
    if (result.kind !== 'ok') return { kind: 'unavailable' };
    const code = resultCode(result.payload);
    if (code === null) return { kind: 'unavailable' };
    if (INQUIRY_NOT_FOUND_CODES.has(code)) return { kind: 'not_found' };
    if (CONFIGURATION_CODES.has(code)) return { kind: 'configuration_error', code };
    if (code !== '0000') return { kind: 'unavailable' };
    const responseTid = stringField(result.payload, 'TID');
    if (responseTid !== null && responseTid !== '' && responseTid !== transactionId) {
      return { kind: 'identity_mismatch' };
    }
    const status = stringField(result.payload, 'Status');
    if (status === '0') return { kind: 'approved' };
    if (status === '1') return { kind: 'canceled' };
    if (status === '9') return { kind: 'not_found' };
    return { kind: 'unavailable' };
  }

  /**
   * 망취소 — 승인 응답을 정상적으로 받지 못했을 때 문서가 정한 되돌리기다. 되돌렸거나
   * 되돌릴 승인이 없다고 확인되면 declined, 그 밖에는 unknown으로 남겨 재정합에 넘긴다.
   */
  async function netCancel(
    attempt: PaymentAttempt,
    callback: { readonly transactionId: string; readonly authToken: string; readonly netCancelUrl: string },
    approveCode: string | null,
  ): Promise<ConfirmOutcome> {
    const amount = String(attempt.amount);
    const ediDate = kstTimestamp(now());
    const result = await providerPost(callback.netCancelUrl, {
      TID: callback.transactionId,
      AuthToken: callback.authToken,
      MID: merchantId,
      Amt: amount,
      EdiDate: ediDate,
      NetCancel: '1',
      SignData: sha256Hex(`${callback.authToken}${merchantId}${amount}${ediDate}${merchantKey}`),
    }, requestTimeoutMs);
    const pending = baseOutcome(
      attempt,
      'unknown',
      'provider_unavailable',
      transactionEvidence(callback.transactionId, approveCode ?? 'approve_unanswered'),
    ) as ConfirmOutcome;
    if (result.kind !== 'ok') return pending;
    const code = resultCode(result.payload);
    if (code === null) return pending;
    if (code === '2001') {
      const responseTid = stringField(result.payload, 'TID');
      const canceledAmount = stringField(result.payload, 'CancelAmt');
      if (
        responseTid !== callback.transactionId
        || rawAmount(canceledAmount) !== attempt.amount
        || !signatureMatches(
          stringField(result.payload, 'Signature'),
          sha256Hex(`${callback.transactionId}${merchantId}${canceledAmount}${merchantKey}`),
        )
      ) {
        return pending;
      }
      return baseOutcome(
        attempt,
        'declined',
        'provider_net_canceled',
        transactionEvidence(callback.transactionId, code),
      ) as ConfirmOutcome;
    }
    if (NET_CANCEL_ABSENT_CODES.has(code) || CANCEL_ALREADY_CODES.has(code)) {
      return baseOutcome(
        attempt,
        'declined',
        'provider_net_canceled',
        transactionEvidence(callback.transactionId, code),
      ) as ConfirmOutcome;
    }
    return pending;
  }

  function settleApproved(
    attempt: PaymentAttempt,
    payload: Record<string, unknown>,
    transactionId: string,
  ): ConfirmOutcome {
    const responseTid = stringField(payload, 'TID');
    const responseAmount = stringField(payload, 'Amt');
    const approvedAt = authDateIso(stringField(payload, 'AuthDate'));
    if (
      responseTid !== transactionId
      || stringField(payload, 'MID') !== merchantId
      || stringField(payload, 'Moid') !== attempt.providerOrderId
      || rawAmount(responseAmount) !== attempt.amount
      || stringField(payload, 'PayMethod') !== 'CARD'
      || approvedAt === null
      || !signatureMatches(
        stringField(payload, 'Signature'),
        sha256Hex(`${transactionId}${merchantId}${responseAmount}${merchantKey}`),
      )
    ) {
      return baseOutcome(
        attempt,
        'needs_review',
        'provider_identity_mismatch',
        transactionEvidence(transactionId, `${APPROVED_CODE}_identity_mismatch`),
      ) as ConfirmOutcome;
    }
    const approvalReference = stringField(payload, 'AuthCode');
    const cardNumber = stringField(payload, 'CardNo')?.replace(/[ -]/g, '') ?? null;
    return baseOutcome(attempt, 'approved', 'provider_approved', {
      providerPaymentKey: transactionId,
      providerTransactionId: transactionId,
      ...(approvalReference && APPROVAL_REFERENCE.test(approvalReference)
        ? { providerApprovalReference: approvalReference }
        : {}),
      resultCode: APPROVED_CODE,
      paymentMethod: 'CARD',
      ...(cardNumber && /^[0-9*]{4,20}$/.test(cardNumber) ? { maskedPaymentMethod: cardNumber } : {}),
      approvedAt,
    }) as ConfirmOutcome;
  }

  return {
    async prepare(attempt): Promise<PreparedCheckout> {
      assertAttempt(attempt);
      const currentTime = now();
      const expiresAt = new Date(attempt.expiresAt);
      // SQL은 카드 attempt를 최대 10분으로 묶는다. EdiDate를 그 만료에서 파생하면 같은
      // attempt의 재-prepare가 바이트 단위로 같은 SignData를 만든다(korpay와 같은 규율).
      const issuedAt = new Date(expiresAt.getTime() - 10 * 60_000);
      if (
        !Number.isFinite(currentTime.getTime())
        || expiresAt.getTime() <= currentTime.getTime()
        || issuedAt.getTime() > currentTime.getTime() + 60_000
      ) {
        throw new Error('invalid_payment_attempt');
      }
      const ediDate = kstTimestamp(issuedAt);
      const amount = String(attempt.amount);
      const nonce = callbackNonce(attempt);
      return {
        attemptId: attempt.id,
        provider: 'nicepay',
        expiresAt: attempt.expiresAt,
        callbackNonce: nonce,
        action: {
          kind: 'client_sdk',
          payload: {
            provider: 'nicepay',
            GoodsName: GOODS_NAME,
            Amt: amount,
            MID: merchantId,
            EdiDate: ediDate,
            Moid: attempt.providerOrderId,
            SignData: sha256Hex(`${ediDate}${merchantId}${amount}${merchantKey}`),
            PayMethod: 'CARD',
            // 모바일은 인증 결과를 이 주소로 POST하고, PC는 nicepaySubmit()이 결제 폼을
            // 같은 주소로 submit한다.
            ReturnURL: new URL('/api/payments/goods/confirm/nicepay', siteUrl).toString(),
            // 가맹점 여분 필드는 인증 응답에 그대로 돌아온다 — 단회용 callback nonce를 싣는다.
            ReqReserved: nonce,
            CharSet: 'utf-8',
          },
        },
      };
    },

    async confirm(input: PaymentReturnInput): Promise<ConfirmOutcome> {
      assertAttempt(input.attempt);
      const attempt = input.attempt;
      if (!plainRecord(input.providerPayload)) {
        return baseOutcome(attempt, 'needs_review', 'provider_invalid_callback') as ConfirmOutcome;
      }
      const payload = input.providerPayload;
      const expectedNonce = callbackNonce(attempt);
      // 인증 응답은 구매자 브라우저가 실어 온다. 금액·주문번호·상점·nonce가 서버의 attempt와
      // 다르면 승인 API를 부르지 않는다.
      if (
        input.providerOrderId !== attempt.providerOrderId
        || !constantTimeEquals(input.callbackNonce, expectedNonce)
        || stringField(payload, 'ReqReserved') !== input.callbackNonce
        || stringField(payload, 'MID') !== merchantId
        || stringField(payload, 'Moid') !== attempt.providerOrderId
        || rawAmount(stringField(payload, 'Amt')) !== attempt.amount
      ) {
        return baseOutcome(attempt, 'needs_review', 'provider_identity_mismatch') as ConfirmOutcome;
      }

      const authResultCode = stringField(payload, 'AuthResultCode');
      if (authResultCode !== '0000') {
        const evidence = authResultCode !== null && RESULT_CODE.test(authResultCode)
          ? { resultCode: authResultCode }
          : undefined;
        // 인증이 성공하지 않았으면 승인 API를 부르지 않으므로 돈은 움직이지 않았다.
        if (authResultCode !== null && USER_CANCELED_AUTH_CODES.has(authResultCode)) {
          return baseOutcome(attempt, 'canceled', 'provider_user_canceled', evidence) as ConfirmOutcome;
        }
        return baseOutcome(attempt, 'declined', 'provider_authentication_failed', evidence) as ConfirmOutcome;
      }

      const authToken = stringField(payload, 'AuthToken');
      const transactionId = stringField(payload, 'TxTid');
      const callbackAmount = stringField(payload, 'Amt');
      const nextAppUrl = stringField(payload, 'NextAppURL');
      const netCancelUrl = stringField(payload, 'NetCancelURL');
      if (
        authToken === null
        || !AUTH_TOKEN.test(authToken)
        || transactionId === null
        || !TRANSACTION_ID.test(transactionId)
        || stringField(payload, 'PayMethod') !== 'CARD'
        || !isNicepayCallbackApiUrl(nextAppUrl, NICEPAY_APPROVE_PATH)
        || !isNicepayCallbackApiUrl(netCancelUrl, NICEPAY_NET_CANCEL_PATH)
      ) {
        return baseOutcome(attempt, 'needs_review', 'provider_invalid_callback') as ConfirmOutcome;
      }
      // 인증 응답 위변조 검증: hex(sha256(AuthToken + MID + Amt + MerchantKey)).
      if (!signatureMatches(
        stringField(payload, 'Signature'),
        sha256Hex(`${authToken}${merchantId}${callbackAmount}${merchantKey}`),
      )) {
        return baseOutcome(attempt, 'needs_review', 'provider_identity_mismatch') as ConfirmOutcome;
      }

      // TID를 먼저 남긴다. 거래조회·취소가 TID로만 되므로, 기록이 없는 승인은 재정합이 찾을
      // 수 없다. 기록이 실패하면 승인 API를 부르지 않는다 — 인증만 된 거래는 돈이 움직이지
      // 않는다.
      try {
        await references.record(attempt.id, transactionId);
      } catch {
        return baseOutcome(attempt, 'unknown', 'provider_reference_unrecorded') as ConfirmOutcome;
      }

      const amount = String(attempt.amount);
      const ediDate = kstTimestamp(now());
      const approval = await providerPost(nextAppUrl as string, {
        TID: transactionId,
        AuthToken: authToken,
        MID: merchantId,
        Amt: amount,
        EdiDate: ediDate,
        SignData: sha256Hex(`${authToken}${merchantId}${amount}${ediDate}${merchantKey}`),
      }, approveTimeoutMs);
      const callback = { transactionId, authToken, netCancelUrl: netCancelUrl as string };
      if (approval.kind !== 'ok') return netCancel(attempt, callback, null);
      const code = resultCode(approval.payload);
      if (code === null) return netCancel(attempt, callback, null);
      if (code === APPROVED_CODE) return settleApproved(attempt, approval.payload, transactionId);
      if (DUPLICATE_APPROVE_CODES.has(code)) {
        return baseOutcome(
          attempt,
          'needs_review',
          'provider_duplicate_requires_review',
          transactionEvidence(transactionId, code),
        ) as ConfirmOutcome;
      }
      if (CONFIGURATION_CODES.has(code)) {
        return baseOutcome(
          attempt,
          'needs_review',
          'provider_configuration_error',
          transactionEvidence(transactionId, code),
        ) as ConfirmOutcome;
      }
      if (AMBIGUOUS_APPROVE_CODES.has(code)) return netCancel(attempt, callback, code);
      // 카드사 거절·금액 오류 등 확정된 승인 실패.
      return baseOutcome(
        attempt,
        'declined',
        'provider_declined',
        transactionEvidence(transactionId, code),
      ) as ConfirmOutcome;
    },

    /**
     * 모호하게 끝난 attempt의 재정합. 웹표준 거래조회는 TID 기준이고 주문번호·금액을 돌려주지
     * 않는다. 그래서 조회가 '승인'이면 자동 승인하지 않는다 — 콜백이 실어 온 TID는 다른 주문의
     * 것일 수 있다. 운영자가 가맹점관리자에서 주문번호로 확인해 취소하면 다음 재정합이
     * '취소'를 보고 닫는다.
     */
    async reconcile(attempt) {
      assertAttempt(attempt);
      let transactionIds: readonly string[];
      try {
        transactionIds = await references.list(attempt.id);
      } catch {
        return baseOutcome(attempt, 'unknown', 'provider_reference_unavailable');
      }
      const valid = [...new Set(transactionIds)].filter((value) => TRANSACTION_ID.test(value));
      if (valid.length !== transactionIds.length || valid.length > 1) {
        return baseOutcome(attempt, 'needs_review', 'provider_reference_ambiguous');
      }
      if (valid.length === 0) {
        // 어댑터는 TID 기록에 성공해야만 승인 API를 부른다. 기록이 없으면 승인 호출도 없었다.
        return baseOutcome(attempt, 'declined', 'provider_payment_absent');
      }
      const transactionId = valid[0]!;
      const inquiry = await inquire(transactionId);
      if (inquiry.kind === 'unavailable') {
        return baseOutcome(attempt, 'unknown', 'provider_unavailable', transactionEvidence(transactionId));
      }
      if (inquiry.kind === 'configuration_error') {
        return baseOutcome(
          attempt,
          'needs_review',
          'provider_configuration_error',
          transactionEvidence(transactionId, inquiry.code),
        );
      }
      if (inquiry.kind === 'identity_mismatch') {
        return baseOutcome(attempt, 'needs_review', 'provider_identity_mismatch', transactionEvidence(transactionId));
      }
      if (inquiry.kind === 'canceled') {
        // 망취소·가맹점관리자 취소로 되돌려진 거래 — 이 주문의 매출로 남지 않는다.
        return baseOutcome(attempt, 'declined', 'provider_payment_canceled', transactionEvidence(transactionId, 'Status_1'));
      }
      if (inquiry.kind === 'not_found') {
        // 승인 가능 시한(attempt TTL + 결제창·승인 지연 여유)이 지난 '거래 없음'은 승인이
        // 성립하지 않았다는 확정 사실이다. 그 전에는 조회가 뒤처졌을 수 있다.
        const absentAfter = Date.parse(attempt.expiresAt) + 45 * 60_000;
        if (Number.isFinite(absentAfter) && now().getTime() > absentAfter) {
          return baseOutcome(attempt, 'declined', 'provider_payment_absent', transactionEvidence(transactionId, 'Status_9'));
        }
        return baseOutcome(attempt, 'unknown', 'provider_inquiry_not_found', transactionEvidence(transactionId, 'Status_9'));
      }
      return baseOutcome(
        attempt,
        'needs_review',
        'provider_approval_unverified',
        transactionEvidence(transactionId, 'Status_0'),
      );
    },

    /**
     * 승인된 결제의 전액 취소. 대상 TID는 로컬 원장의 payment_key다(승인 응답 서명으로
     * 검증해 기록한 값). 판정은 취소 응답과 취소 뒤 거래조회를 함께 본다 — 취소 응답만
     * 믿지 않고, 조회만으로는 전액·부분을 가를 수 없어서다(부분취소는 발행하지 않는다).
     */
    async refund(request): Promise<RefundOutcome> {
      assertAttempt(request.attempt);
      const attempt = request.attempt;
      /*
       * 부분 취소는 받지 않는다(ADR-0031). 나이스페이 부분 취소 계약 전이고, 거래조회(trans_status)가 승인·취소 여부만
       * 돌려줘 취소 뒤 잔액을 조회로 검증할 수 없다. 돈을 움직이지 않고 돌려주므로 호출자는 전액 환불로 돌린다.
       */
      if (request.partial !== undefined) {
        return baseOutcome(attempt, 'declined', PARTIAL_CANCEL_UNAVAILABLE_REASON, {
          resultCode: 'partial_cancel_contract_pending',
        }) as RefundOutcome;
      }
      if (request.amount !== attempt.amount) {
        return baseOutcome(attempt, 'needs_review', 'provider_refund_amount_mismatch') as RefundOutcome;
      }
      const transactionId = request.providerPaymentKey;
      if (typeof transactionId !== 'string' || !TRANSACTION_ID.test(transactionId)) {
        return baseOutcome(attempt, 'needs_review', 'provider_refund_request_invalid') as RefundOutcome;
      }
      const evidence = transactionEvidence(transactionId);

      const before = await inquire(transactionId);
      if (before.kind === 'unavailable') {
        return baseOutcome(attempt, 'unknown', 'provider_unavailable', evidence) as RefundOutcome;
      }
      if (before.kind === 'configuration_error') {
        return baseOutcome(attempt, 'needs_review', 'provider_configuration_error', {
          ...evidence,
          resultCode: before.code,
        }) as RefundOutcome;
      }
      if (before.kind === 'identity_mismatch') {
        return baseOutcome(attempt, 'needs_review', 'provider_identity_mismatch', evidence) as RefundOutcome;
      }
      if (before.kind === 'not_found') {
        return baseOutcome(attempt, 'needs_review', 'provider_payment_not_found', evidence) as RefundOutcome;
      }

      const cancelAmount = String(attempt.amount);
      const ediDate = kstTimestamp(now());
      const cancelMessage = CANCEL_MESSAGE.test(request.reason) ? request.reason : FALLBACK_CANCEL_MESSAGE;
      const cancel = await providerPost(NICEPAY_CANCEL_URL, {
        TID: transactionId,
        MID: merchantId,
        Moid: attempt.providerOrderId,
        CancelAmt: cancelAmount,
        CancelMsg: cancelMessage,
        PartialCancelCode: '0',
        EdiDate: ediDate,
        SignData: sha256Hex(`${merchantId}${cancelAmount}${ediDate}${merchantKey}`),
      }, requestTimeoutMs);

      let cancelState: 'succeeded' | 'already' | 'ambiguous' = 'ambiguous';
      if (cancel.kind === 'ok') {
        const code = resultCode(cancel.payload);
        if (code !== null && CANCEL_SUCCESS_CODES.has(code)) {
          const responseTid = stringField(cancel.payload, 'TID');
          const canceledAmount = stringField(cancel.payload, 'CancelAmt');
          if (
            responseTid !== transactionId
            || rawAmount(canceledAmount) !== attempt.amount
            || !signatureMatches(
              stringField(cancel.payload, 'Signature'),
              sha256Hex(`${transactionId}${merchantId}${canceledAmount}${merchantKey}`),
            )
          ) {
            return baseOutcome(attempt, 'needs_review', 'provider_identity_mismatch', {
              ...evidence,
              resultCode: `${code}_identity_mismatch`,
            }) as RefundOutcome;
          }
          cancelState = 'succeeded';
        } else if (code !== null && CANCEL_ALREADY_CODES.has(code)) {
          cancelState = 'already';
        } else if (code !== null && CONFIGURATION_CODES.has(code)) {
          return baseOutcome(attempt, 'needs_review', 'provider_configuration_error', {
            ...evidence,
            resultCode: code,
          }) as RefundOutcome;
        } else if (code !== null && /^2[0-9]{3}$/.test(code) && !CANCEL_PENDING_CODES.has(code)) {
          // 취소 기한 초과·부분취소 불가·금액 불일치 등 — 재시도해도 같은 결과다.
          return baseOutcome(attempt, 'needs_review', 'provider_cancel_rejected', {
            ...evidence,
            resultCode: code,
          }) as RefundOutcome;
        }
      }

      const after = await inquire(transactionId);
      if (after.kind === 'canceled') {
        // 취소가 성공했다고 답했거나 이미 취소된 거래라고 답한 경우, 또는 취소 직전 조회가
        // '승인'이었고 우리가 전액 취소를 보낸 뒤 '취소'가 된 경우만 전액 취소로 인정한다.
        if (cancelState !== 'ambiguous' || before.kind === 'approved') {
          return {
            ...baseOutcome(attempt, 'approved', 'provider_cancel_confirmed', {
              ...evidence,
              resultCode: 'Status_1',
            }),
            refundedAmount: attempt.amount,
          } as RefundOutcome;
        }
        return baseOutcome(attempt, 'unknown', 'provider_cancel_ambiguous', evidence) as RefundOutcome;
      }
      if (after.kind === 'approved') {
        return baseOutcome(
          attempt,
          cancelState === 'succeeded' ? 'needs_review' : 'unknown',
          cancelState === 'succeeded' ? 'provider_cancellation_incomplete' : 'provider_cancel_ambiguous',
          evidence,
        ) as RefundOutcome;
      }
      if (after.kind === 'configuration_error') {
        return baseOutcome(attempt, 'needs_review', 'provider_configuration_error', {
          ...evidence,
          resultCode: after.code,
        }) as RefundOutcome;
      }
      if (after.kind === 'identity_mismatch') {
        return baseOutcome(attempt, 'needs_review', 'provider_identity_mismatch', evidence) as RefundOutcome;
      }
      if (after.kind === 'not_found') {
        return baseOutcome(attempt, 'needs_review', 'provider_payment_not_found', evidence) as RefundOutcome;
      }
      return baseOutcome(attempt, 'unknown', 'provider_unavailable', evidence) as RefundOutcome;
    },
  };
}
