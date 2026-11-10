import { beforeEach, expect, it, vi } from 'vitest';
import { readReviewTypePolicyAction, saveReviewTypePolicyAction } from './review-type-policy-actions';
const m = vi.hoisted(() => ({ rpc: vi.fn(), auth: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: m.rpc }) }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: m.auth }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
const id = (n: number) => `c7160750-0000-4000-8000-${String(n).padStart(12, '0')}`;
const identity = { actorId: id(1), sessionId: id(2) };
const policy = { revision: 2, enabled: true, basis: 'delivered', startDays: 31, endDays: 90, maxOrderDays: 365, rewardEligible: false, evidence: 'TEST explicit terms', updatedAt: '2026-10-16T00:00:00Z' };
const config = { enabled: policy.enabled, basis: policy.basis, startDays: policy.startDays, endDays: policy.endDays, maxOrderDays: policy.maxOrderDays, rewardEligible: policy.rewardEligible, evidence: policy.evidence };
const values = { ...config, confirmed: true };
const save = () => saveReviewTypePolicyAction(values, 1, id(3), identity);
beforeEach(() => { m.rpc.mockReset(); m.auth.mockReset().mockResolvedValue({ user: { id: id(1) } }); m.revalidate.mockReset(); });
it('저장 재시도 후 과거 영수증 대신 현재 설정을 반환한다', async () => {
 m.rpc.mockResolvedValueOnce({ data: policy }).mockResolvedValueOnce({ data: { ...policy, revision: 3, enabled: false } });
 expect(await save()).toEqual({ policy: { ...policy, revision: 3, enabled: false } });
 expect(m.rpc).toHaveBeenNthCalledWith(1, 'admin_save_review_type_policy', expect.objectContaining({ p_revision: 1, p_operation: id(3), p_actor: id(1), p_session: id(2) }));
});
it('저장 후 조회 실패는 동일 요청 재확인이 필요하다', async () => {
 m.rpc.mockResolvedValueOnce({ data: policy }).mockResolvedValueOnce({ error: { code: 'network' } });
 expect(await save()).toMatchObject({ uncertain: true }); expect(m.revalidate).not.toHaveBeenCalled();
});
it('권한과 입력·기간 오류는 호출 전 차단한다', async () => {
 expect(await saveReviewTypePolicyAction({ ...values, endDays: 20 }, 1, id(3), identity)).toHaveProperty('error');
 m.auth.mockResolvedValue({ user: { id: id(9) } }); expect(await save()).toHaveProperty('error'); expect(m.rpc).not.toHaveBeenCalled();
});
it('CAS 충돌은 확정 거절이고 저장 여부 불명확과 구분한다', async () => {
 m.rpc.mockResolvedValue({ error: { code: 'PT409' } }); expect(await save()).toMatchObject({ uncertain: false });
});
it('손상된 설정은 표시하지 않는다', async () => { m.rpc.mockResolvedValue({ data: { ...policy, startDays: 0 } }); expect(await readReviewTypePolicyAction()).toHaveProperty('error'); });
