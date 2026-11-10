import { beforeEach, expect, it, vi } from 'vitest';
import { changeOrderProductionAction, saveGoodsProductionAction } from './production-actions';
const m = vi.hoisted(() => ({ rpc: vi.fn(), auth: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: m.rpc }) }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: m.auth }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
const id = (n: number) => `c7160805-0000-4000-8000-${String(n).padStart(12, '0')}`;
const identity = { actorId: id(1), sessionId: id(2) };
const policy = { goodId: 'made-a', revision: 1, enabled: true, leadDays: 5, dayBasis: 'calendar', closedDates: [], publicNote: 'TEST 안내', evidence: 'TEST 설정', updatedAt: '2026-10-16T00:00:00Z' };
const values = { enabled: true, leadDays: 5, dayBasis: 'calendar', closedDates: [], publicNote: 'TEST 안내', evidence: 'TEST 설정', confirmed: true };
const change = () => changeOrderProductionAction(id(4), id(5), 'start', 1, id(3), 'TEST 실제 작업', identity);
beforeEach(() => { m.rpc.mockReset(); m.auth.mockReset().mockResolvedValue({ user: { id: id(1) } }); m.revalidate.mockReset(); });
it('계정 불일치와 잘못된 납기·휴무일은 쓰기 전에 차단한다', async () => {
 for (const bad of [{ leadDays: 0 }, { leadDays: 1.2 }, { closedDates: ['2026-02-31'], dayBasis: 'business' }, { closedDates: ['2026-10-20'] }])
  expect(await saveGoodsProductionAction('made-a', { ...values, ...bad }, 0, id(3), identity)).toMatchObject({ uncertain: false });
 m.auth.mockResolvedValue({ user: { id: id(9) } }); expect(await change()).toMatchObject({ uncertain: false }); expect(m.rpc).not.toHaveBeenCalled();
});
it('정책 재시도 영수증이 오래되어도 현재 설정을 다시 읽는다', async () => {
 m.rpc.mockResolvedValueOnce({ data: policy }).mockResolvedValueOnce({ data: { ...policy, revision: 2, enabled: false } });
 expect(await saveGoodsProductionAction('made-a', values, 0, id(3), identity)).toEqual({ policy: { ...policy, revision: 2, enabled: false } });
});
it('제작 영수증의 주문 연결이 다르면 결과 확인 필요로 남긴다', async () => {
 m.rpc.mockResolvedValue({ data: { orderId: id(8), jobId: id(5) } });
 expect(await change()).toMatchObject({ uncertain: true }); expect(m.revalidate).not.toHaveBeenCalled();
});
it('저장 후 조회 실패와 확정 CAS 충돌을 구분한다', async () => {
 m.rpc.mockResolvedValueOnce({ data: { orderId: id(4), jobId: id(5) } }).mockResolvedValueOnce({ error: { code: 'network' } });
 expect(await change()).toMatchObject({ uncertain: true });
 m.rpc.mockResolvedValue({ error: { code: 'PT409', message: 'production_changed' } }); expect(await change()).toMatchObject({ uncertain: false });
});
it('현재 제작 현황을 확인한 뒤 고객·출고 화면을 갱신한다', async () => {
 const document = { orderId: id(4), cancelReviewRequired: true, canCancel: true, jobs: [] };
 m.rpc.mockResolvedValueOnce({ data: { orderId: id(4), jobId: id(5) } }).mockResolvedValueOnce({ data: document });
 expect(await change()).toEqual({ document });
 expect(m.rpc).toHaveBeenNthCalledWith(1, 'admin_change_order_production', expect.objectContaining({ p_actor: identity.actorId, p_session: identity.sessionId, p_revision: 1, p_operation: id(3) }));
 expect(m.revalidate).toHaveBeenCalledWith(`/orders/${id(4)}`);
});
