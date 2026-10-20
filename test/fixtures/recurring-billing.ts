import type { BillingCredentialProfile } from '../../lib/subscriptions/billing-profiles.server';
import type { BillingChargeRequest, BillingRegistrationRequest, BillingRefundRequest } from '../../lib/subscriptions/billing-types.server';

export const BILLING_TEST_NOW = new Date('2026-10-14T01:00:00.000Z');
export const BILLING_TEST_PROFILE: BillingCredentialProfile = {
  profileId: 'b1711000-0000-4000-8000-000000000001', merchantId: 'iconsbilltest', environment: 'test',
  clientKey: `test_ck_${'C'.repeat(32)}`, currentKeyVersion: 'v2',
  secretKeys: { v1: `test_sk_${'A'.repeat(32)}`, v2: `test_sk_${'B'.repeat(32)}` },
};

export function billingChargeFixture(): BillingChargeRequest {
  return {
    attempt: { id: 'b1711000-0000-4000-8000-000000000002', provider: 'toss', purpose: 'order',
      refId: 'b1711000-0000-4000-8000-000000000003', amount: 25_000, currency: 'KRW',
      idempotencyKey: 'billing:b1711000-0000-4000-8000-000000000002',
      providerOrderId: 'Ob1711000000040008000000000000003', providerProductCode: 'Pb1711000000040008000000000000003',
      expiresAt: '2026-10-14T01:10:00.000Z' },
    binding: { integration: 'toss_billing', profileId: BILLING_TEST_PROFILE.profileId,
      merchantId: BILLING_TEST_PROFILE.merchantId, environment: 'test', attemptId: 'b1711000-0000-4000-8000-000000000002',
      ownerId: 'b1711000-0000-4000-8000-000000000004', credentialId: 'b1711000-0000-4000-8000-000000000005',
      cycleId: 'b1711000-0000-4000-8000-000000000006', writeKeyVersion: 'v1',
      firstDispatchedAt: '2026-10-14T00:59:00.000Z', providerPaymentKey: null },
    customerKey: 'b1711000-0000-4000-8000-000000000007', billingKey: 'fake-billing-key/only+fixture=',
  };
}

export function billingRegistrationFixture(): BillingRegistrationRequest {
  return { profileId: BILLING_TEST_PROFILE.profileId, merchantId: BILLING_TEST_PROFILE.merchantId, environment: 'test',
    customerKey: billingChargeFixture().customerKey, authKey: 'fake-auth-key-fixture-only',
    writeKeyVersion: 'v1', idempotencyKey: 'billing-register-fixture', firstDispatchedAt: '2026-10-14T00:59:00.000Z' };
}

export function billingRefundFixture(): BillingRefundRequest {
  const { attempt, binding } = billingChargeFixture();
  return { attempt, binding, amount: attempt.amount, reason: '고객 주문 취소',
    idempotencyKey: 'billing-refund-fixture', writeKeyVersion: 'v2', firstDispatchedAt: '2026-10-14T01:00:00.000Z' };
}

export function billingPaymentFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { attempt, binding } = billingChargeFixture();
  return { mId: binding.merchantId, type: 'BILLING', method: '카드', status: 'DONE', currency: 'KRW',
    orderId: attempt.providerOrderId, paymentKey: 'fake-payment-key-fixture', lastTransactionKey: 'fake-transaction-fixture',
    totalAmount: attempt.amount, balanceAmount: attempt.amount, approvedAt: '2026-10-14T00:59:30+00:00',
    card: { issuerCode: '61', number: '43301234****123*', approveNo: '12345678', amount: attempt.amount },
    virtualAccount: null, transfer: null, easyPay: null, cancels: null, ...overrides };
}

export function billingCanceledFixture(): Record<string, unknown> {
  return billingPaymentFixture({ status: 'CANCELED', balanceAmount: 0, cancels: [{ transactionKey: 'fake-cancel-fixture',
    cancelStatus: 'DONE', cancelAmount: 25_000, canceledAt: '2026-10-14T01:00:00Z' }] });
}
