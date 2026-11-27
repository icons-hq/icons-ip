import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
import { changeClaimHoldAction, loadClaimHoldContextAction, readClaimHoldAction } from './claim-hold-actions';
import { holdContext as context, holdReceipt as receipt, holdRequest as request } from '@/lib/orders/claim-hold.fixture';
import { CLAIM_CHANGE_CONFLICT_MESSAGE, CLAIM_CHANGE_PERMISSION_MESSAGE, CLAIM_CHANGE_UNKNOWN_MESSAGE } from '@/lib/admin/claim-change-copy';
import { CLAIM_HOLD_NOTE_ERROR } from '@/lib/orders/claim-hold';

beforeEach(() => {
  vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: context.actorId } });
  mocks.rpc.mockResolvedValue({ data: receipt, error: null });
});
it('계정·유형·버전·최초 본문을 전용 RPC로 보내며 금융 작업을 호출하지 않는다', async () => {
  expect(await changeClaimHoldAction(request)).toEqual({ receipt });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_change_order_claim_hold', {
    p_claim_id: request.claimId, p_operation_id: request.id, p_expected_revision: 2,
    p_expected_claim_type: 'return', p_decision: 'hold', p_note: request.note, p_expected_actor_id: context.actorId,
  });
  expect(mocks.revalidate).toHaveBeenCalledWith('/admin/sales/claims', 'layout');
  mocks.rpc.mockClear(); mocks.access.mockResolvedValue({ user: { id: context.orderId } });
  expect(await changeClaimHoldAction(request)).toHaveProperty('error'); expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.access.mockResolvedValue(null); expect(await changeClaimHoldAction(request)).toHaveProperty('error');
});
it('충돌·본문 충돌·결과 소실과 잘못된 receipt를 구분한다', async () => {
  mocks.rpc.mockResolvedValue({ error: { code: 'PT409' } });
  expect(await changeClaimHoldAction(request)).toMatchObject({ conflict: true, uncertain: false });
  mocks.rpc.mockResolvedValue({ error: { code: '23505' } });
  expect(await changeClaimHoldAction(request)).toMatchObject({ uncertain: true });
  mocks.rpc.mockResolvedValue({ data: { ...receipt, claimType: 'exchange' } });
  expect(await changeClaimHoldAction(request)).toMatchObject({ uncertain: true });
  mocks.rpc.mockRejectedValue(new Error('private detail'));
  expect(await changeClaimHoldAction(request)).toMatchObject({ uncertain: true });
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it('현재 계정의 문맥과 같은 operation의 읽기만 채택한다', async () => {
  mocks.rpc.mockResolvedValue({ data: context }); expect(await loadClaimHoldContextAction(context.claimId)).toEqual({ context });
  mocks.rpc.mockResolvedValue({ data: { ...context, actorId: context.orderId } }); expect(await loadClaimHoldContextAction(context.claimId)).toHaveProperty('error');
  mocks.rpc.mockResolvedValue({ data: null }); expect(await readClaimHoldAction(request.id)).toEqual({ receipt: null });
  mocks.rpc.mockResolvedValue({ data: { ...receipt, id: context.orderId } }); expect(await readClaimHoldAction(request.id)).toMatchObject({ uncertain: true });
});
it('화면 버튼 이름과 같은 말로 알린다: 다른 사람이 먼저 바꿨음, 저장됐는지 확인, 보류 사유 글자 수', async () => {
  mocks.rpc.mockResolvedValue({ error: { code: 'PT409' } });
  expect(await changeClaimHoldAction(request)).toEqual({ error: CLAIM_CHANGE_CONFLICT_MESSAGE, conflict: true, uncertain: false });
  mocks.rpc.mockResolvedValue({ error: { code: '57014', message: 'statement timeout' } });
  const unknown = await changeClaimHoldAction(request);
  expect(unknown).toMatchObject({ error: CLAIM_CHANGE_UNKNOWN_MESSAGE, uncertain: true });
  expect('error' in unknown && unknown.error).toContain('[저장됐는지 확인]');
  mocks.rpc.mockRejectedValue(new Error('private detail'));
  expect(await changeClaimHoldAction(request)).toEqual({ error: CLAIM_CHANGE_UNKNOWN_MESSAGE, uncertain: true });
  mocks.rpc.mockResolvedValue({ data: receipt }); mocks.rpc.mockClear();
  /* 확인 체크 칸이 없어졌으니 사유만 본다. 사유가 10자보다 짧으면 DB를 부르지 않고 글자 수를 말한다. */
  expect(await changeClaimHoldAction({ ...request, note: '짧음' })).toEqual({ error: CLAIM_HOLD_NOTE_ERROR });
  expect(await changeClaimHoldAction({ ...request, confirmed: undefined })).toEqual({ error: CLAIM_HOLD_NOTE_ERROR });
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.access.mockResolvedValue(null);
  expect(await changeClaimHoldAction(request)).toEqual({ error: CLAIM_CHANGE_PERMISSION_MESSAGE });
});
