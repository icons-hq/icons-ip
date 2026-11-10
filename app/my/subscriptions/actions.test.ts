import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), user: vi.fn(), load: vi.fn(), worker: vi.fn(), revoke: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc, auth: { getUser: mocks.user } }) }));
vi.mock('@/lib/subscriptions/customer.server', () => ({ loadMyGoodsSubscription: mocks.load }));
vi.mock('@/lib/subscriptions/worker.server', () => ({ runtimeGoodsSubscriptionWorker: () => ({ run: mocks.worker }) }));
vi.mock('@/lib/subscriptions/credential-revocation.server', () => ({ revokeBillingCredential: mocks.revoke }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import { confirmGoodsSubscriptionAction, changeGoodsSubscriptionStateAction, prepareGoodsSubscriptionAction, readGoodsSubscriptionAction } from './actions';
import { subscriptionPlan, subscriptionId as id } from '../../../test/fixtures/goods-subscriptions';
const input = { expectedActorId: id(10), operationId: id(20), planId: subscriptionPlan.id, cycleId: subscriptionPlan.firstCycleId, expectedRevision: 1,
  quoteId: subscriptionPlan.firstQuoteId!, termsId: subscriptionPlan.termsId, credentialId: subscriptionPlan.card!.id, consent: true };
beforeEach(() => {
  vi.clearAllMocks(); mocks.user.mockResolvedValue({ data: { user: { id: id(10) } }, error: null }); mocks.load.mockResolvedValue(subscriptionPlan);
  mocks.worker.mockResolvedValue({ state: 'approved' }); mocks.rpc.mockResolvedValue({ error: null, data: { operationId: id(20), planId: subscriptionPlan.id,
    cycleId: subscriptionPlan.firstCycleId, orderId: id(4) } });
});
it('동의와 actor 확인 이전에는 DB나 worker를 실행하지 않는다', async () => {
  expect((await confirmGoodsSubscriptionAction({ ...input, consent: false })).ok).toBe(false);
  mocks.user.mockResolvedValueOnce({ data: { user: { id: id(99) } }, error: null }); expect((await confirmGoodsSubscriptionAction(input)).ok).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.worker).not.toHaveBeenCalled();
});
it('정확한 저장 receipt 이후 DB 소유 회차만 worker로 보내고 고객 금액은 보내지 않는다', async () => {
  expect(await confirmGoodsSubscriptionAction(input)).toEqual({ ok: true, value: subscriptionPlan });
  expect(mocks.worker).toHaveBeenCalledExactlyOnceWith(subscriptionPlan.firstCycleId);
  expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.worker.mock.invocationCallOrder[0]);
});
it('다른 operation·회차 receipt와 응답 손실은 uncertain으로 잠그며 worker에 보내지 않는다', async () => {
  mocks.rpc.mockResolvedValueOnce({ error: null, data: { operationId: id(99) } });
  expect(await confirmGoodsSubscriptionAction(input)).toMatchObject({ ok: false, uncertain: true });
  mocks.rpc.mockRejectedValueOnce(new Error('lost response')); expect(await confirmGoodsSubscriptionAction(input)).toMatchObject({ ok: false, uncertain: true });
  expect(mocks.worker).not.toHaveBeenCalled();
});
it('확정 후 provider 처리 오류는 DB 최신 상태를 읽고 readback 실패는 committed로 반환한다', async () => {
  mocks.worker.mockRejectedValueOnce(new Error('provider timeout')); expect((await confirmGoodsSubscriptionAction(input)).ok).toBe(true);
  mocks.load.mockRejectedValueOnce(new Error('read failed')); expect(await confirmGoodsSubscriptionAction(input)).toMatchObject({ ok: false, committed: true });
});
it('CAS 충돌은 새 worker 실행 없이 definite 오류로 반환한다', async () => {
  mocks.rpc.mockResolvedValueOnce({ error: { code: 'PT409', message: 'subscription_changed' }, data: null });
  expect(await changeGoodsSubscriptionStateAction({ ...input, command: 'pause' })).toMatchObject({ ok: false, uncertain: false }); expect(mocks.worker).not.toHaveBeenCalled();
});
it('readback 동안 계정이 바뀌면 이전 주소와 카드가 담긴 DTO를 반환하지 않는다', async () => {
  mocks.user.mockResolvedValueOnce({ data: { user: { id: id(10) } }, error: null }).mockResolvedValueOnce({ data: { user: { id: id(99) } }, error: null });
  expect(await readGoodsSubscriptionAction(id(10), subscriptionPlan.id)).toMatchObject({ ok: false });
});
it('첫 회차 선택·coupon·credit은 서버 견적에 명시적으로 전달한다', async () => {
  const op = subscriptionPlan.firstCycleId; mocks.rpc.mockResolvedValueOnce({ error: null, data: { state: 'prepared', subscription: subscriptionPlan } });
  expect((await prepareGoodsSubscriptionAction({ expectedActorId: id(10), operationId: op, selection: subscriptionPlan.selection, address: subscriptionPlan.address!,
    schedule: subscriptionPlan.schedule, deliveryChoices: subscriptionPlan.deliveryChoices!, userCouponId: subscriptionPlan.firstDisplay.userCouponId, storeCreditAmount: 1000 })).ok).toBe(true);
  expect(mocks.rpc).toHaveBeenCalledWith('prepare_my_goods_subscription', expect.objectContaining({ p_store_credit_amount: 1000, p_operation_id: op }));
});
