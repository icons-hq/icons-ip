import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
import { loadClaimRefundAccountAction, readClaimRefundAccountAction, saveClaimRefundAccountAction } from './claim-refund-account-actions';
import { refundAccountIdentity as identity, refundAccountRequest as request, refundAccountContext as context, refundAccountReceipt as receipt } from '@/test/fixtures/claim-refund-account';
import { claimRefundAccountRequestMetadata } from '@/lib/orders/claim-refund-account';
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ user: { id: identity.actorId } }); mocks.rpc.mockResolvedValue({ data: receipt, error: null }); });
it('현재 인증 계정과 다른 요청 또는 불완전 계좌는 DB에 보내지 않는다', async () => {
  mocks.auth.mockResolvedValueOnce({ user: { id: request.operationId } });
  expect(await saveClaimRefundAccountAction(request)).toMatchObject({ authChanged: true });
  expect(await saveClaimRefundAccountAction({ ...request, account: { bankName: '은행' } })).toHaveProperty('error');
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('계좌는 user RPC에만 보내고 성공 응답과 클레임/요청/version이 일치해야 화면을 갱신한다', async () => {
  expect(await saveClaimRefundAccountAction(request)).toEqual({ receipt });
  expect(mocks.rpc).toHaveBeenCalledWith('set_my_order_claim_refund_account', expect.objectContaining({ p_claim_id: identity.claimId,
    p_expected_actor_id: identity.actorId, p_expected_session_id: identity.sessionId, p_expected_revision: request.revision, p_account_number: request.account.accountNumber }));
  expect(mocks.revalidate).toHaveBeenCalledWith(`/orders/${identity.orderId}`);
  mocks.revalidate.mockClear(); mocks.rpc.mockResolvedValueOnce({ data: { ...receipt, orderId: request.operationId }, error: null });
  expect(await saveClaimRefundAccountAction(request)).toMatchObject({ uncertain: true }); expect(mocks.revalidate).not.toHaveBeenCalled();
});
it('재조회·봉인은 원문 없이 원 요청번호와 버전으로 실행하며 다른 receipt를 거절한다', async () => {
  const metadata = claimRefundAccountRequestMetadata(request);
  mocks.rpc.mockResolvedValueOnce({ data: null, error: null }); expect(await readClaimRefundAccountAction(metadata)).toEqual({ receipt: null });
  expect(mocks.rpc).toHaveBeenLastCalledWith('read_my_order_claim_refund_account_operation', expect.objectContaining({ p_operation_id: metadata.operationId, p_expected_revision: 1, p_seal: false }));
  expect(JSON.stringify(mocks.rpc.mock.calls)).not.toContain(request.account.accountNumber);
  mocks.rpc.mockResolvedValueOnce({ data: { ...receipt, state: 'sealed', resultRevision: 1 }, error: null });
  expect(await readClaimRefundAccountAction(metadata, true)).toMatchObject({ receipt: { state: 'sealed' } });
  mocks.rpc.mockResolvedValueOnce({ data: { ...receipt, actorId: request.operationId }, error: null });
  expect(await readClaimRefundAccountAction(metadata)).toMatchObject({ uncertain: true });
});
it('DB 원문 오류를 내보내지 않으며 unknown/CAS/auth를 구분한다', async () => {
  mocks.rpc.mockResolvedValueOnce({ error: { code: 'XX000', message: `private ${request.account.accountNumber}` } });
  const unknown = await saveClaimRefundAccountAction(request); expect(unknown).toMatchObject({ uncertain: true }); expect(JSON.stringify(unknown)).not.toContain(request.account.accountNumber);
  mocks.rpc.mockResolvedValueOnce({ error: { code: 'PT409', message: 'claim_changed' } }); expect(await saveClaimRefundAccountAction(request)).toMatchObject({ conflict: true });
  mocks.rpc.mockResolvedValueOnce({ error: { code: '42501', message: 'refund_account_auth_changed' } }); expect(await saveClaimRefundAccountAction(request)).toMatchObject({ authChanged: true });
});
it('조회 응답은 소유 주문과 클레임을 검증하고 계좌 원문을 버린다', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: { ...context, accountNumber: request.account.accountNumber }, error: null });
  const result = await loadClaimRefundAccountAction(identity); expect(result).toHaveProperty('context'); expect(JSON.stringify(result)).not.toContain(request.account.accountNumber);
  mocks.rpc.mockResolvedValueOnce({ data: { ...context, claimId: request.operationId }, error: null }); expect(await loadClaimRefundAccountAction(identity)).toHaveProperty('error');
});
