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

const KORPAY_CONFIRM_ENDPOINT = 'https://payments.korpay.com/v1/payments/confirm';
const MAX_CONFIRM_RESPONSE_BYTES = 64 * 1024;
const DEFAULT_CONFIRM_TIMEOUT_MS = 8_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MERCHANT_ID = /^[A-Za-z0-9]{10}$/;
const PROVIDER_ORDER_ID = /^[OT][0-9a-f]{32}$/i;
const PROVIDER_PRODUCT_CODE = /^P[0-9a-f]{32}$/i;
const PROVIDER_REFERENCE = /^[\x21-\x7e]{1,512}$/;
const RESULT_CODE = /^[A-Za-z0-9]{3,8}$/;

interface KorpayGatewayOptions {
  readonly merchantId: string;
  readonly merchantKey: string;
  readonly siteUrl: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly confirmTimeoutMs?: number;
}

class KorpayResponseTooLargeError extends Error {}

function configurationError(): never {
  throw new Error('invalid_korpay_configuration');
}

function validateMerchantKey(value: string) {
  return value.length >= 16
    && value.length <= 256
    && /^[\x21-\x7e]+$/.test(value);
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
    || attempt.provider !== 'korpay'
    || prefix === null
    || attempt.currency !== 'KRW'
    || !Number.isSafeInteger(attempt.amount)
    || attempt.amount < 1_000
    || attempt.amount > 999_999_999_999
    || !PROVIDER_ORDER_ID.test(attempt.providerOrderId)
    || !attempt.providerOrderId.startsWith(prefix)
    || !PROVIDER_PRODUCT_CODE.test(attempt.providerProductCode)
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

function baseOutcome(
  attempt: PaymentAttempt,
  outcome: PaymentOperationOutcome['outcome'],
  reasonCode: string,
  evidence?: PaymentProviderEvidence,
): PaymentOperationOutcome {
  return {
    attemptId: attempt.id,
    provider: 'korpay',
    outcome,
    reasonCode,
    ...(evidence ? { evidence } : {}),
  };
}

function callbackIdentityMatches(
  input: PaymentReturnInput,
  payload: Record<string, unknown>,
  merchantId: string,
  expectedNonce: string,
) {
  return input.providerOrderId === input.attempt.providerOrderId
    && constantTimeEquals(input.callbackNonce, expectedNonce)
    && payload.merchantId === merchantId
    && payload.orderNumber === input.attempt.providerOrderId
    && integerAmount(payload.amount) === input.attempt.amount
    && payload.reserved === input.callbackNonce;
}

function validCard(value: unknown): value is Record<string, unknown> {
  if (!plainRecord(value)) return false;
  return safeString(value.cardNumber, 32)
    && /^[0-9* -]{8,32}$/.test(value.cardNumber)
    && safeString(value.approvalCode, 100)
    && safeString(value.approvalNumber, 100)
    && typeof value.installment === 'string'
    && /^[0-9]{2}$/.test(value.installment);
}

function approvedEvidence(
  payload: Record<string, unknown>,
  paymentKey: string,
): PaymentProviderEvidence {
  const card = payload.card as Record<string, unknown>;
  return {
    providerPaymentKey: paymentKey,
    providerTransactionId: payload.tid as string,
    providerApprovalReference: card.approvalNumber as string,
    resultCode: '3001',
    paymentMethod: 'CARD',
    maskedPaymentMethod: card.cardNumber as string,
  };
}

function confirmIdentityMatches(
  payload: Record<string, unknown>,
  input: PaymentReturnInput,
  merchantId: string,
) {
  return payload.merchantId === merchantId
    && payload.orderNumber === input.attempt.providerOrderId
    && payload.productName === input.attempt.providerProductCode
    && payload.currency === 'KRW'
    && integerAmount(payload.amount) === input.attempt.amount
    && payload.payMethod === 'CARD'
    && payload.reserved === input.callbackNonce
    && safeString(payload.tid, 200)
    && PROVIDER_REFERENCE.test(payload.tid)
    && typeof payload.approvedAt === 'string'
    && /^[0-9]{14}$/.test(payload.approvedAt)
    && validCard(payload.card);
}

async function readBoundedResponse(response: Response) {
  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CONFIRM_RESPONSE_BYTES) {
    throw new KorpayResponseTooLargeError();
  }
  if (!response.body) throw new SyntaxError('missing response body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_CONFIRM_RESPONSE_BYTES) {
      await reader.cancel();
      throw new KorpayResponseTooLargeError();
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

function outcomeFromConfirmResponse(
  input: PaymentReturnInput,
  responsePayload: unknown,
  merchantId: string,
  paymentKey: string,
): ConfirmOutcome {
  if (!plainRecord(responsePayload) || !RESULT_CODE.test(String(responsePayload.resultCode ?? ''))) {
    return baseOutcome(input.attempt, 'unknown', 'provider_invalid_response') as ConfirmOutcome;
  }
  const resultCode = responsePayload.resultCode as string;
  const evidence = { resultCode };
  if (resultCode === '1651' || resultCode === '1681') {
    return baseOutcome(
      input.attempt,
      'needs_review',
      'provider_duplicate_requires_review',
      evidence,
    ) as ConfirmOutcome;
  }
  if (resultCode !== '3001') {
    return baseOutcome(input.attempt, 'declined', 'provider_declined', evidence) as ConfirmOutcome;
  }
  if (!confirmIdentityMatches(responsePayload, input, merchantId)) {
    return baseOutcome(
      input.attempt,
      'needs_review',
      'provider_identity_mismatch',
      evidence,
    ) as ConfirmOutcome;
  }
  return baseOutcome(
    input.attempt,
    'approved',
    'provider_approved',
    approvedEvidence(responsePayload, paymentKey),
  ) as ConfirmOutcome;
}

/**
 * Korpay's published v1.2.2 authentication/confirm contract. The merchant key
 * never leaves this server-only module; only the provider-required digest and
 * opaque MID are placed in the short-lived checkout payload.
 */
export function createKorpayPaymentGateway(options: KorpayGatewayOptions): PaymentGateway {
  const merchantId = options.merchantId;
  const merchantKey = options.merchantKey;
  const siteUrl = normalizeSiteUrl(options.siteUrl);
  if (!MERCHANT_ID.test(merchantId) || !validateMerchantKey(merchantKey)) {
    return configurationError();
  }
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const confirmTimeoutMs = options.confirmTimeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;
  if (!Number.isSafeInteger(confirmTimeoutMs) || confirmTimeoutMs < 100 || confirmTimeoutMs > 60_000) {
    return configurationError();
  }

  function callbackNonce(attempt: PaymentAttempt) {
    return createHmac('sha256', merchantKey)
      .update(`icons:korpay:callback:v1:${attempt.id}:${attempt.providerOrderId}`, 'utf8')
      .digest('base64url');
  }

  return {
    async prepare(attempt): Promise<PreparedCheckout> {
      assertAttempt(attempt);
      const currentTime = now();
      const expiresAt = new Date(attempt.expiresAt);
      // SQL bounds every prepared action to ten minutes. Deriving ediDate from
      // that durable expiry keeps re-prepare byte-stable while the hash remains
      // well inside Korpay's published 30-minute freshness window.
      const issuedAt = new Date(expiresAt.getTime() - 10 * 60_000);
      if (
        !Number.isFinite(currentTime.getTime())
        || expiresAt.getTime() <= currentTime.getTime()
        || issuedAt.getTime() > currentTime.getTime() + 60_000
        || currentTime.getTime() - issuedAt.getTime() >= 30 * 60_000
      ) {
        throw new Error('invalid_payment_attempt');
      }
      const ediDate = kstTimestamp(issuedAt);
      const hashKey = createHash('sha256')
        .update(`${merchantId}${ediDate}${attempt.amount}${merchantKey}`, 'utf8')
        .digest('hex');
      const nonce = callbackNonce(attempt);
      const callbackPath = attempt.purpose === 'order'
        ? '/api/payments/goods/confirm'
        : '/api/payments/tickets/confirm';
      return {
        attemptId: attempt.id,
        provider: 'korpay',
        expiresAt: attempt.expiresAt,
        callbackNonce: nonce,
        action: {
          kind: 'client_sdk',
          payload: {
            merchantId,
            productName: attempt.providerProductCode,
            orderNumber: attempt.providerOrderId,
            amount: attempt.amount,
            payMethod: 'card',
            returnUrl: new URL(callbackPath, siteUrl).toString(),
            ediDate,
            hashKey,
            reserved: nonce,
            language: 'ko',
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
      if (!callbackIdentityMatches(input, input.providerPayload, merchantId, expectedNonce)) {
        return baseOutcome(
          input.attempt,
          'needs_review',
          'provider_identity_mismatch',
        ) as ConfirmOutcome;
      }

      const resultCode = input.providerPayload.resultCode;
      if (resultCode === 'E111') {
        return baseOutcome(
          input.attempt,
          'canceled',
          'provider_user_canceled',
          { resultCode },
        ) as ConfirmOutcome;
      }
      if (resultCode !== '0000') {
        return baseOutcome(
          input.attempt,
          'declined',
          'provider_authentication_failed',
          typeof resultCode === 'string' && RESULT_CODE.test(resultCode) ? { resultCode } : undefined,
        ) as ConfirmOutcome;
      }

      const paymentKey = input.providerPayload.paymentKey;
      if (!safeString(paymentKey) || !PROVIDER_REFERENCE.test(paymentKey)) {
        return baseOutcome(input.attempt, 'needs_review', 'provider_invalid_callback') as ConfirmOutcome;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), confirmTimeoutMs);
      try {
        const confirmUrl = new URL(KORPAY_CONFIRM_ENDPOINT);
        confirmUrl.searchParams.set('paymentKey', paymentKey);
        const response = await fetchImpl(confirmUrl.toString(), {
          method: 'POST',
          headers: { accept: 'application/json' },
          body: undefined,
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!response.ok) {
          return baseOutcome(input.attempt, 'unknown', 'provider_http_error') as ConfirmOutcome;
        }
        const responsePayload = await readBoundedResponse(response);
        return outcomeFromConfirmResponse(input, responsePayload, merchantId, paymentKey);
      } catch {
        return baseOutcome(input.attempt, 'unknown', 'provider_unavailable') as ConfirmOutcome;
      } finally {
        clearTimeout(timeout);
      }
    },

    async reconcile(attempt) {
      assertAttempt(attempt);
      return baseOutcome(
        attempt,
        'needs_review',
        'provider_reconciliation_unavailable',
      );
    },

    async refund(request): Promise<RefundOutcome> {
      assertAttempt(request.attempt);
      if (request.amount !== request.attempt.amount) {
        return baseOutcome(
          request.attempt,
          'needs_review',
          'provider_refund_amount_mismatch',
        ) as RefundOutcome;
      }
      return baseOutcome(
        request.attempt,
        'needs_review',
        'provider_manual_cancellation_required',
      ) as RefundOutcome;
    },
  };
}
