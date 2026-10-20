import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
import { changeClaimReasonAction, loadClaimReasonContextAction, readClaimReasonChangeAction } from './claim-reason-change-actions';
import { reasonContext as context, reasonReceipt as receipt, reasonRequest as request } from '@/lib/orders/claim-reason-change.fixture';
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: context.actorId } }); mocks.rpc.mockResolvedValue({ data: receipt, error: null }); });
it('현재 계정과 고정 입력을 정정 RPC로만 전달한다', async () => {
  expect(await changeClaimReasonAction(request)).toEqual({ receipt });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_change_order_claim_reason', {
    p_claim_id: request.claimId, p_operation_id: request.id, p_expected_revision: request.revision, p_expected_actor_id: request.actorId,
    p_reason_type: request.reasonType, p_reason: request.reason, p_agreement: request.agreement, p_confirmed: true, p_fee_reviewed: false,
  });
  expect(mocks.revalidate).toHaveBeenCalledWith(`/orders/${receipt.orderId}`, 'page');
  mocks.rpc.mockClear(); mocks.access.mockResolvedValue({ user: { id: context.orderId } });
  expect(await changeClaimReasonAction(request)).toHaveProperty('error'); expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.access.mockResolvedValue(null); expect(await changeClaimReasonAction(request)).toHaveProperty('error');
});
it('결과 소실과 충돌을 구별하고 재조회는 현재 행위자의 operation만 받는다', async () => {
  mocks.rpc.mockResolvedValue({ error: { code: 'PT409' } }); expect(await changeClaimReasonAction(request)).toMatchObject({ conflict: true, uncertain: false });
  mocks.rpc.mockResolvedValue({ error: { code: '23505' } }); expect(await changeClaimReasonAction(request)).toMatchObject({ uncertain: true });
  mocks.rpc.mockResolvedValue({ data: { ...receipt, toReason: '다른 결과' } }); expect(await changeClaimReasonAction(request)).toMatchObject({ uncertain: true });
  mocks.rpc.mockRejectedValue(new Error('private detail')); expect(await changeClaimReasonAction(request)).toMatchObject({ uncertain: true });
  mocks.rpc.mockResolvedValue({ data: context }); expect(await loadClaimReasonContextAction(context.claimId)).toEqual({ context });
  mocks.rpc.mockResolvedValue({ data: { ...context, actorId: context.orderId } }); expect(await loadClaimReasonContextAction(context.claimId)).toHaveProperty('error');
  mocks.rpc.mockResolvedValue({ data: null }); expect(await readClaimReasonChangeAction(request.id)).toEqual({ receipt: null });
  mocks.rpc.mockResolvedValue({ data: { ...receipt, id: context.orderId } }); expect(await readClaimReasonChangeAction(request.id)).toMatchObject({ uncertain: true });
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it('무변경 결과는 고객 알림이나 화면 재검증을 추가하지 않는다', async () => {
  const noOp = { ...receipt, toReason: context.reason, toReasonType: context.reasonType, changed: false, resultRevision: context.revision };
  mocks.rpc.mockResolvedValue({ data: noOp });
  expect(await changeClaimReasonAction({ ...request, reason: context.reason, reasonType: context.reasonType })).toEqual({ receipt: noOp });
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
