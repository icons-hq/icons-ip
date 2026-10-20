import 'server-only';

import { createHash } from 'node:crypto';
import { createClient } from '../supabase/server';
import { createServiceClient, getServiceRoleConfig } from '../supabase/service';
import { getSupabaseConfig } from '../supabase/config';
import { isUuid } from '../uuid';
import { normalizeKorpaySiteUrl } from '../payments/korpay-config.mjs';
import { billingProfilesFromEnvironment } from './billing-profiles.server';
import { billingVaultFromEnvironment, createBillingVault } from './billing-crypto.server';
import { createFakeRecurringBilling, type FakeBillingLedger, type FakeBillingReceipt } from './fake-recurring-billing.server';
import { createTossRecurringBilling } from './toss-recurring-billing.server';
import { billingInstant, billingProfileMatches, billingRecord, type BillingProfileIdentity } from './billing-types.server';
import { createBillingRegistrationRepository, createBillingRegistrationService, parseBillingRegistrationEntry, type BillingRegistrationActor } from './registration.server';

export function subscriptionSiteOrigin(environment: Readonly<Record<string, string | undefined>> = process.env): string | null {
  return normalizeKorpaySiteUrl(environment.SITE_URL ?? '', { production: environment.VERCEL_ENV === 'production' });
}
export function localFakeBillingEnabled(environment: Readonly<Record<string, string | undefined>> = process.env): boolean {
  if (environment.BILLING_FAKE_LOCAL_ENABLED !== 'true' || environment.VERCEL_ENV || environment.VERCEL
    || !['development', 'test'].includes(environment.NODE_ENV ?? '') || !isUuid(environment.BILLING_FAKE_PROFILE_ID)) return false;
  try {
    const db = new URL(environment.NEXT_PUBLIC_SUPABASE_URL ?? ''), site = new URL(subscriptionSiteOrigin(environment) ?? '');
    return [db, site].every(url => url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname));
  } catch { return false; }
}
type BillingRuntimeRpcClient = { rpc(name: string, parameters: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
export function createDatabaseFakeBillingLedger(client: BillingRuntimeRpcClient): FakeBillingLedger {
  return { async execute(command) {
    const { data, error } = await client.rpc('service_fake_billing_command', { p_command: command });
    if (error || !billingRecord(data) || !['registered', 'approved', 'declined', 'canceled', 'revoked', 'not_found', 'conflict'].includes(data.state as string)
      || !billingInstant(data.at) || data.attemptId !== undefined && !isUuid(data.attemptId)
      || data.amount !== undefined && (!Number.isSafeInteger(data.amount) || (data.amount as number) < 100)
      || data.paymentKey !== undefined && (typeof data.paymentKey !== 'string' || !/^fake_payment_[0-9a-f]{32}$/.test(data.paymentKey))
      || data.transactionId !== undefined && (typeof data.transactionId !== 'string' || !/^fake_(approval|cancel)_[0-9a-f]{32}$/.test(data.transactionId))) {
      throw new Error('fake_billing_ledger_unavailable');
    }
    return data as unknown as FakeBillingReceipt;
  } };
}

/** Profile and ciphertext recovery is independent from the new-registration gate. */
export function createSubscriptionBillingRuntime(client: BillingRuntimeRpcClient, profileId: string, saved?: BillingProfileIdentity,
  environment: Readonly<Record<string, string | undefined>> = process.env) {
  const fake = localFakeBillingEnabled(environment) && profileId === environment.BILLING_FAKE_PROFILE_ID;
  if (fake) {
    const identity: BillingProfileIdentity = { profileId, merchantId: 'localbilling', environment: 'test' };
    if (saved && !billingProfileMatches(identity, saved)) return null;
    // This material encrypts synthetic local-only fixtures. It cannot select a live/test Toss adapter.
    const material = createHash('sha256').update(JSON.stringify(['icons:fake-billing-vault', environment.NEXT_PUBLIC_SUPABASE_URL, profileId])).digest();
    return { identity, fake: true, clientKey: '', writeKeyVersion: 'fake-v1',
      vault: createBillingVault({ activeVersion: 'fake-v1', keys: { 'fake-v1': material } }),
      billing: createFakeRecurringBilling({ identity, ledger: createDatabaseFakeBillingLedger(client) }) };
  }
  const profiles = billingProfilesFromEnvironment(environment), vault = billingVaultFromEnvironment(environment), profile = profiles?.registration(profileId);
  if (!profiles || !vault || !profile || saved && !billingProfileMatches(profile.identity, saved)) return null;
  return { ...profile, vault, fake: false, billing: createTossRecurringBilling({ profiles }) };
}
/** Inspection can recover a dispatched cycle even when billing-key decryption is unavailable. */
export function createSubscriptionWorkRuntime(client: BillingRuntimeRpcClient, identity: BillingProfileIdentity,
  environment: Readonly<Record<string, string | undefined>> = process.env) {
  const full = createSubscriptionBillingRuntime(client, identity.profileId, identity, environment); if (full) return full;
  const profiles = billingProfilesFromEnvironment(environment), profile = profiles?.registration(identity.profileId);
  if (!profiles || !profile || !billingProfileMatches(identity, profile.identity)) return null;
  return { identity: profile.identity, writeKeyVersion: null, vault: null, billing: createTossRecurringBilling({ profiles }) };
}
export async function subscriptionActor(): Promise<BillingRegistrationActor | null> {
  if (!getSupabaseConfig().isConfigured || !getServiceRoleConfig().isConfigured) return null;
  const client = await createClient();
  const { data: userData, error: userError } = await client.auth.getUser();
  if (userError || !userData.user) return null;
  const { data, error } = await client.auth.getClaims();
  const sessionId = data?.claims.session_id;
  if (error || data?.claims.sub !== userData.user.id || !isUuid(sessionId)) return null;
  return { actorId: userData.user.id, sessionId };
}
export async function subscriptionAvailability(actorId: string) {
  const client = createServiceClient();
  const profileId = localFakeBillingEnabled() ? process.env.BILLING_FAKE_PROFILE_ID : process.env.BILLING_PRIMARY_PROFILE_ID;
  const runtime = isUuid(profileId) ? createSubscriptionBillingRuntime(client, profileId) : null;
  const { data, error } = await client.rpc('service_get_subscription_availability', { p_actor_id: actorId, p_profile_id: runtime?.identity.profileId ?? null });
  if (error || !billingRecord(data) || typeof data.publicEnabled !== 'boolean' || typeof data.hasHistory !== 'boolean') throw new Error('subscriptions_unavailable');
  const canEnroll = Boolean(data.publicEnabled && runtime && subscriptionSiteOrigin() && billingRecord(data.profile)
    && billingProfileMatches(runtime.identity, data.profile as unknown as BillingProfileIdentity)
    && data.profile.adapter === (runtime.fake ? 'fake' : 'toss'));
  return { canEnroll, menuAvailable: canEnroll || data.hasHistory, runtime: canEnroll ? runtime : null, client };
}
export async function newBillingRegistrationService(actorId: string) {
  const availability = await subscriptionAvailability(actorId), siteOrigin = subscriptionSiteOrigin();
  if (!availability.runtime || !siteOrigin) return null;
  return createBillingRegistrationService({ ...availability.runtime, profile: availability.runtime.identity, siteOrigin,
    repository: createBillingRegistrationRepository(availability.client) });
}
export async function existingBillingRegistrationService(actor: BillingRegistrationActor, id: string) {
  const client = createServiceClient(), repository = createBillingRegistrationRepository(client);
  const entry = parseBillingRegistrationEntry(await repository.read({ ...actor, id }));
  if (!entry || entry.id !== id || entry.ownerId !== actor.actorId || entry.sessionId !== actor.sessionId) return null;
  const runtime = createSubscriptionBillingRuntime(client, entry.profileId, entry), siteOrigin = subscriptionSiteOrigin();
  return runtime && siteOrigin ? createBillingRegistrationService({ ...runtime, profile: runtime.identity, siteOrigin, repository }) : null;
}
