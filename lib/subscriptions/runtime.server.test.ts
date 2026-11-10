import { expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: vi.fn(), getServiceRoleConfig: vi.fn() }));
import { localFakeBillingEnabled, subscriptionSiteOrigin, createSubscriptionWorkRuntime } from './runtime.server';
const local = { BILLING_FAKE_LOCAL_ENABLED: 'true', BILLING_FAKE_PROFILE_ID: 'b1713000-0000-4000-8000-000000000010',
  NODE_ENV: 'development', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:59921', SITE_URL: 'http://localhost:3100' };
it('합성 원장은 명시적으로 켠 로컬 앱과 로컬 DB 조합에서만 선택한다', () => {
  expect(localFakeBillingEnabled(local)).toBe(true);
  for (const change of [{ VERCEL: '1' }, { VERCEL_ENV: 'preview' }, { NODE_ENV: 'production' }, { BILLING_FAKE_LOCAL_ENABLED: 'false' },
    { SITE_URL: 'https://iconsip.com' }, { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }, { BILLING_FAKE_PROFILE_ID: 'no' }]) {
    expect(localFakeBillingEnabled({ ...local, ...change })).toBe(false);
  }
});
it('운영 callback은 canonical origin으로 제한하고 query·user-info 경로를 거절한다', () => {
  expect(subscriptionSiteOrigin({ SITE_URL: 'https://iconsip.com', VERCEL_ENV: 'production' })).toBe('https://iconsip.com');
  expect(subscriptionSiteOrigin({ SITE_URL: 'https://attacker.example', VERCEL_ENV: 'production' })).toBeNull();
  expect(subscriptionSiteOrigin({ SITE_URL: 'https://iconsip.com/path' })).toBeNull();
  expect(subscriptionSiteOrigin({ SITE_URL: 'https://user:pass@iconsip.com' })).toBeNull();
});

it('worker는 복호화 키 없이 profile/MID가 일치하는 과거 조회만 조립한다', () => {
  const identity = { profileId: 'b1713000-0000-4000-8000-000000000020', merchantId: 'localbilling', environment: 'test' as const };
  const environment = { TOSS_BILLING_CREDENTIAL_PROFILES: JSON.stringify([{ ...identity, clientKey: `test_ck_${'C'.repeat(24)}`,
    currentKeyVersion: 'v2', secretKeys: { v2: `test_sk_${'S'.repeat(24)}` } }]) };
  const runtime = createSubscriptionWorkRuntime({ rpc: vi.fn() }, identity, environment);
  expect(runtime?.identity).toEqual(identity); expect(runtime?.vault).toBeNull(); expect(runtime?.writeKeyVersion).toBeNull();
  expect(createSubscriptionWorkRuntime({ rpc: vi.fn() }, { ...identity, merchantId: 'anothermid' }, environment)).toBeNull();
});
