import 'server-only';

import { billingProfileMatches, billingProfileValid, billingRecord, billingVersion, type BillingProfileIdentity } from './billing-types.server';

export interface BillingCredentialProfile extends BillingProfileIdentity {
  readonly clientKey: string;
  readonly currentKeyVersion: string;
  readonly secretKeys: Readonly<Record<string, string>>;
}

export interface BillingProfileRegistry {
  identity(profileId: string): BillingProfileIdentity | null;
  registration(profileId: string): { identity: BillingProfileIdentity; clientKey: string; writeKeyVersion: string } | null;
  /** 조회는 current, POST 재생은 최초 발송 때 저장한 정확한 version을 사용한다. */
  secret(identity: BillingProfileIdentity, writeKeyVersion?: string): string | null;
}

function validKey(value: unknown, mode: 'test' | 'live', kind: 'ck' | 'sk'): value is string {
  return typeof value === 'string' && value.length <= 200 && new RegExp(`^${mode}_${kind}_[A-Za-z0-9]{20,}$`).test(value);
}

export function createBillingProfileRegistry(profiles: readonly BillingCredentialProfile[]): BillingProfileRegistry {
  if (!profiles.length || profiles.length > 16) throw new Error('invalid_billing_profiles');
  const entries = new Map<string, BillingCredentialProfile>();
  for (const profile of profiles) {
    if (!billingProfileValid(profile) || entries.has(profile.profileId) || !billingVersion(profile.currentKeyVersion)
      || !validKey(profile.clientKey, profile.environment, 'ck') || !billingRecord(profile.secretKeys)
      || !Object.hasOwn(profile.secretKeys, profile.currentKeyVersion) || Object.keys(profile.secretKeys).length < 1
      || Object.keys(profile.secretKeys).length > 2
      || Object.entries(profile.secretKeys).some(([version, key]) => !billingVersion(version) || !validKey(key, profile.environment, 'sk'))) {
      throw new Error('invalid_billing_profiles');
    }
    entries.set(profile.profileId, { ...profile, secretKeys: { ...profile.secretKeys } });
  }
  const identity = (profile: BillingCredentialProfile): BillingProfileIdentity => ({ profileId: profile.profileId,
    merchantId: profile.merchantId, environment: profile.environment });
  return {
    identity(profileId) { const profile = entries.get(profileId); return profile ? identity(profile) : null; },
    registration(profileId) {
      const profile = entries.get(profileId);
      return profile ? { identity: identity(profile), clientKey: profile.clientKey, writeKeyVersion: profile.currentKeyVersion } : null;
    },
    secret(expected, writeKeyVersion) {
      const profile = entries.get(expected.profileId);
      if (!profile || !billingProfileMatches(expected, profile)) return null;
      const version = writeKeyVersion ?? profile.currentKeyVersion;
      return Object.hasOwn(profile.secretKeys, version) ? profile.secretKeys[version] : null;
    },
  };
}

export function billingProfilesFromEnvironment(environment: Readonly<Record<string, string | undefined>> = process.env): BillingProfileRegistry | null {
  const serialized = environment.TOSS_BILLING_CREDENTIAL_PROFILES;
  if (!serialized || serialized.length > 16_384) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    if (!Array.isArray(value) || value.some(row => !billingRecord(row)
      || Object.keys(row).sort().join(',') !== 'clientKey,currentKeyVersion,environment,merchantId,profileId,secretKeys')) return null;
    if (value.some(row => row.environment === 'live') && environment.VERCEL_ENV !== 'production') return null;
    return createBillingProfileRegistry(value as BillingCredentialProfile[]);
  } catch { return null; }
}
