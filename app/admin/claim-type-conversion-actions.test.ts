import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
import { convertClaimTypeAction, loadClaimTypeContextAction, readClaimTypeChangeAction } from './claim-type-conversion-actions';
import { conversionContext as context, conversionRequest as request, conversionReceipt as receipt } from '@/lib/orders/claim-type-conversion.fixture';
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue(true); mocks.rpc.mockResolvedValue({ data: receipt, error: null }); });
it('판매관리 권한과 정확한 첫 본문으로만 전환하고 새 화면 경로를 갱신한다', async () => {
  expect(await convertClaimTypeAction(request)).toEqual({ receipt });
  expect(mocks.rpc).toHaveBeenCalledWith('admin_convert_order_claim_type', { p_claim_id: request.claimId, p_operation_id: request.id, p_expected_revision: 2, p_to_type: 'exchange', p_agreement: request.agreement, p_confirmed: true, p_refund_account: null });
  expect(mocks.revalidate).toHaveBeenCalledWith(`/orders/${context.orderId}`, 'page');
  mocks.rpc.mockClear(); mocks.access.mockResolvedValue(false); expect(await convertClaimTypeAction(request)).toHaveProperty('error'); expect(mocks.rpc).not.toHaveBeenCalled();
});
it('버전 충돌은 다시 확인하고 늦은 응답·잘못된 receipt는 미확정으로 보존한다', async () => {
  mocks.rpc.mockResolvedValue({ error: { code: 'PT409' } }); expect(await convertClaimTypeAction(request)).toMatchObject({ uncertain: false, conflict: true });
  mocks.rpc.mockResolvedValue({ error: { code: '23505' } }); expect(await convertClaimTypeAction(request)).toMatchObject({ uncertain: true });
  mocks.rpc.mockResolvedValue({ data: { ...receipt, agreement: '다른 합의' } }); expect(await convertClaimTypeAction(request)).toMatchObject({ uncertain: true });
  mocks.rpc.mockRejectedValue(new Error('sensitive account detail')); expect(await convertClaimTypeAction(request)).toMatchObject({ uncertain: true }); expect(mocks.revalidate).not.toHaveBeenCalled();
});
it('없는 receipt, 잘못된 operation, 현재 문맥을 구분한다', async () => {
  mocks.rpc.mockResolvedValue({ data: null }); expect(await readClaimTypeChangeAction(request.id)).toEqual({ receipt: null });
  mocks.rpc.mockResolvedValue({ data: { ...receipt, id: context.orderId } }); expect(await readClaimTypeChangeAction(request.id)).toMatchObject({ uncertain: true });
  mocks.rpc.mockResolvedValue({ data: context }); expect(await loadClaimTypeContextAction(request.claimId)).toEqual({ context });
});
