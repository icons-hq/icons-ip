import { beforeEach, expect, it, vi, type Mock } from 'vitest';
import { createBillingVault, type BillingSecretContext } from './billing-crypto.server';
import { createBillingRegistrationService, type BillingRegistrationActor, type BillingRegistrationEntry, type BillingRegistrationRepository } from './registration.server';
import type { RecurringBilling } from './billing-types.server';
import { createFakeRecurringBilling } from './fake-recurring-billing.server';
import { BILLING_TEST_PROFILE } from '../../test/fixtures/recurring-billing';
const actor: BillingRegistrationActor = { actorId: 'b1713000-0000-4000-8000-000000000001', sessionId: 'b1713000-0000-4000-8000-000000000002' };
const id = 'b1713000-0000-4000-8000-000000000003', credentialId = 'b1713000-0000-4000-8000-000000000004', customerKey = 'b1713000-0000-4000-8000-000000000005';
const at = '2026-10-14T02:00:00Z';
const vault = createBillingVault({ activeVersion: 'v1', keys: { v1: new Uint8Array(32).fill(19) } });
const context = (purpose: BillingSecretContext['purpose'], keyId = id): BillingSecretContext => ({ ...BILLING_TEST_PROFILE, ownerId: actor.actorId, id: keyId, purpose });
let entry: BillingRegistrationEntry | null, repo: BillingRegistrationRepository, service: ReturnType<typeof createBillingRegistrationService>, register: Mock<RecurringBilling['register']>, saved: unknown;
beforeEach(() => {
  entry = null; saved = null;
  const adapter = createFakeRecurringBilling({ identity: BILLING_TEST_PROFILE, now: () => new Date(at) }); register = vi.fn(adapter.register);
  repo = {
    prepare: vi.fn(async input => {
      entry ??= { ...BILLING_TEST_PROFILE, id: input.operationId, ownerId: input.actorId, sessionId: input.sessionId, credentialId, customerKey,
        state: 'prepared', expiresAt: '2026-10-14T02:10:00Z', writeKeyVersion: input.writeKeyVersion, idempotencyKey: `registration:${id}`,
        nonceEnvelope: input.nonceEnvelope, authEnvelope: null, firstDispatchedAt: null, claimToken: null, claimFence: 0, recoveryUntil: null };
      return structuredClone(entry);
    }),
    read: vi.fn(async () => structuredClone(entry)),
    claim: vi.fn(async input => {
      entry = { ...entry!, state: 'processing', firstDispatchedAt: entry!.firstDispatchedAt ?? at, authEnvelope: entry!.authEnvelope ?? input.authEnvelope,
        claimToken: input.claimToken, claimFence: entry!.claimFence + 1, recoveryUntil: '2026-10-15T02:00:00Z' };
      return { ...structuredClone(entry), kind: 'claimed' };
    }),
    finish: vi.fn(async input => { saved = input; entry = { ...entry!, state: input.state, claimToken: null }; return { id, state: input.state, credentialId: input.state === 'ready' ? credentialId : null, expiresAt: entry.expiresAt }; }),
  };
  service = createBillingRegistrationService({ repository: repo, vault, billing: { ...adapter, register }, profile: BILLING_TEST_PROFILE,
    clientKey: 'test-public-key', writeKeyVersion: 'v1', siteOrigin: 'http://localhost:3100', fake: true });
});
it('같은 요청 준비는 최초 nonce를 복구하고 브라우저에는 암호문이나 내부 profile을 전달하지 않는다', async () => {
  const first = await service.prepare(actor, id), second = await service.prepare(actor, id);
  expect(second.nonce).toBe(first.nonce); expect(second.registration.successUrl).toBe(`http://localhost:3100/api/subscriptions/billing/registration/${id}/callback`);
  expect(JSON.stringify(first.registration)).not.toMatch(/nonceEnvelope|authEnvelope|profileId|merchantId|writeKeyVersion/);
  expect(first.registration.clientKey).toBeNull(); expect(first.nonce).toHaveLength(43);
});
it('콜백의 카드 키는 즉시 계정과 credential UUID에 묶인 암호문으로만 DB에 저장한다', async () => {
  const start = await service.prepare(actor, id); const result = await service.complete(actor, id, start.nonce, 'fake_auth_fixture', customerKey);
  expect(result.state).toBe('ready'); expect(register).toHaveBeenCalledTimes(1);
  expect(saved).not.toHaveProperty('billingKey'); const stored = saved as Parameters<BillingRegistrationRepository['finish']>[0];
  const key = vault.open(stored.envelope!, context('billing_key', credentialId)); expect(key).toMatch(/^fake_billing_/);
  expect(JSON.stringify(result)).not.toContain(key); expect(() => vault.open(stored.envelope!, context('billing_key'))).toThrow();
});
it('준비되지 않은 authKey, 잘못된 nonce·고객·계정·세션은 provider 호출 전에 거절한다', async () => {
  const start = await service.prepare(actor, id);
  await expect(service.retry(actor, id, start.nonce)).rejects.toThrow('billing_registration_unavailable');
  await expect(service.complete(actor, id, 'z'.repeat(43), 'fake_auth_fixture', customerKey)).rejects.toThrow();
  await expect(service.complete(actor, id, start.nonce, 'fake_auth_fixture', credentialId)).rejects.toThrow();
  await expect(service.complete({ ...actor, actorId: credentialId }, id, start.nonce, 'fake_auth_fixture', customerKey)).rejects.toThrow();
  await expect(service.complete({ ...actor, sessionId: credentialId }, id, start.nonce, 'fake_auth_fixture', customerKey)).rejects.toThrow();
  expect(register).not.toHaveBeenCalled();
});
it('최초 승인 결과를 잃은 후에는 저장한 auth envelope와 최초 idempotency/version을 그대로 복구한다', async () => {
  const start = await service.prepare(actor, id); register.mockResolvedValueOnce({ state: 'unknown', reasonCode: 'billing_registration_unavailable' });
  expect((await service.complete(actor, id, start.nonce, 'fake_auth_fixture', customerKey)).state).toBe('unknown');
  expect((await service.retry(actor, id, start.nonce)).state).toBe('ready');
  expect(register.mock.calls[1][0]).toEqual(register.mock.calls[0][0]);
});
it('재시도에서 다른 authKey를 섞거나 잘못된 claim token을 반환하면 발송하지 않는다', async () => {
  const start = await service.prepare(actor, id); register.mockResolvedValueOnce({ state: 'unknown', reasonCode: 'unknown' });
  await service.complete(actor, id, start.nonce, 'fake_auth_fixture', customerKey);
  await expect(service.complete(actor, id, start.nonce, 'fake_auth_changed', customerKey)).rejects.toThrow();
  vi.mocked(repo.claim).mockResolvedValueOnce({ ...entry, claimToken: credentialId, kind: 'claimed' });
  await expect(service.retry(actor, id, start.nonce)).rejects.toThrow(); expect(register).toHaveBeenCalledTimes(1);
});
it('완료된 요청과 다른 작업자가 점유한 요청은 provider를 다시 부르지 않는다', async () => {
  const start = await service.prepare(actor, id); vi.mocked(repo.claim).mockResolvedValueOnce({ kind: 'busy' });
  await service.complete(actor, id, start.nonce, 'fake_auth_fixture', customerKey); expect(register).not.toHaveBeenCalled();
  await service.complete(actor, id, start.nonce, 'fake_auth_fixture', customerKey);
  await service.complete(actor, id, start.nonce, 'fake_auth_fixture', customerKey); expect(register).toHaveBeenCalledTimes(1);
});
