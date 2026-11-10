import 'server-only';
import { randomUUID } from 'node:crypto';
import { createServiceClient } from '../supabase/service';
import { isUuid } from '../uuid';
import { billingInstant, billingProfileValid, billingRecord, type BillingProfileIdentity } from './billing-types.server';
import { parseBillingSecretEnvelope } from './billing-crypto.server';
import { createSubscriptionBillingRuntime } from './runtime.server';

/** Revoke is available independently of new sales; ciphertext is cleared only after verified completion. */
export async function revokeBillingCredential(actorId: string, credentialId: string) {
  if (!isUuid(actorId) || !isUuid(credentialId)) throw new Error('invalid_billing_credential');
  const client = createServiceClient(), token = randomUUID();
  const claimed = await client.rpc('service_claim_billing_credential_revocation', { p_actor_id: actorId, p_credential_id: credentialId, p_claim_token: token });
  if (claimed.error) throw new Error('billing_revocation_unavailable');
  if (claimed.data === null) return { state: 'pending' as const };
  const entry: unknown = claimed.data;
  if (!billingRecord(entry) || entry.id !== credentialId || entry.ownerId !== actorId || entry.claimToken !== token
    || !Number.isSafeInteger(entry.claimFence) || (entry.claimFence as number) < 1 || !billingInstant(entry.expiresAt) || Date.parse(entry.expiresAt) <= Date.now()
    || !billingRecord(entry.profile) || !billingProfileValid(entry.profile as unknown as BillingProfileIdentity)) throw new Error('invalid_billing_revocation');
  const profile = entry.profile as unknown as BillingProfileIdentity, runtime = createSubscriptionBillingRuntime(client, profile.profileId, profile);
  let state: 'revoked' | 'unknown' | 'needs_review' = 'needs_review';
  try {
    const envelope = parseBillingSecretEnvelope(entry.envelope);
    if (runtime && envelope) {
      const key = runtime.vault.open(envelope, { ...profile, id: credentialId, ownerId: actorId, purpose: 'billing_key' });
      state = (await runtime.billing.revoke({ ...profile, billingKey: key })).state;
    }
  } catch { state = 'unknown'; }
  const finished = await client.rpc('service_finish_billing_credential_revocation', { p_actor_id: actorId, p_credential_id: credentialId,
    p_claim_token: token, p_claim_fence: entry.claimFence, p_state: state });
  if (finished.error || !billingRecord(finished.data) || finished.data.id !== credentialId
    || !['revoked', 'revoking', 'needs_review'].includes(finished.data.state as string)) throw new Error('billing_revocation_unavailable');
  return { state: finished.data.state as 'revoked' | 'revoking' | 'needs_review' };
}
export async function runBillingCredentialCleanup() {
  const client = createServiceClient(), { data, error } = await client.rpc('service_list_billing_credential_revocations', { p_limit: 1 });
  if (error || !Array.isArray(data) || data.length > 1) throw new Error('billing_cleanup_unavailable');
  if (!data.length) return { state: 'idle' as const };
  const entry = data[0]; if (!billingRecord(entry) || !isUuid(entry.id) || !isUuid(entry.actorId)) throw new Error('invalid_billing_cleanup');
  return revokeBillingCredential(entry.actorId, entry.id);
}
