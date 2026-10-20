import { beforeEach, expect, it, vi } from 'vitest';
import { readCouponCombinationPolicyAction, saveCouponCombinationPolicyAction } from './coupon-combination-actions';
const m = vi.hoisted(() => ({ rpc: vi.fn(), auth: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: m.rpc }) }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: m.auth }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
const id = (n: number) => `c7160853-0000-4000-8000-${String(n).padStart(12, '0')}`;
const identity = { actorId: id(1), sessionId: id(2) };
const policy = { revision: 2, stackingEnabled: true, maxGoodsCoupons: 3, shippingEnabled: true, evidence: 'TEST 정책', updatedAt: '2026-10-16T00:00:00Z' };
const values = { stackingEnabled: true, maxGoodsCoupons: 3, shippingEnabled: true, evidence: 'TEST 정책', confirmed: true };
const save = (patch = {}) => saveCouponCombinationPolicyAction({ ...values, ...patch }, 1, id(3), identity);
beforeEach(() => { m.rpc.mockReset(); m.auth.mockReset().mockResolvedValue({ user: { id: id(1) } }); m.revalidate.mockReset(); });
it('계정 불일치·잘못된 정책·미확인을 쓰기 전에 차단한다', async () => {
 for (const bad of [{ maxGoodsCoupons: 0 }, { maxGoodsCoupons: 6 }, { stackingEnabled: 'true' }, { confirmed: false }, { evidence: 'a' }]) expect(await save(bad)).toMatchObject({ uncertain: false });
 m.auth.mockResolvedValue({ user: { id: id(9) } }); expect(await save()).toMatchObject({ uncertain: false }); expect(m.rpc).not.toHaveBeenCalled();
});
it('같은 요청의 영수증 뒤 현재 정책을 다시 읽고 화면을 갱신한다', async () => {
 const current = { ...policy, revision: 3, stackingEnabled: false };
 m.rpc.mockResolvedValueOnce({ data: policy }).mockResolvedValueOnce({ data: current });
 expect(await save()).toEqual({ policy: current }); expect(m.rpc).toHaveBeenNthCalledWith(1, 'admin_save_coupon_combination_policy', expect.objectContaining({ p_revision: 1, p_operation: id(3), p_actor: id(1), p_session: id(2) }));
 expect(m.revalidate).toHaveBeenCalledWith('/checkout');
});
it('저장 후 조회 실패와 확정된 충돌을 구분한다', async () => {
 m.rpc.mockResolvedValueOnce({ data: policy }).mockResolvedValueOnce({ error: { code: 'network' } }); expect(await save()).toMatchObject({ uncertain: true });
 m.rpc.mockResolvedValue({ error: { code: 'PT409' } }); expect(await save()).toMatchObject({ uncertain: false });
});
it('잘못된 정책 응답을 사용 가능 설정으로 바꾸지 않는다', async () => {
 m.rpc.mockResolvedValue({ data: { ...policy, shippingEnabled: 'true' } }); expect(await readCouponCombinationPolicyAction()).toHaveProperty('error');
});
