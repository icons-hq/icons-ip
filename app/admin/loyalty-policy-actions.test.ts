import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), load: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/admin/loyalty-policy.server', () => ({ loadAdminLoyaltyPolicy: mocks.load }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { readLoyaltyPolicyAction, saveLoyaltyPolicyAction } from './loyalty-policy-actions';
const tiers = [
  { grade: 'silver', enabled: true, amount: 100000, itemCount: 2 },
  { grade: 'gold', enabled: true, amount: 300000, itemCount: 5 },
  { grade: 'platinum', enabled: true, amount: 1000000, itemCount: 10 },
];
const operation = '72000000-0000-4000-8000-000000000001';
const receipt = { revision: 2, updatedAt: '2026-10-13T03:10:00Z' };
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ role: 'admin' }); mocks.rpc.mockResolvedValue({ data: receipt, error: null }); });
it('조회와 저장 모두 admin 전용이며 잘못된 조건은 DB 전에 거절한다', async () => {
  mocks.access.mockResolvedValueOnce(null); expect(await readLoyaltyPolicyAction()).toMatchObject({ error: expect.stringContaining('admin') });
  mocks.access.mockResolvedValueOnce(null); expect(await saveLoyaltyPolicyAction(tiers, 1, operation)).toMatchObject({ error: expect.stringContaining('admin') });
  expect(await saveLoyaltyPolicyAction([], 1, operation)).toMatchObject({ error: expect.any(String) });
  expect(await saveLoyaltyPolicyAction(tiers, 1, 'invalid')).toMatchObject({ error: expect.any(String) });
  expect(await saveLoyaltyPolicyAction(tiers, -1, operation)).toMatchObject({ error: expect.any(String) });
  expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.access).toHaveBeenCalledWith('/admin/marketing/customer-grades', { adminOnly: true });
});
it('조건·편집 버전·같은 작업 UUID를 전달하고 확정된 결과만 성공으로 돌려준다', async () => {
  expect(await saveLoyaltyPolicyAction(tiers, 1, operation)).toEqual({ receipt });
  expect(mocks.rpc).toHaveBeenCalledWith('admin_save_loyalty_policy', { p_tiers: tiers, p_expected_revision: 1, p_operation_id: operation });
  expect(mocks.revalidate).toHaveBeenCalledWith('/my');
});
it('충돌/확정 거절과 전송 불명을 구분하고 DB 원문을 노출하지 않는다', async () => {
  mocks.rpc.mockResolvedValueOnce({ error: { code: 'PT409', message: 'loyalty_policy_changed private-token' } });
  const conflict = await saveLoyaltyPolicyAction(tiers, 1, operation);
  expect(conflict).toMatchObject({ conflict: true }); expect(JSON.stringify(conflict)).not.toContain('private-token');
  mocks.rpc.mockResolvedValueOnce({ error: { code: '22023', message: 'invalid_loyalty_policy' } });
  expect(await saveLoyaltyPolicyAction(tiers, 1, operation)).not.toHaveProperty('uncertain', true);
  mocks.rpc.mockResolvedValueOnce({ data: {}, error: null });
  expect(await saveLoyaltyPolicyAction(tiers, 1, operation)).toMatchObject({ uncertain: true });
  mocks.rpc.mockRejectedValueOnce(new Error('transport secret'));
  expect(await saveLoyaltyPolicyAction(tiers, 1, operation)).toMatchObject({ uncertain: true });
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it('최신 정책 재조회 실패는 원래 초안을 덮어쓸 값을 반환하지 않는다', async () => {
  mocks.load.mockRejectedValueOnce(new Error('failed'));
  expect(await readLoyaltyPolicyAction()).toMatchObject({ error: expect.stringContaining('입력은 유지') });
});
