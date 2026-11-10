import { beforeEach, expect, it, vi } from 'vitest';
import { billingChargeFixture } from '../../test/fixtures/recurring-billing';
import { createBillingVault } from './billing-crypto.server';
import type { RecurringBilling } from './billing-types.server';
import { createGoodsSubscriptionWorker, type SubscriptionWorkerRepository } from './worker.server';
const fixture = billingChargeFixture(), now = () => new Date(fixture.binding.firstDispatchedAt);
const vault = createBillingVault({ activeVersion: 'v1', keys: { v1: new Uint8Array(32).fill(31) } });
const rawAttempt = { id: fixture.attempt.id, provider: 'toss', purpose: 'order', ref_id: fixture.attempt.refId, amount: fixture.attempt.amount,
  currency: 'KRW', idempotency_key: fixture.attempt.idempotencyKey, provider_order_id: fixture.attempt.providerOrderId,
  provider_product_code: fixture.attempt.providerProductCode, expires_at: fixture.attempt.expiresAt };
let repository: SubscriptionWorkerRepository, billing: RecurringBilling, work: Record<string, unknown>, token: string;
let worker: ReturnType<typeof createGoodsSubscriptionWorker>;
beforeEach(() => {
  const approved = { attemptId: fixture.attempt.id, provider: 'toss' as const, outcome: 'approved' as const };
  billing = { register: vi.fn(), charge: vi.fn(async () => approved), inspect: vi.fn(async () => approved), refund: vi.fn(), revoke: vi.fn() };
  work = { kind: 'charge', attempt: rawAttempt, binding: fixture.binding, customerKey: fixture.customerKey,
    envelope: vault.seal(fixture.billingKey, { ...fixture.binding, purpose: 'billing_key', id: fixture.binding.credentialId }) };
  repository = {
    claim: vi.fn(async value => { token = value; return { cycleId: fixture.binding.cycleId, actorId: fixture.binding.ownerId,
      termsId: fixture.binding.credentialId, token, fence: 7, expiresAt: new Date(now().getTime() + 600_000).toISOString(), profile: {
        profileId: fixture.binding.profileId, merchantId: fixture.binding.merchantId, environment: fixture.binding.environment } }; }),
    prepare: vi.fn(async () => work), finish: vi.fn(async (_lease, outcome) => outcome.outcome),
  };
  worker = createGoodsSubscriptionWorker({ repository, now, runtime: () => ({ identity: fixture.binding, writeKeyVersion: fixture.binding.writeKeyVersion, vault, billing }) });
});
it('한 회차는 DB가 고정한 attempt·금액·카드로 한 번만 청구하고 같은 fence로 확정한다', async () => {
  expect(await worker.run()).toMatchObject({ state: 'approved', cycleId: fixture.binding.cycleId, orderId: fixture.attempt.refId });
  expect(billing.charge).toHaveBeenCalledExactlyOnceWith(fixture);
  expect(repository.finish).toHaveBeenCalledWith(expect.objectContaining({ token, fence: 7 }), expect.objectContaining({ outcome: 'approved' }));
});
it('회수한 발송 건은 billing key를 복호화하거나 다시 청구하지 않고 조회한다', async () => {
  work = { ...work, kind: 'inspect', envelope: 'invalid' }; await worker.run();
  expect(billing.inspect).toHaveBeenCalledExactlyOnceWith({ attempt: fixture.attempt, binding: fixture.binding });
  expect(billing.charge).not.toHaveBeenCalled();
});
it.each(['wait', 'stopped', 'terminal', 'gate_closed'])('%s 결정에는 외부 결제를 실행하지 않는다', async kind => {
  work = { kind }; expect((await worker.run()).state).toBe(kind); expect(billing.charge).not.toHaveBeenCalled(); expect(billing.inspect).not.toHaveBeenCalled();
});
it('만료 임대와 잘못된 회차 binding은 외부 요청 전에 거절한다', async () => {
  vi.mocked(repository.claim).mockImplementationOnce(async claim => ({ cycleId: fixture.binding.cycleId, actorId: fixture.binding.ownerId,
    termsId: fixture.binding.credentialId, token: claim, fence: 1, expiresAt: now().toISOString(), profile: fixture.binding }));
  await expect(worker.run()).rejects.toThrow('invalid_subscription_lease'); expect(repository.prepare).not.toHaveBeenCalled();
  work = { ...work, binding: { ...fixture.binding, ownerId: fixture.binding.credentialId } };
  await expect(worker.run()).rejects.toThrow('invalid_subscription_work'); expect(billing.charge).not.toHaveBeenCalled();
});
it('운영자 재조회가 신규 charge로 바뀌는 잘못된 서버 응답을 거절한다', async () => {
  await expect(worker.run(fixture.binding.cycleId, true)).rejects.toThrow('invalid_subscription_work'); expect(billing.charge).not.toHaveBeenCalled();
});
it('provider 전송 예외는 같은 회차 unknown으로 확정하고 두 번째 청구를 시작하지 않는다', async () => {
  vi.mocked(billing.charge).mockRejectedValueOnce(new Error('connection lost'));
  expect((await worker.run()).state).toBe('unknown'); expect(billing.charge).toHaveBeenCalledTimes(1);
  expect(repository.finish).toHaveBeenCalledWith(expect.objectContaining({ fence: 7 }), expect.objectContaining({ outcome: 'unknown' }));
});
it('다른 credential에 묶인 암호문은 provider에 전달하지 않는다', async () => {
  work.envelope = vault.seal(fixture.billingKey, { ...fixture.binding, purpose: 'billing_key', id: fixture.binding.cycleId });
  expect((await worker.run()).state).toBe('unknown'); expect(billing.charge).not.toHaveBeenCalled();
});
it('DB 확정 응답 손실 뒤 새 실행은 repository의 inspect 결정을 그대로 따른다', async () => {
  vi.mocked(repository.finish).mockRejectedValueOnce(new Error('lost commit response'));
  await expect(worker.run()).rejects.toThrow(); work = { ...work, kind: 'inspect' };
  expect((await worker.run()).state).toBe('approved'); expect(billing.charge).toHaveBeenCalledTimes(1); expect(billing.inspect).toHaveBeenCalledTimes(1);
});

it('DB 승인 확정 뒤에만 메일 훅을 실행하고 메일 예외로 결제 결과를 되돌리지 않는다', async () => {
  const onApproved = vi.fn(async () => { throw new Error('email temporarily unavailable'); });
  worker = createGoodsSubscriptionWorker({ repository, now, onApproved, runtime: () => ({ identity: fixture.binding, writeKeyVersion: fixture.binding.writeKeyVersion, vault, billing }) });
  expect((await worker.run()).state).toBe('approved'); expect(onApproved).toHaveBeenCalledExactlyOnceWith(fixture.attempt.refId);
  expect(vi.mocked(repository.finish).mock.invocationCallOrder[0]).toBeLessThan(onApproved.mock.invocationCallOrder[0]);
  vi.mocked(repository.finish).mockResolvedValueOnce('unknown'); await worker.run(); expect(onApproved).toHaveBeenCalledTimes(1);
});
it('이미 확정된 회차 복구는 DB가 확인한 주문 ID로 메일 훅만 멱등 재실행한다', async () => {
  const onApproved = vi.fn(async () => {});
  worker = createGoodsSubscriptionWorker({ repository, now, onApproved, runtime: () => null });
  work = { kind: 'terminal', outcome: 'approved', orderId: fixture.attempt.refId };
  expect((await worker.run()).state).toBe('approved'); expect(onApproved).toHaveBeenCalledExactlyOnceWith(fixture.attempt.refId);
  expect(billing.charge).not.toHaveBeenCalled(); expect(billing.inspect).not.toHaveBeenCalled(); expect(repository.finish).not.toHaveBeenCalled();
  work = { kind: 'terminal', outcome: 'approved' }; await expect(worker.run()).rejects.toThrow('invalid_subscription_finalization'); expect(onApproved).toHaveBeenCalledTimes(1);
});

it('발송한 회차 조회는 vault 없이 복구하되 신규 write 버전을 제안하지 않는다', async () => {
  work = { ...work, kind: 'inspect' };
  worker = createGoodsSubscriptionWorker({ repository, now, runtime: () => ({ identity: fixture.binding, writeKeyVersion: null, vault: null, billing }) });
  expect((await worker.run()).state).toBe('approved'); expect(repository.prepare).toHaveBeenCalledWith(expect.anything(), fixture.binding, null);
  expect(billing.inspect).toHaveBeenCalledTimes(1); expect(billing.charge).not.toHaveBeenCalled();
});
