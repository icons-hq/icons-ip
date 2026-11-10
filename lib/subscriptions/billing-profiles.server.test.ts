import { describe, expect, it } from 'vitest';
import { billingProfilesFromEnvironment, createBillingProfileRegistry } from './billing-profiles.server';
import { BILLING_TEST_PROFILE } from '../../test/fixtures/recurring-billing';

describe('billing credential profiles', () => {
  it('조회는 현재 키, POST 재생은 최초 버전을 선택하며 공개 준비값은 시크릿을 포함하지 않는다', () => {
    const registry = createBillingProfileRegistry([BILLING_TEST_PROFILE]);
    expect(registry.secret(BILLING_TEST_PROFILE)).toBe(BILLING_TEST_PROFILE.secretKeys.v2);
    expect(registry.secret(BILLING_TEST_PROFILE, 'v1')).toBe(BILLING_TEST_PROFILE.secretKeys.v1);
    expect(registry.secret(BILLING_TEST_PROFILE, 'toString')).toBeNull();
    expect(JSON.stringify(registry.registration(BILLING_TEST_PROFILE.profileId))).not.toContain('test_sk_');
  });

  it('MID·환경·profile 변경과 폐기된 write version을 fallback 없이 거절한다', () => {
    const registry = createBillingProfileRegistry([{ ...BILLING_TEST_PROFILE, secretKeys: { v2: BILLING_TEST_PROFILE.secretKeys.v2 } }]);
    expect(registry.secret(BILLING_TEST_PROFILE, 'v1')).toBeNull();
    expect(registry.secret({ ...BILLING_TEST_PROFILE, merchantId: 'changed' })).toBeNull();
    expect(registry.secret({ ...BILLING_TEST_PROFILE, environment: 'live' })).toBeNull();
    expect(registry.identity('b1711000-0000-4000-8000-000000000099')).toBeNull();
  });

  it('주문서형 gck/gsk·test/live 혼합·중복 profile·상속된 키를 거절한다', () => {
    expect(() => createBillingProfileRegistry([{ ...BILLING_TEST_PROFILE, clientKey: BILLING_TEST_PROFILE.clientKey.replace('_ck_', '_gck_') }])).toThrow('invalid_billing_profiles');
    expect(() => createBillingProfileRegistry([{ ...BILLING_TEST_PROFILE, environment: 'live' }])).toThrow('invalid_billing_profiles');
    expect(() => createBillingProfileRegistry([BILLING_TEST_PROFILE, BILLING_TEST_PROFILE])).toThrow('invalid_billing_profiles');
    expect(() => createBillingProfileRegistry([{ ...BILLING_TEST_PROFILE, currentKeyVersion: 'toString', secretKeys: {} }])).toThrow('invalid_billing_profiles');
    expect(billingProfilesFromEnvironment({ TOSS_BILLING_CREDENTIAL_PROFILES: JSON.stringify([BILLING_TEST_PROFILE]) })?.identity(BILLING_TEST_PROFILE.profileId))
      .toEqual({ profileId: BILLING_TEST_PROFILE.profileId, merchantId: BILLING_TEST_PROFILE.merchantId, environment: 'test' });
  });
});
