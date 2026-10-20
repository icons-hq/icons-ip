import 'server-only';
import { randomUUID } from 'node:crypto';
import { sendOrderConfirmationEmail } from '../email/transactional.server';
import { isUuid } from '../uuid';
import { createServiceClient } from '../supabase/service';
import type { PaymentAttempt, PaymentOperationOutcome } from '../payments/gateway';
import { billingInstant, billingProfileMatches, billingProfileValid, billingRecord, assertBoundBillingAttempt, billingOutcome, type BillingProfileIdentity, type RecurringBilling } from './billing-types.server';
import { parseBillingSecretEnvelope, type BillingVault } from './billing-crypto.server';
import { parseBillingDispatchBinding } from './payment-dispatch.server';
import { createSubscriptionWorkRuntime } from './runtime.server';

interface SubscriptionWorkLease { cycleId: string; actorId: string; termsId: string; token: string; fence: number; expiresAt: string; profile: BillingProfileIdentity | null }
export interface SubscriptionWorkerRepository {
  claim(token: string, cycleId: string | null, manualReview: boolean): Promise<unknown>;
  prepare(lease: SubscriptionWorkLease, profile: BillingProfileIdentity | null, writeKeyVersion: string | null): Promise<unknown>;
  finish(lease: SubscriptionWorkLease, outcome: PaymentOperationOutcome): Promise<unknown>;
}
type Runtime = { identity: BillingProfileIdentity; writeKeyVersion: string | null; vault: BillingVault | null; billing: RecurringBilling };
function leaseValue(value: unknown): SubscriptionWorkLease | null {
  if (!billingRecord(value) || ![value.cycleId, value.actorId, value.termsId, value.token].every(isUuid)
    || !Number.isSafeInteger(value.fence) || (value.fence as number) < 1 || !billingInstant(value.expiresAt)
    || value.profile !== null && (!billingRecord(value.profile) || !billingProfileValid(value.profile as unknown as BillingProfileIdentity))) return null;
  return value as unknown as SubscriptionWorkLease;
}
function parseAttempt(value: unknown): PaymentAttempt | null {
  if (!billingRecord(value) || value.provider !== 'toss' || value.purpose !== 'order') return null;
  return { id: value.id, provider: value.provider, purpose: value.purpose, refId: value.ref_id, amount: value.amount, currency: value.currency,
    idempotencyKey: value.idempotency_key, providerOrderId: value.provider_order_id, providerProductCode: value.provider_product_code, expiresAt: value.expires_at } as PaymentAttempt;
}
/** One invocation sends at most one charge. Every reclaimed dispatch starts with provider inspection. */
export function createGoodsSubscriptionWorker(options: { repository: SubscriptionWorkerRepository; runtime: (identity: BillingProfileIdentity) => Runtime | null;
  now?: () => Date; onApproved?: (orderId: string) => Promise<void> }) {
  const now = options.now ?? (() => new Date());
  async function approved(orderId: string) { try { await options.onApproved?.(orderId); } catch { /* Financial finalization is authoritative; the idempotent email hook can be retried independently. */ } }
  return { async run(cycleId: string | null = null, manualReview = false) {
    if (cycleId !== null && !isUuid(cycleId) || manualReview && cycleId === null) throw new Error('invalid_subscription_work');
    const token = randomUUID(), raw = await options.repository.claim(token, cycleId, manualReview);
    if (raw === null) return { state: 'idle' as const };
    const lease = leaseValue(raw);
    if (!lease || lease.token !== token || cycleId !== null && lease.cycleId !== cycleId || Date.parse(lease.expiresAt) <= now().getTime()) throw new Error('invalid_subscription_lease');
    const runtime = lease.profile ? options.runtime(lease.profile) : null;
    const work = await options.repository.prepare(lease, runtime?.identity ?? null, runtime?.writeKeyVersion ?? null);
    if (!billingRecord(work)) throw new Error('invalid_subscription_work');
    if (work.kind === 'terminal' && work.outcome === 'approved') {
      if (!isUuid(work.orderId)) throw new Error('invalid_subscription_finalization');
      await approved(work.orderId); return { state: 'approved' as const, cycleId: lease.cycleId, orderId: work.orderId };
    }
    if (['wait', 'stopped', 'terminal', 'gate_closed'].includes(work.kind as string)) return { state: work.kind as 'wait' | 'stopped' | 'terminal' | 'gate_closed', cycleId: lease.cycleId };
    if (!['charge', 'inspect'].includes(work.kind as string) || !runtime || manualReview && work.kind !== 'inspect') throw new Error('invalid_subscription_work');
    const attempt = parseAttempt(work.attempt), binding = parseBillingDispatchBinding(work.binding);
    if (!attempt || !binding || !binding.firstDispatchedAt || binding.cycleId !== lease.cycleId || binding.ownerId !== lease.actorId
      || !billingProfileMatches(binding, runtime.identity)) throw new Error('invalid_subscription_work');
    const bound = { attempt, binding: { ...binding, firstDispatchedAt: binding.firstDispatchedAt } }; assertBoundBillingAttempt(bound);
    if (Date.parse(lease.expiresAt) <= now().getTime()) throw new Error('subscription_claim_stale');
    let outcome: PaymentOperationOutcome;
    try {
      if (work.kind === 'inspect') outcome = await runtime.billing.inspect(bound);
      else {
        const envelope = parseBillingSecretEnvelope(work.envelope); if (!runtime.vault || !envelope || !isUuid(work.customerKey)) throw new Error('invalid_subscription_credential');
        const billingKey = runtime.vault.open(envelope, { ...binding, purpose: 'billing_key', id: binding.credentialId });
        outcome = await runtime.billing.charge({ ...bound, billingKey, customerKey: work.customerKey });
      }
    } catch { outcome = billingOutcome(attempt, 'unknown', 'billing_request_unavailable'); }
    if (outcome.attemptId !== attempt.id || outcome.provider !== 'toss') throw new Error('invalid_subscription_outcome');
    const result = await options.repository.finish(lease, outcome);
    if (!['approved', 'declined', 'canceled', 'unknown', 'needs_review'].includes(result as string)) throw new Error('invalid_subscription_finalization');
    if (result === 'approved') await approved(attempt.refId);
    return { state: result as 'approved' | 'declined' | 'canceled' | 'unknown' | 'needs_review', cycleId: lease.cycleId, orderId: attempt.refId };
  } };
}
type RpcClient = { rpc(name: string, parameters: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
export function createSubscriptionWorkerRepository(client: RpcClient): SubscriptionWorkerRepository {
  async function rpc(name: string, args: Record<string, unknown>) { const { data, error } = await client.rpc(name, args); if (error) throw new Error('subscription_work_unavailable'); return data; }
  return {
    claim: (token, cycleId, manualReview) => rpc('service_claim_goods_subscription_work', { p_claim_token: token, p_cycle_id: cycleId, p_manual_review: manualReview }),
    prepare: (lease, profile, writeKeyVersion) => rpc('service_prepare_goods_subscription_work', { p_actor_id: lease.actorId, p_cycle_id: lease.cycleId,
      p_claim_token: lease.token, p_claim_fence: lease.fence, p_profile_id: profile?.profileId ?? null, p_write_key_version: writeKeyVersion }),
    finish: (lease, outcome) => rpc('service_finish_goods_subscription_work', { p_actor_id: lease.actorId, p_cycle_id: lease.cycleId,
      p_claim_token: lease.token, p_claim_fence: lease.fence, p_outcome: outcome.outcome, p_provider_payment_key: outcome.evidence?.providerPaymentKey ?? null,
      p_provider_transaction_id: outcome.evidence?.providerTransactionId ?? null, p_provider_approval_reference: outcome.evidence?.providerApprovalReference ?? null,
      p_result_code: outcome.evidence?.resultCode ?? null, p_payment_method: outcome.evidence?.paymentMethod ?? null,
      p_masked_payment_method: outcome.evidence?.maskedPaymentMethod ?? null, p_approved_at: outcome.evidence?.approvedAt ?? null }),
  };
}
export function runtimeGoodsSubscriptionWorker() {
  const client = createServiceClient();
  return createGoodsSubscriptionWorker({ repository: createSubscriptionWorkerRepository(client), runtime: identity => createSubscriptionWorkRuntime(client, identity),
    onApproved: async orderId => { await sendOrderConfirmationEmail(orderId); } });
}
