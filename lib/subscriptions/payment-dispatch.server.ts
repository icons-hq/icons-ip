import 'server-only';

import { createHash } from 'node:crypto';
import { isUuid } from '../uuid';
import type { PaymentAttempt, PaymentGateway, PaymentRefundRequest } from '../payments/gateway';
import type { PaymentCheckoutProvider } from '../payments/runtime-gateway';
import type { GoodsReconciliationFinalizer } from '../payments/goods-checkout.server';
import { billingProfilesFromEnvironment, type BillingProfileRegistry } from './billing-profiles.server';
import { createSubscriptionBillingRuntime, localFakeBillingEnabled } from './runtime.server';
import { createTossRecurringBilling } from './toss-recurring-billing.server';
import {
  assertBoundBillingAttempt, billingInstant, billingOpaque, billingOutcome, billingProfileValid, billingRecord, billingVersion,
  type BillingAttemptBinding, type BillingProfileIdentity, type BoundBillingAttempt, type RecurringBilling,
} from './billing-types.server';

export type BillingDispatchBinding = Omit<BillingAttemptBinding, 'firstDispatchedAt'> & { readonly firstDispatchedAt: string | null };
export interface BillingRefundOperation { readonly writeKeyVersion: string; readonly firstDispatchedAt: string }
export interface PaymentDispatchRpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
}

export function parseBillingDispatchBinding(value: unknown): BillingDispatchBinding | null {
  if (!billingRecord(value) || Object.keys(value).sort().join(',') !==
    'attemptId,credentialId,cycleId,environment,firstDispatchedAt,integration,merchantId,ownerId,profileId,providerPaymentKey,writeKeyVersion'
    || value.integration !== 'toss_billing' || !billingProfileValid(value as unknown as BillingProfileIdentity)
    || ![value.attemptId, value.ownerId, value.credentialId, value.cycleId].every(isUuid)
    || !billingVersion(value.writeKeyVersion) || (value.firstDispatchedAt !== null && !billingInstant(value.firstDispatchedAt))
    || (value.providerPaymentKey !== null && !billingOpaque(value.providerPaymentKey))) return null;
  return value as unknown as BillingDispatchBinding;
}

export interface AttemptPaymentGatewayDependencies {
  readonly legacy: PaymentGateway;
  readonly loadBinding: (attemptId: string) => Promise<BillingDispatchBinding | null>;
  readonly recurring: (binding: BillingDispatchBinding) => RecurringBilling | null;
  readonly prepareRefund: (request: PaymentRefundRequest, binding: BillingDispatchBinding) => Promise<BillingRefundOperation | null>;
}

/**
 * 일반 결제 준비/콜백 계약을 유지하고, billing의 조회/환급은 immutable binding으로 보낸다.
 * 조회 실패나 손상 binding을 "과거 일반 주문"으로 해석하는 fallback은 없다.
 */
export function createAttemptAwarePaymentGateway(provider: PaymentCheckoutProvider, dependencies: AttemptPaymentGatewayDependencies): PaymentGateway {
  async function bindingFor(attempt: PaymentAttempt) {
    if (attempt.provider !== provider) throw new Error('payment_dispatch_provider_mismatch');
    if (provider !== 'toss' || attempt.purpose !== 'order') return null;
    const binding = await dependencies.loadBinding(attempt.id);
    if (binding && (binding.attemptId !== attempt.id || !parseBillingDispatchBinding(binding))) throw new Error('payment_dispatch_binding_invalid');
    return binding;
  }
  function bound(attempt: PaymentAttempt, binding: BillingDispatchBinding): BoundBillingAttempt | null {
    if (binding.firstDispatchedAt === null) return null;
    const result = { attempt, binding: { ...binding, firstDispatchedAt: binding.firstDispatchedAt } };
    assertBoundBillingAttempt(result); return result;
  }
  return {
    async prepare(attempt) {
      if (await bindingFor(attempt)) throw new Error('billing_checkout_not_supported');
      return dependencies.legacy.prepare(attempt);
    },
    async confirm(input) {
      if (await bindingFor(input.attempt)) return billingOutcome(input.attempt, 'needs_review', 'billing_callback_not_supported');
      return dependencies.legacy.confirm(input);
    },
    async reconcile(attempt) {
      const binding = await bindingFor(attempt);
      if (!binding) return dependencies.legacy.reconcile(attempt);
      const billing = dependencies.recurring(binding); const input = bound(attempt, binding);
      if (!billing) return billingOutcome(attempt, 'needs_review', 'billing_profile_unavailable');
      if (!input) return billingOutcome(attempt, 'needs_review', 'billing_not_dispatched');
      return billing.inspect(input);
    },
    async refund(request) {
      const binding = await bindingFor(request.attempt);
      if (!binding) return dependencies.legacy.refund(request);
      const billing = dependencies.recurring(binding); const input = bound(request.attempt, binding);
      if (!billing) return billingOutcome(request.attempt, 'needs_review', 'billing_profile_unavailable');
      if (!input) return billingOutcome(request.attempt, 'needs_review', 'billing_not_dispatched');
      const operation = await dependencies.prepareRefund(request, binding);
      if (!operation) return billingOutcome(request.attempt, 'needs_review', 'billing_refund_write_unavailable');
      return billing.refund({ ...input, amount: request.amount, reason: request.reason, idempotencyKey: request.idempotencyKey, ...operation });
    },
  };
}

export function createPaymentDispatchRepository(client: PaymentDispatchRpcClient, profiles: () => BillingProfileRegistry | null,
  resolveWriteVersion?: (binding: BillingDispatchBinding) => string | null) {
  return {
    async loadBinding(attemptId: string): Promise<BillingDispatchBinding | null> {
      if (!isUuid(attemptId)) throw new Error('payment_dispatch_binding_invalid');
      const { data, error } = await client.rpc('service_get_payment_gateway_binding', { p_attempt_id: attemptId });
      if (error) throw new Error('payment_dispatch_lookup_failed');
      if (data === null) return null;
      const binding = parseBillingDispatchBinding(data);
      if (!binding || binding.attemptId !== attemptId) throw new Error('payment_dispatch_binding_invalid');
      return binding;
    },
    async prepareRefund(request: PaymentRefundRequest, binding: BillingDispatchBinding): Promise<BillingRefundOperation | null> {
      const profile = profiles()?.registration(binding.profileId);
      const writeKeyVersion = resolveWriteVersion ? resolveWriteVersion(binding)
        : profile && profile.identity.merchantId === binding.merchantId && profile.identity.environment === binding.environment ? profile.writeKeyVersion : null;
      if (!writeKeyVersion) return null;
      const { data, error } = await client.rpc('service_prepare_billing_refund', {
        p_attempt_id: request.attempt.id, p_idempotency_key: request.idempotencyKey, p_amount: request.amount,
        p_request_hash: createHash('sha256').update(JSON.stringify([request.amount, request.reason])).digest('hex'),
        p_key_version: writeKeyVersion,
      });
      if (error || !billingRecord(data) || Object.keys(data).sort().join(',') !== 'firstDispatchedAt,writeKeyVersion'
        || !billingVersion(data.writeKeyVersion) || !billingInstant(data.firstDispatchedAt)) throw new Error('billing_refund_operation_unavailable');
      return { writeKeyVersion: data.writeKeyVersion, firstDispatchedAt: data.firstDispatchedAt };
    },
  };
}

/** 신규 청구 gate와 분리된 복구 설정. 과거 결제의 inspect/refund는 공개 판매 OFF 뒤에도 가능하다. */
export function billingRecoveryConfigured(): boolean { return billingProfilesFromEnvironment() !== null || localFakeBillingEnabled(); }

export async function goodsReconciliationFinalizer(client: PaymentDispatchRpcClient, provider: PaymentCheckoutProvider,
  attemptId: string): Promise<GoodsReconciliationFinalizer> {
  const binding = provider === 'toss' ? await createPaymentDispatchRepository(client, () => null).loadBinding(attemptId) : null;
  return binding ? 'service_finalize_subscription_payment_reconciliation' : 'finalize_goods_payment_reconciliation';
}

export function createRuntimeAttemptPaymentGateway(client: PaymentDispatchRpcClient, provider: PaymentCheckoutProvider, legacy: PaymentGateway): PaymentGateway {
  const profiles = billingProfilesFromEnvironment();
  const runtime = (binding: BillingDispatchBinding) => {
    if (localFakeBillingEnabled() && binding.profileId === process.env.BILLING_FAKE_PROFILE_ID) return createSubscriptionBillingRuntime(client, binding.profileId, binding);
    const profile = profiles?.registration(binding.profileId);
    if (!profiles || !profile || profile.identity.merchantId !== binding.merchantId || profile.identity.environment !== binding.environment) return null;
    // Past-payment GET/refund needs merchant credentials, never a decryptable billing key.
    return { billing: createTossRecurringBilling({ profiles }), writeKeyVersion: profile.writeKeyVersion };
  };
  const repository = createPaymentDispatchRepository(client, () => profiles, binding => runtime(binding)?.writeKeyVersion ?? null);
  return createAttemptAwarePaymentGateway(provider, { legacy, ...repository, recurring: binding => runtime(binding)?.billing ?? null });
}
