import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
import { readAccountSettlementConfiguration } from './accounts.server';
import { parseSettlementAccountKey, settlementAccountKey } from './accounts';
const id = 'ab140000-0000-4000-8000-000000000020', accountId = 'ab140000-0000-4000-8000-000000000025';
const identity = { profileId: id, merchantId: 'billingmid', environment: 'test' as const };
const account = { accountId, integration: 'toss_billing' as const, profileId: id, merchantId: 'billingmid', mode: 'test' as const };
const rpc = vi.fn(async () => ({ data: account, error: null }));
function profiles(version = 'v1', mid = identity.merchantId) { return JSON.stringify([{ ...identity, merchantId: mid, clientKey: `test_ck_${'c'.repeat(25)}`, currentKeyVersion: version,
  secretKeys: { v1: `test_sk_${'a'.repeat(25)}`, v2: `test_sk_${'b'.repeat(25)}` } }]); }
beforeEach(() => { rpc.mockResolvedValue({ data: account, error: null });vi.stubEnv('TOSS_SETTLEMENT_SYNC_ENABLED', 'true');vi.stubEnv('TOSS_BILLING_CREDENTIAL_PROFILES', profiles());vi.stubEnv('VERCEL_ENV', 'preview'); });
afterEach(() => vi.unstubAllEnvs());
it('opaque 계정의 서버 전용 정체성과 현재 billing key를 결합하고 키 교체에도 scope를 유지한다', async () => {
  const first = (await readAccountSettlementConfiguration(accountId, undefined, { rpc }))!;expect(first.secretKey).toBe(`test_sk_${'a'.repeat(25)}`);
  vi.stubEnv('TOSS_BILLING_CREDENTIAL_PROFILES', profiles('v2'));const second = (await readAccountSettlementConfiguration(accountId, account, { rpc }))!;
  expect(second.secretKey).toBe(`test_sk_${'b'.repeat(25)}`);expect(second.scopeHash).toBe(first.scopeHash);expect(second.mId).toBe('billingmid');
  expect(rpc).toHaveBeenCalledWith('service_get_pg_settlement_account', { p_account_id: accountId });
});
it('저장된 계정과 환경이 다르거나 registry의 MID가 다른 경우 연결하지 않는다', async () => {
  for (const expected of [{ ...account, mode: 'live' as const }, { ...account, integration: 'toss_payment' as const }, { ...account, accountId: 'ab140000-0000-4000-8000-000000000026' }]) {
    expect(await readAccountSettlementConfiguration(accountId, expected, { rpc })).toBeNull();
  }
  vi.stubEnv('TOSS_BILLING_CREDENTIAL_PROFILES', profiles('v1', 'othermid'));expect(await readAccountSettlementConfiguration(accountId, undefined, { rpc })).toBeNull();
  vi.stubEnv('TOSS_BILLING_CREDENTIAL_PROFILES', 'invalid');expect(await readAccountSettlementConfiguration(accountId, undefined, { rpc })).toBeNull();
});
it('실거래 키는 Preview에서 실패하고 수집 gate가 꺼진 경우에도 연결하지 않는다', async () => {
  vi.stubEnv('TOSS_BILLING_CREDENTIAL_PROFILES', profiles().replaceAll('test', 'live'));expect(await readAccountSettlementConfiguration(accountId, undefined, { rpc })).toBeNull();
  vi.stubEnv('TOSS_BILLING_CREDENTIAL_PROFILES', profiles());vi.stubEnv('TOSS_SETTLEMENT_SYNC_ENABLED', 'false');expect(await readAccountSettlementConfiguration(accountId, undefined, { rpc })).toBeNull();
});
it('계정 URL은 opaque UUID 또는 초기 연결 표시만 허용하고 MID와 profile 라우트를 거절한다', () => {
  expect(settlementAccountKey(account)).toBe(accountId);expect(parseSettlementAccountKey('current')).toBe('current');
  for (const value of [`billing:${id}`, 'regular:billingmid', 'regular:', 'regular:a b', 'secret:abc']) expect(parseSettlementAccountKey(value)).toBeNull();
});
