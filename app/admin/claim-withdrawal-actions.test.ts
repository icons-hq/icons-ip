import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
import { loadAdminClaimWithdrawalAction, readAdminClaimWithdrawalAction, submitAdminClaimWithdrawalAction } from './claim-withdrawal-actions';
import { withdrawalContextFixture as context, withdrawalReceiptFixture as receipt, withdrawalRequestFixture as request } from '@/lib/orders/claim-withdrawal.fixture';
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue(true); mocks.rpc.mockResolvedValue({ data: receipt, error: null }); });
it('현재 판매관리 권한을 먼저 확인하고 일치하는 철회만 확정한다', async () => {
  expect(await submitAdminClaimWithdrawalAction(request)).toEqual({ receipt });
  expect(mocks.rpc).toHaveBeenCalledWith('admin_withdraw_order_claim', { p_claim_id: request.claimId, p_operation_id: request.id, p_expected_revision: request.revision, p_reason: request.reason, p_confirmed: true });
  expect(mocks.revalidate).toHaveBeenCalledWith(`/orders/${context.orderId}`, 'page');
  mocks.rpc.mockClear(); mocks.access.mockResolvedValue(false); expect(await submitAdminClaimWithdrawalAction(request)).toHaveProperty('error'); expect(mocks.rpc).not.toHaveBeenCalled();
});
it('늦은 응답과 operation 충돌은 불확정, 행 버전 충돌은 재확인으로 보낸다', async () => {
  mocks.rpc.mockResolvedValue({ error: { code: 'PT409' } }); expect(await submitAdminClaimWithdrawalAction(request)).toMatchObject({ uncertain: false, conflict: true });
  mocks.rpc.mockResolvedValue({ error: { code: '23505' } }); expect(await submitAdminClaimWithdrawalAction(request)).toMatchObject({ uncertain: true });
  mocks.rpc.mockRejectedValue(new Error('private error')); expect(await submitAdminClaimWithdrawalAction(request)).toMatchObject({ uncertain: true });
  mocks.rpc.mockResolvedValue({ data: { ...receipt, actorKind: 'customer' } }); expect(await submitAdminClaimWithdrawalAction(request)).toMatchObject({ uncertain: true }); expect(mocks.revalidate).not.toHaveBeenCalled();
});
it('receipt 없음과 잘못된 응답을 구분하고 읽기 실패도 내부 정보를 숨긴다', async () => {
  mocks.rpc.mockResolvedValue({ data: null }); expect(await readAdminClaimWithdrawalAction(request.id)).toEqual({ receipt: null });
  mocks.rpc.mockResolvedValue({ data: { ...receipt, id: context.orderId } }); expect(await readAdminClaimWithdrawalAction(request.id)).toMatchObject({ uncertain: true });
  mocks.rpc.mockResolvedValue({ data: context }); expect(await loadAdminClaimWithdrawalAction(request.claimId)).toEqual({ context });
  mocks.rpc.mockClear(); expect(await loadAdminClaimWithdrawalAction('wrong')).toHaveProperty('error'); expect(mocks.rpc).not.toHaveBeenCalled();
});
