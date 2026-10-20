import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), worker: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/subscriptions/worker.server', () => ({ runtimeGoodsSubscriptionWorker: () => ({ run: mocks.worker }) }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { inspectGoodsSubscriptionPaymentAction } from './subscription-actions';
import { subscriptionId as id } from '../../test/fixtures/goods-subscriptions';
const input = { expectedActorId: id(10), cycleId: id(3), operationId: id(20) };
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: id(10) } });
  mocks.rpc.mockResolvedValue({ error: null, data: { ...input, planId: id(1) } }); mocks.worker.mockResolvedValue({ state: 'approved' }); });
it('sales.manage와 expected actor가 맞아야 inspection receipt를 생성한다', async () => {
  mocks.access.mockResolvedValueOnce(null); expect((await inspectGoodsSubscriptionPaymentAction(input)).ok).toBe(false); expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.access.mockResolvedValueOnce({ user: { id: id(99) } }); expect((await inspectGoodsSubscriptionPaymentAction(input)).ok).toBe(false); expect(mocks.worker).not.toHaveBeenCalled();
});
it('DB의 기존 회차 감사 receipt와 현재 권한을 다시 확인한 뒤 manual inspect만 실행한다', async () => {
  expect((await inspectGoodsSubscriptionPaymentAction(input)).ok).toBe(true); expect(mocks.access).toHaveBeenCalledTimes(2);
  expect(mocks.worker).toHaveBeenCalledExactlyOnceWith(id(3), true); expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.worker.mock.invocationCallOrder[0]);
});
it('중간 권한 상실·다른 영수증·DB 거절은 provider 조회도 실행하지 않는다', async () => {
  mocks.access.mockResolvedValueOnce({ user: { id: id(10) } }).mockResolvedValueOnce(null); expect((await inspectGoodsSubscriptionPaymentAction(input)).ok).toBe(false);
  mocks.rpc.mockResolvedValueOnce({ error: null, data: { ...input, operationId: id(21), planId: id(1) } }); expect(await inspectGoodsSubscriptionPaymentAction(input)).toMatchObject({ ok: false, uncertain: true });
  mocks.rpc.mockResolvedValueOnce({ error: { code: '55000' }, data: null }); expect(await inspectGoodsSubscriptionPaymentAction(input)).toMatchObject({ ok: false, uncertain: false }); expect(mocks.worker).not.toHaveBeenCalled();
});
