import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), load: vi.fn(), rewards: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.access }));
vi.mock('@/lib/admin/loyalty-policy.server', () => ({ loadAdminLoyaltyPolicy: mocks.load }));
vi.mock('@/lib/admin/customer-rewards.server', () => ({ loadCustomerRewardPolicy: mocks.rewards }));
vi.mock('@/components/admin/screens/LoyaltyPolicyScreen', () => ({ LoyaltyPolicyScreen: () => null }));
import Page from './page';
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ role: 'admin' }); mocks.load.mockResolvedValue({ policy: {}, coupons: [] }); });
it('관리자 페이지 게이트 통과 후에만 정책을 조회한다', async () => {
  await Page(); expect(mocks.access).toHaveBeenCalledWith('/admin/marketing/customer-grades', { adminOnly: true });
  mocks.load.mockClear(); mocks.access.mockRejectedValueOnce(new Error('not found'));
  await expect(Page()).rejects.toThrow('not found'); expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.rewards).toHaveBeenCalledTimes(1);
});
