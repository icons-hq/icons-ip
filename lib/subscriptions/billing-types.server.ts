import 'server-only';

import { isUuid } from '../uuid';
import type { PaymentAttempt, PaymentOperationOutcome, RefundOutcome } from '../payments/gateway';

export type BillingEnvironment = 'test' | 'live';

/** 서버 원장의 불변 식별자. 브라우저가 보낸 profile/MID를 여기에 넣지 않는다. */
export interface BillingProfileIdentity {
  readonly profileId: string;
  readonly merchantId: string;
  readonly environment: BillingEnvironment;
}

export interface BillingAttemptBinding extends BillingProfileIdentity {
  readonly integration: 'toss_billing';
  readonly attemptId: string;
  readonly ownerId: string;
  readonly credentialId: string;
  readonly cycleId: string;
  readonly writeKeyVersion: string;
  readonly firstDispatchedAt: string;
  readonly providerPaymentKey: string | null;
}

export interface BoundBillingAttempt {
  readonly attempt: PaymentAttempt;
  readonly binding: BillingAttemptBinding;
}

export interface BillingCardDisplay {
  readonly issuerCode: string;
  readonly number: string;
}

export type BillingRegistrationResult =
  | { readonly state: 'ready'; readonly billingKey: string; readonly card: BillingCardDisplay; readonly authenticatedAt: string }
  | { readonly state: 'declined' | 'unknown' | 'needs_review'; readonly reasonCode: string };

export interface BillingRegistrationRequest extends BillingProfileIdentity {
  readonly customerKey: string;
  readonly authKey: string;
  readonly writeKeyVersion: string;
  readonly idempotencyKey: string;
  readonly firstDispatchedAt: string;
}

export interface BillingChargeRequest extends BoundBillingAttempt {
  readonly customerKey: string;
  readonly billingKey: string;
}

export interface BillingRefundRequest extends BoundBillingAttempt {
  readonly amount: number;
  readonly reason: string;
  readonly idempotencyKey: string;
  /** 환급의 최초 발송 key version. 승인 때 썼던 version과는 별개의 원장 필드다. */
  readonly writeKeyVersion: string;
  readonly firstDispatchedAt: string;
}

export interface BillingRevokeRequest extends BillingProfileIdentity {
  readonly billingKey: string;
}

/** 모든 구현은 검증 결과만 반환한다. 주문/회차 확정은 DB finalizer의 책임이다. */
export interface RecurringBilling {
  register(request: BillingRegistrationRequest): Promise<BillingRegistrationResult>;
  charge(request: BillingChargeRequest): Promise<PaymentOperationOutcome>;
  inspect(request: BoundBillingAttempt): Promise<PaymentOperationOutcome>;
  refund(request: BillingRefundRequest): Promise<RefundOutcome>;
  revoke(request: BillingRevokeRequest): Promise<{ state: 'revoked' | 'unknown' | 'needs_review'; reasonCode: string }>;
}

export function billingRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function billingOpaque(value: unknown, max = 200): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && /^[\x21-\x7e]+$/.test(value);
}

export function billingVersion(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

export function billingInstant(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 35) return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!parts) return false;
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day));
  return year >= 2000 && calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1
    && calendar.getUTCDate() === day && hour <= 23 && minute <= 59 && second <= 59
    && (!parts[7] || (Number(parts[7]) <= 23 && Number(parts[8]) <= 59)) && Number.isFinite(Date.parse(value));
}

export function billingProfileValid(value: BillingProfileIdentity): boolean {
  return isUuid(value.profileId) && /^[A-Za-z0-9_-]{1,64}$/.test(value.merchantId)
    && (value.environment === 'test' || value.environment === 'live');
}

export function billingProfileMatches(left: BillingProfileIdentity, right: BillingProfileIdentity): boolean {
  return left.profileId === right.profileId && left.merchantId === right.merchantId && left.environment === right.environment;
}

export function billingCardDisplay(value: unknown): BillingCardDisplay | null {
  if (!billingRecord(value) || typeof value.issuerCode !== 'string' || !/^[A-Z0-9]{2}$/.test(value.issuerCode)
    || typeof value.number !== 'string' || !/^[0-9* -]{8,24}$/.test(value.number)) return null;
  const compact = value.number.replace(/[ -]/g, '');
  // API의 자유 문자열을 그대로 표시하지 않는다. 최소 네 자리 마스킹과 노출 상한을 검증한다.
  if ((compact.match(/\*/g)?.length ?? 0) < 4 || (compact.match(/\d/g)?.length ?? 0) > 12 || /\d{9}/.test(compact)) return null;
  return { issuerCode: value.issuerCode, number: compact };
}

export function assertBoundBillingAttempt(value: BoundBillingAttempt): void {
  const { attempt, binding } = value;
  if (!billingProfileValid(binding) || binding.integration !== 'toss_billing'
    || ![attempt.id, attempt.refId, binding.ownerId, binding.credentialId, binding.cycleId].every(isUuid)
    || binding.attemptId !== attempt.id || attempt.provider !== 'toss' || attempt.purpose !== 'order'
    || attempt.currency !== 'KRW' || !Number.isSafeInteger(attempt.amount) || attempt.amount < 100 || attempt.amount > 999_999_999_999
    || !/^O[0-9a-f]{32}$/i.test(attempt.providerOrderId) || !/^P[0-9a-f]{32}$/i.test(attempt.providerProductCode)
    || !billingOpaque(attempt.idempotencyKey, 300) || !billingInstant(attempt.expiresAt)
    || !billingVersion(binding.writeKeyVersion) || !billingInstant(binding.firstDispatchedAt)
    || (binding.providerPaymentKey !== null && !billingOpaque(binding.providerPaymentKey))) {
    throw new Error('invalid_billing_attempt');
  }
}

/** 외부 멱등 보존기간이 지난 요청을 새 쓰기처럼 재발행하지 않는다. */
export function billingWriteRecoverable(firstDispatchedAt: string, now: Date): boolean {
  const current = now.getTime(); const first = Date.parse(firstDispatchedAt);
  return billingInstant(firstDispatchedAt) && Number.isFinite(current) && first <= current + 300_000
    && current - first < 15 * 24 * 60 * 60 * 1000;
}

export function billingOutcome(
  attempt: PaymentAttempt, outcome: PaymentOperationOutcome['outcome'], reasonCode: string,
  evidence?: PaymentOperationOutcome['evidence'],
): PaymentOperationOutcome {
  return { attemptId: attempt.id, provider: 'toss', outcome, reasonCode, ...(evidence ? { evidence } : {}) };
}
