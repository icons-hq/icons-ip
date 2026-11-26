import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
import { loadAdminClaimWithdrawalAction } from './claim-withdrawal-actions';
import { withdrawalContextFixture as context, withdrawalRequestFixture as request } from '@/lib/orders/claim-withdrawal.fixture';
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue(true); mocks.rpc.mockResolvedValue({ data: context, error: null }); });
it('판매 관리 권한을 먼저 확인하고 철회 이력을 읽는다', async () => {
  mocks.rpc.mockResolvedValue({ data: context }); expect(await loadAdminClaimWithdrawalAction(request.claimId)).toEqual({ context });
  expect(mocks.rpc).toHaveBeenCalledWith('admin_order_claim_withdrawal_context', { p_claim_id: request.claimId });
  mocks.rpc.mockClear(); expect(await loadAdminClaimWithdrawalAction('wrong')).toHaveProperty('error'); expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.access.mockResolvedValue(false); expect(await loadAdminClaimWithdrawalAction(request.claimId)).toHaveProperty('error'); expect(mocks.rpc).not.toHaveBeenCalled();
});
/* 운영자 대리 철회는 화면도 액션도 없다(2026-10-27 "철회는 구매자 몫"). 이 파일이 다시 쓰기 액션을 내보내면 여기서 걸린다. */
it('운영자 대리 철회·결과 확인 액션을 내보내지 않는다', async () => {
  expect(Object.keys(await import('./claim-withdrawal-actions')).sort()).toEqual(['loadAdminClaimWithdrawalAction']);
});
