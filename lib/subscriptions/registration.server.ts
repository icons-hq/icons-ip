import 'server-only';

import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { isUuid } from '../uuid';
import { parseBillingSecretEnvelope, type BillingSecretContext, type BillingSecretEnvelope, type BillingVault } from './billing-crypto.server';
import { billingInstant, billingOpaque, billingProfileMatches, billingProfileValid, billingRecord, billingVersion, type BillingProfileIdentity, type RecurringBilling } from './billing-types.server';

export interface BillingRegistrationActor { actorId: string; sessionId: string }
export interface BillingRegistrationEntry extends BillingProfileIdentity {
  id: string; ownerId: string; sessionId: string; credentialId: string; customerKey: string;
  state: 'prepared' | 'processing' | 'ready' | 'declined' | 'unknown' | 'needs_review' | 'expired';
  expiresAt: string; writeKeyVersion: string; idempotencyKey: string;
  nonceEnvelope: BillingSecretEnvelope; authEnvelope: BillingSecretEnvelope | null;
  firstDispatchedAt: string | null; claimToken: string | null; claimFence: number; recoveryUntil: string | null;
}
export type BillingRegistrationSummary = Pick<BillingRegistrationEntry, 'id' | 'state' | 'expiresAt'> & { credentialId: string | null };
export interface BillingRegistrationRepository {
  prepare(input: BillingRegistrationActor & { operationId: string; profileId: string; nonceDigest: string; nonceEnvelope: BillingSecretEnvelope; writeKeyVersion: string }): Promise<unknown>;
  read(input: BillingRegistrationActor & { id: string }): Promise<unknown>;
  claim(input: BillingRegistrationActor & { id: string; nonceDigest: string; authEnvelope: BillingSecretEnvelope; authFingerprint: string; claimToken: string }): Promise<unknown>;
  finish(input: { actorId: string; id: string; claimToken: string; claimFence: number; state: 'ready' | 'declined' | 'unknown' | 'needs_review';
    envelope?: BillingSecretEnvelope; card?: { issuerCode: string; number: string }; authenticatedAt?: string; reason?: string }): Promise<unknown>;
}
const digest = (purpose: string, value: string) => createHash('sha256').update(JSON.stringify(['icons:billing-registration', purpose, value])).digest('hex');
const fail = (): never => { throw new Error('billing_registration_unavailable'); };
const states = ['prepared', 'processing', 'ready', 'declined', 'unknown', 'needs_review', 'expired'];
export function parseBillingRegistrationSummary(value: unknown): BillingRegistrationSummary | null {
  if (!billingRecord(value) || !isUuid(value.id) || !states.includes(value.state as string) || !billingInstant(value.expiresAt)
    || (value.credentialId !== null && !isUuid(value.credentialId))) return null;
  return { id: value.id, state: value.state as BillingRegistrationSummary['state'], expiresAt: value.expiresAt, credentialId: value.credentialId as string | null };
}
export function parseBillingRegistrationEntry(value: unknown): BillingRegistrationEntry | null {
  if (!billingRecord(value) || !parseBillingRegistrationSummary(value)
    || ![value.ownerId, value.sessionId, value.credentialId, value.customerKey].every(isUuid)
    || !billingProfileValid(value as unknown as BillingProfileIdentity) || !billingVersion(value.writeKeyVersion)
    || !billingOpaque(value.idempotencyKey, 300) || !Number.isSafeInteger(value.claimFence) || (value.claimFence as number) < 0
    || (value.firstDispatchedAt !== null && !billingInstant(value.firstDispatchedAt))
    || (value.recoveryUntil !== null && !billingInstant(value.recoveryUntil)) || (value.claimToken !== null && !isUuid(value.claimToken))) return null;
  const nonceEnvelope = parseBillingSecretEnvelope(value.nonceEnvelope), authEnvelope = value.authEnvelope === null ? null : parseBillingSecretEnvelope(value.authEnvelope);
  if (!nonceEnvelope || value.authEnvelope !== null && !authEnvelope) return null;
  return { ...value, nonceEnvelope, authEnvelope } as unknown as BillingRegistrationEntry;
}

/** Browser receives only the SDK public configuration. All keys and provider results remain server-side. */
export function createBillingRegistrationService(options: {
  repository: BillingRegistrationRepository; vault: BillingVault; billing: RecurringBilling;
  profile: BillingProfileIdentity; clientKey: string; writeKeyVersion: string; siteOrigin: string; fake: boolean;
}) {
  const identity = options.profile;
  function actorValid(actor: BillingRegistrationActor) { if (!isUuid(actor.actorId) || !isUuid(actor.sessionId)) fail(); }
  function context(actor: BillingRegistrationActor, id: string, purpose: BillingSecretContext['purpose']): BillingSecretContext {
    return { ...identity, ownerId: actor.actorId, id, purpose };
  }
  function checked(value: unknown, actor: BillingRegistrationActor, id: string) {
    const entry = parseBillingRegistrationEntry(value);
    if (!entry || entry.id !== id || entry.ownerId !== actor.actorId || entry.sessionId !== actor.sessionId || !billingProfileMatches(entry, identity)) return fail();
    return entry;
  }
  function summary(entry: BillingRegistrationEntry): BillingRegistrationSummary {
    return { id: entry.id, state: entry.state, expiresAt: entry.expiresAt, credentialId: entry.state === 'ready' ? entry.credentialId : null };
  }
  async function complete(actor: BillingRegistrationActor, id: string, nonce: string, authKey?: string, customerKey?: string) {
    actorValid(actor); if (!isUuid(id) || !/^[A-Za-z0-9_-]{43}$/.test(nonce)) return fail();
    const entry = checked(await options.repository.read({ ...actor, id }), actor, id);
    const expected = options.vault.open(entry.nonceEnvelope, context(actor, id, 'registration_nonce'));
    const a = Buffer.from(nonce), b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return fail();
    if (['ready', 'declined', 'expired'].includes(entry.state)) return summary(entry);
    let exactAuth: string;
    if (entry.authEnvelope) {
      exactAuth = options.vault.open(entry.authEnvelope, context(actor, id, 'registration_auth'));
      if (authKey !== undefined && exactAuth !== authKey) return fail();
    } else {
      if (!billingOpaque(authKey, 300) || !isUuid(customerKey) || customerKey !== entry.customerKey) return fail();
      exactAuth = authKey;
    }
    if (customerKey !== undefined && customerKey !== entry.customerKey) return fail();
    const claimToken = randomUUID();
    const raw = await options.repository.claim({ ...actor, id, nonceDigest: digest('nonce', nonce),
      authEnvelope: options.vault.seal(exactAuth, context(actor, id, 'registration_auth')), authFingerprint: digest('auth', exactAuth), claimToken });
    if (!billingRecord(raw)) return fail();
    if (raw.kind === 'busy') return summary(entry);
    const claimed = checked(raw, actor, id);
    if (raw.kind !== 'claimed') return summary(claimed);
    if (claimed.claimToken !== claimToken || !claimed.firstDispatchedAt || !claimed.authEnvelope) return fail();
    const result = await options.billing.register({ ...identity, customerKey: claimed.customerKey,
      authKey: options.vault.open(claimed.authEnvelope, context(actor, id, 'registration_auth')), writeKeyVersion: claimed.writeKeyVersion,
      idempotencyKey: claimed.idempotencyKey, firstDispatchedAt: claimed.firstDispatchedAt });
    const finished = await options.repository.finish({ actorId: actor.actorId, id, claimToken, claimFence: claimed.claimFence, state: result.state,
      ...(result.state === 'ready' ? { envelope: options.vault.seal(result.billingKey, context(actor, claimed.credentialId, 'billing_key')),
        card: result.card, authenticatedAt: result.authenticatedAt } : { reason: result.reasonCode }) });
    const clean = parseBillingRegistrationSummary(finished); if (!clean || clean.id !== id) return fail();
    return clean;
  }
  return {
    async prepare(actor: BillingRegistrationActor, operationId: string) {
      actorValid(actor); if (!isUuid(operationId)) return fail();
      const nonce = randomBytes(32).toString('base64url');
      const entry = checked(await options.repository.prepare({ ...actor, operationId, profileId: identity.profileId, writeKeyVersion: options.writeKeyVersion,
        nonceDigest: digest('nonce', nonce), nonceEnvelope: options.vault.seal(nonce, context(actor, operationId, 'registration_nonce')) }), actor, operationId);
      const originalNonce = options.vault.open(entry.nonceEnvelope, context(actor, operationId, 'registration_nonce'));
      const callback = `${options.siteOrigin}/api/subscriptions/billing/registration/${operationId}/callback`;
      return { nonce: originalNonce, registration: { ...summary(entry), fake: options.fake, clientKey: options.fake ? null : options.clientKey,
        customerKey: entry.customerKey, successUrl: callback, failUrl: callback } };
    },
    complete,
    async retry(actor: BillingRegistrationActor, id: string, nonce: string) { return complete(actor, id, nonce); },
    async read(actor: BillingRegistrationActor, id: string) { actorValid(actor); if (!isUuid(id)) return fail(); return summary(checked(await options.repository.read({ ...actor, id }), actor, id)); },
  };
}

type RpcClient = { rpc(name: string, parameters: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> };
export function createBillingRegistrationRepository(client: RpcClient): BillingRegistrationRepository {
  async function call(name: string, parameters: Record<string, unknown>) { const { data, error } = await client.rpc(name, parameters); if (error) return fail(); return data; }
  return {
    prepare: value => call('service_prepare_billing_registration', { p_actor_id: value.actorId, p_session_id: value.sessionId,
      p_operation_id: value.operationId, p_profile_id: value.profileId, p_nonce_digest: value.nonceDigest, p_nonce_envelope: value.nonceEnvelope, p_write_key_version: value.writeKeyVersion }),
    read: value => call('service_get_billing_registration', { p_actor_id: value.actorId, p_session_id: value.sessionId, p_id: value.id }),
    claim: value => call('service_claim_billing_registration', { p_actor_id: value.actorId, p_session_id: value.sessionId, p_id: value.id,
      p_nonce_digest: value.nonceDigest, p_auth_envelope: value.authEnvelope, p_auth_fingerprint: value.authFingerprint, p_claim_token: value.claimToken }),
    finish: value => call('service_finish_billing_registration', { p_actor_id: value.actorId, p_id: value.id, p_claim_token: value.claimToken,
      p_claim_fence: value.claimFence, p_state: value.state, p_envelope: value.envelope ?? null, p_card: value.card ?? null,
      p_authenticated_at: value.authenticatedAt ?? null, p_reason: value.reason ?? null }),
  };
}
