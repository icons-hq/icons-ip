import 'server-only';

import { isUuid } from '../uuid';
import type { PaymentOperationOutcome, PaymentProviderEvidence, RefundOutcome } from '../payments/gateway';
import type { BillingProfileRegistry } from './billing-profiles.server';
import {
  assertBoundBillingAttempt, billingCardDisplay, billingInstant, billingOpaque, billingOutcome,
  billingProfileValid, billingRecord, billingVersion, billingWriteRecoverable,
  type BillingProfileIdentity, type BoundBillingAttempt, type RecurringBilling,
} from './billing-types.server';

// 2026-10-14 공식 자동결제/코어 API 확인. URL·시크릿·provider 본문은 로그에 남기지 않는다.
const API_ORIGIN = 'https://api.tosspayments.com';
const MAX_RESPONSE_BYTES = 64 * 1024;
export const BILLING_CHARGE_TIMEOUT_MS = 60_000;
export const BILLING_ROUTE_MAX_DURATION_SECONDS = 90;
const READ_TIMEOUT_MS = 8_000;
const REFUND_TIMEOUT_MS = 15_000;

const DECLINED = new Set(['REJECT_CARD_COMPANY', 'REJECT_CARD_PAYMENT', 'INVALID_STOPPED_CARD', 'INVALID_CARD',
  'INVALID_CARD_NUMBER', 'INVALID_CARD_EXPIRATION', 'INVALID_CARD_PASSWORD', 'INVALID_CARD_IDENTITY',
  'EXCEED_MAX_PAYMENT_AMOUNT', 'EXCEED_MAX_AMOUNT', 'BELOW_MINIMUM_AMOUNT', 'NOT_SUPPORTED_CARD_TYPE']);
const REGISTRATION_DECLINED = new Set(['INVALID_AUTH_KEY', 'EXPIRED_AUTH_KEY', 'NOT_FOUND_AUTH_KEY',
  'INVALID_CARD', 'INVALID_CARD_NUMBER', 'INVALID_CARD_EXPIRATION', 'INVALID_CARD_IDENTITY']);
const CONFIGURATION = new Set(['UNAUTHORIZED_KEY', 'INVALID_API_KEY', 'FORBIDDEN_REQUEST', 'API_KEY_ACCESS_DENIED',
  'NOT_SUPPORTED_METHOD', 'NOT_MATCHES_CUSTOMER_KEY', 'DUPLICATED_ORDER_ID', 'INVALID_ORDER_ID']);

interface ProviderResponse { status: number; payload: unknown; empty: boolean; parsed: boolean }

async function responseBody(response: Response): Promise<Omit<ProviderResponse, 'status'>> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > MAX_RESPONSE_BYTES) { await response.body?.cancel(); throw new Error('billing_response_invalid'); }
  if (!response.body) return { payload: undefined, empty: true, parsed: false };
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error('billing_response_invalid'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) return { payload: undefined, empty: true, parsed: false };
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return { payload: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), empty: false, parsed: true }; }
  catch { return { payload: undefined, empty: false, parsed: false }; }
}

function providerCode(response: ProviderResponse): string | null {
  const value = billingRecord(response.payload) ? response.payload.code : null;
  return typeof value === 'string' && /^[A-Z0-9_]{2,64}$/.test(value) ? value : null;
}

function configurationFailure(response: ProviderResponse): boolean {
  const code = providerCode(response);
  return response.status === 401 || response.status === 403 || (code !== null && CONFIGURATION.has(code));
}

function amount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 999_999_999_999;
}

function timestamp(value: unknown, now: Date): string | null {
  return billingInstant(value) && Date.parse(value) <= now.getTime() + 300_000 ? new Date(value).toISOString() : null;
}

function evidence(payment: Record<string, unknown>, now: Date): PaymentProviderEvidence | null {
  const card = billingCardDisplay(payment.card); const approvedAt = timestamp(payment.approvedAt, now);
  if (!card || !approvedAt || !billingOpaque(payment.paymentKey) || !billingOpaque(payment.lastTransactionKey, 64)
    || !billingRecord(payment.card) || !billingOpaque(payment.card.approveNo, 8)) return null;
  return { providerPaymentKey: payment.paymentKey, providerTransactionId: payment.lastTransactionKey,
    providerApprovalReference: payment.card.approveNo, resultCode: 'DONE', paymentMethod: '카드',
    maskedPaymentMethod: card.number, approvedAt };
}

/** 승인/조회/환급이 같은 identity 검사에 의존한다. 카드·BILLING·MID를 생략하지 않는다. */
function matches(payment: Record<string, unknown>, bound: BoundBillingAttempt): boolean {
  return payment.mId === bound.binding.merchantId && payment.type === 'BILLING' && payment.method === '카드'
    && billingRecord(payment.card) && billingCardDisplay(payment.card) !== null
    && (payment.virtualAccount === null || payment.virtualAccount === undefined)
    && (payment.transfer === null || payment.transfer === undefined)
    && (payment.easyPay === null || payment.easyPay === undefined)
    && payment.orderId === bound.attempt.providerOrderId && payment.currency === 'KRW'
    && amount(payment.totalAmount) && payment.totalAmount === bound.attempt.amount
    && billingOpaque(payment.paymentKey)
    && (bound.binding.providerPaymentKey === null || payment.paymentKey === bound.binding.providerPaymentKey);
}

function canceledEvidence(payment: Record<string, unknown>, bound: BoundBillingAttempt, now: Date): PaymentProviderEvidence | null {
  if (!matches(payment, bound) || payment.status !== 'CANCELED' || payment.balanceAmount !== 0
    || !Array.isArray(payment.cancels) || !payment.cancels.length || payment.cancels.length > 100) return null;
  let total = 0; const transactionIds = new Set<string>(); let last: { transactionId: string; at: string } | null = null;
  for (const row of payment.cancels) {
    if (!billingRecord(row) || row.cancelStatus !== 'DONE' || !amount(row.cancelAmount) || row.cancelAmount <= 0
      || !billingOpaque(row.transactionKey, 64) || transactionIds.has(row.transactionKey)) return null;
    const at = timestamp(row.canceledAt, now); if (!at) return null;
    total += row.cancelAmount; if (!Number.isSafeInteger(total) || total > bound.attempt.amount) return null;
    transactionIds.add(row.transactionKey);
    if (!last || at > last.at) last = { transactionId: row.transactionKey, at };
  }
  if (total !== bound.attempt.amount || !last) return null;
  return { providerPaymentKey: payment.paymentKey as string, providerTransactionId: last.transactionId,
    resultCode: 'CANCELED', paymentMethod: '카드', approvedAt: last.at };
}

function classifyPayment(response: ProviderResponse, bound: BoundBillingAttempt, now: Date): PaymentOperationOutcome {
  const result = (state: PaymentOperationOutcome['outcome'], code: string, proof?: PaymentProviderEvidence) =>
    billingOutcome(bound.attempt, state, code, proof);
  if (configurationFailure(response)) return result('needs_review', 'billing_configuration_error');
  // BILLING에는 결제창 만료 시한이 없다. 오래된 404도 새 주문/재청구의 증거가 아니다.
  if (response.status === 404) return result('unknown', 'billing_inquiry_not_found');
  if (response.status !== 200 || !response.parsed || !billingRecord(response.payload)) return result('unknown', 'billing_response_unavailable');
  const payment = response.payload;
  if (!matches(payment, bound)) return result('needs_review', 'billing_identity_mismatch');
  if (payment.status === 'DONE') {
    const proof = evidence(payment, now);
    if (!proof || payment.balanceAmount !== bound.attempt.amount) return result('needs_review', 'billing_approval_evidence_invalid');
    return result('approved', 'billing_approved', proof);
  }
  if (payment.status === 'CANCELED') {
    const proof = canceledEvidence(payment, bound, now);
    return proof ? result('canceled', 'billing_fully_canceled', proof) : result('needs_review', 'billing_cancellation_mismatch');
  }
  if (payment.status === 'PARTIAL_CANCELED') return result('needs_review', 'billing_partial_cancellation');
  if (payment.status === 'ABORTED' || payment.status === 'EXPIRED') return result('declined', 'billing_declined');
  return result('unknown', 'billing_payment_in_progress');
}

export function createTossRecurringBilling(options: {
  readonly profiles: BillingProfileRegistry;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly chargeTimeoutMs?: number;
}): RecurringBilling {
  const fetcher = options.fetch ?? fetch; const now = options.now ?? (() => new Date());
  const chargeTimeoutMs = options.chargeTimeoutMs ?? BILLING_CHARGE_TIMEOUT_MS;
  if (!Number.isSafeInteger(chargeTimeoutMs) || chargeTimeoutMs < 60_000 || chargeTimeoutMs > 70_000) {
    throw new Error('invalid_billing_timeout');
  }

  async function request(identity: BillingProfileIdentity, path: string, method: 'GET' | 'POST' | 'DELETE',
    timeoutMs: number, writeKeyVersion?: string, idempotencyKey?: string, body?: Record<string, unknown>): Promise<ProviderResponse | null> {
    const secret = options.profiles.secret(identity, writeKeyVersion); if (!secret) return null;
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(new URL(path, API_ORIGIN).toString(), {
        method, cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: { authorization: `Basic ${Buffer.from(`${secret}:`, 'utf8').toString('base64')}`, accept: 'application/json',
          ...(body ? { 'content-type': 'application/json' } : {}), ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, ...await responseBody(response) };
    } catch { return null; }
    finally { clearTimeout(timer); }
  }

  async function inspect(bound: BoundBillingAttempt): Promise<PaymentOperationOutcome> {
    assertBoundBillingAttempt(bound);
    if (!options.profiles.secret(bound.binding)) return billingOutcome(bound.attempt, 'needs_review', 'billing_profile_unavailable');
    const response = await request(bound.binding, `/v1/payments/orders/${encodeURIComponent(bound.attempt.providerOrderId)}`, 'GET', READ_TIMEOUT_MS);
    return response ? classifyPayment(response, bound, now()) : billingOutcome(bound.attempt, 'unknown', 'billing_inquiry_unavailable');
  }

  return {
    async register(input) {
      if (!billingProfileValid(input) || !isUuid(input.customerKey) || !billingOpaque(input.authKey, 300)
        || !billingVersion(input.writeKeyVersion) || !billingOpaque(input.idempotencyKey, 300)
        || !billingWriteRecoverable(input.firstDispatchedAt, now())) return { state: 'needs_review', reasonCode: 'billing_registration_request_invalid' };
      if (!options.profiles.secret(input, input.writeKeyVersion)) return { state: 'needs_review', reasonCode: 'billing_write_key_unavailable' };
      const response = await request(input, '/v1/billing/authorizations/issue', 'POST', chargeTimeoutMs,
        input.writeKeyVersion, input.idempotencyKey, { authKey: input.authKey, customerKey: input.customerKey });
      if (!response) return { state: 'unknown', reasonCode: 'billing_registration_unavailable' };
      if (configurationFailure(response)) return { state: 'needs_review', reasonCode: 'billing_configuration_error' };
      if (response.status === 200 && response.parsed && billingRecord(response.payload)) {
        const value = response.payload; const card = billingCardDisplay(value.card); const authenticatedAt = timestamp(value.authenticatedAt, now());
        if (value.mId !== input.merchantId || value.customerKey !== input.customerKey || value.method !== '카드'
          || !billingOpaque(value.billingKey) || !card || !authenticatedAt
          || (value.transfers !== undefined && value.transfers !== null) || (value.easyPay !== undefined && value.easyPay !== null)) {
          return { state: 'needs_review', reasonCode: 'billing_registration_evidence_invalid' };
        }
        return { state: 'ready', billingKey: value.billingKey, card, authenticatedAt };
      }
      const code = providerCode(response);
      return response.status >= 400 && response.status < 500 && code !== null && REGISTRATION_DECLINED.has(code)
        ? { state: 'declined', reasonCode: 'billing_registration_declined' }
        : { state: 'unknown', reasonCode: 'billing_registration_unavailable' };
    },
    async charge(input) {
      assertBoundBillingAttempt(input);
      if (!isUuid(input.customerKey) || !billingOpaque(input.billingKey)
        || !billingWriteRecoverable(input.binding.firstDispatchedAt, now())) {
        return billingOutcome(input.attempt, 'needs_review', 'billing_charge_request_invalid');
      }
      if (!options.profiles.secret(input.binding, input.binding.writeKeyVersion)) {
        return billingOutcome(input.attempt, 'needs_review', 'billing_write_key_unavailable');
      }
      const response = await request(input.binding, `/v1/billing/${encodeURIComponent(input.billingKey)}`, 'POST', chargeTimeoutMs,
        input.binding.writeKeyVersion, input.attempt.idempotencyKey, { customerKey: input.customerKey, amount: input.attempt.amount,
          orderId: input.attempt.providerOrderId, orderName: 'ICONS 정기배송 주문' });
      if (!response) return billingOutcome(input.attempt, 'unknown', 'billing_charge_unavailable');
      if (configurationFailure(response)) return billingOutcome(input.attempt, 'needs_review', 'billing_configuration_error');
      const code = providerCode(response);
      if (response.status >= 400 && response.status < 500 && code !== null && DECLINED.has(code)) {
        return billingOutcome(input.attempt, 'declined', 'billing_declined', { resultCode: code });
      }
      // 409/5xx/응답 손실 뒤 이 작업에서 POST를 반복하지 않는다. 다음 claim은 inspect부터 시작한다.
      return classifyPayment(response, input, now());
    },
    inspect,
    async refund(input): Promise<RefundOutcome> {
      assertBoundBillingAttempt(input);
      const result = (state: PaymentOperationOutcome['outcome'], code: string) => billingOutcome(input.attempt, state, code);
      if (input.amount !== input.attempt.amount || !billingOpaque(input.idempotencyKey, 300) || !billingVersion(input.writeKeyVersion)
        || typeof input.reason !== 'string' || !input.reason.trim() || [...input.reason].length > 200 || /[\u0000-\u001f\u007f]/.test(input.reason)) {
        return result('needs_review', 'billing_refund_request_invalid');
      }
      const before = await inspect(input);
      if (before.outcome === 'canceled') return { ...before, outcome: 'approved', refundedAmount: input.amount };
      if (before.outcome !== 'approved' || !before.evidence?.providerPaymentKey) return before;
      if (!billingWriteRecoverable(input.firstDispatchedAt, now()) || !options.profiles.secret(input.binding, input.writeKeyVersion)) {
        return result('needs_review', 'billing_refund_write_unavailable');
      }
      const response = await request(input.binding, `/v1/payments/${encodeURIComponent(before.evidence.providerPaymentKey)}/cancel`, 'POST',
        REFUND_TIMEOUT_MS, input.writeKeyVersion, input.idempotencyKey, { cancelReason: input.reason, cancelAmount: input.amount });
      // 취소 응답 자체로 확정하지 않는다. 실패 응답 뒤에도 독립 조회로 이미 이루어진 취소를 복구한다.
      const after = await inspect({ ...input, binding: { ...input.binding, providerPaymentKey: before.evidence.providerPaymentKey } });
      if (after.outcome === 'canceled') return { ...after, outcome: 'approved', refundedAmount: input.amount };
      if (after.outcome === 'needs_review') return after;
      if (response && configurationFailure(response)) return result('needs_review', 'billing_configuration_error');
      return result('unknown', 'billing_refund_unsettled');
    },
    async revoke(input) {
      if (!billingProfileValid(input) || !billingOpaque(input.billingKey) || !options.profiles.secret(input)) {
        return { state: 'needs_review', reasonCode: 'billing_revoke_request_invalid' };
      }
      const response = await request(input, `/v1/billing/${encodeURIComponent(input.billingKey)}`, 'DELETE', READ_TIMEOUT_MS);
      if (response?.status === 200 && response.empty) return { state: 'revoked', reasonCode: 'billing_revoked' };
      if (response && configurationFailure(response)) return { state: 'needs_review', reasonCode: 'billing_configuration_error' };
      // 404만으로 이미 지워졌다고 추측하지 않는다. 확인될 때까지 암호문을 보존한다.
      return { state: 'unknown', reasonCode: 'billing_revoke_unsettled' };
    },
  };
}
