const { legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: { isConfigured: true, isStaff: true, operatorAccess: legacyOperatorAccessFixture(), user: { id: '33333333-3333-4333-8333-333333333333' } }, rpc: vi.fn(), sign: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: () => mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: () => ({ rpc: mocks.rpc, storage: { from: () => ({ createSignedUrl: mocks.sign }) } }) }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
import { readCsReplySourceAction, readCsReplyOperationAction } from './cs-draft-actions';
const id = '11111111-1111-4111-8111-111111111111';
const question = { id, surface: 'product_question', body: '서버의 원문', status: 'visible', reply: '현재 답변', replyAt: '2026-10-13T00:00:00Z', revision: '14' };
const operation = { id, surface: 'review', accountId: '33333333-3333-4333-8333-333333333333', operationId: '44444444-4444-4444-8444-444444444444', body: '작성한 답변', expectedRevision: '14' };
beforeEach(() => { vi.clearAllMocks(); mocks.auth.isStaff = true; mocks.auth.user.id = operation.accountId; });
it('권한 거절과 잘못된 대상을 데이터 읽기 전에 차단한다', async () => {
  mocks.auth.isStaff = false; expect((await readCsReplySourceAction({ id, surface: 'review' })).ok).toBe(false);
  mocks.auth.isStaff = true; expect((await readCsReplySourceAction({ id: 'bad', surface: 'review' })).ok).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('상품문의 원문·답변과 단조 revision을 같은 context에서 읽는다', async () => {
  mocks.rpc.mockResolvedValue({ data: question, error: null });
  expect(await readCsReplySourceAction({ id, surface: 'product_question' })).toEqual({ ok: true, accountId: operation.accountId, source: {
    ...question, sourceVersion: 'reply:14',
  } });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_cs_reply_context', { p_surface: 'product_question', p_target_id: id });
});
it('리뷰 평점·사진도 같은 revision의 원문에서 읽고 사진만 서명한다', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: { ...question, surface: 'review', rating: 3, imagePaths: ['customer/photo.jpg'] }, error: null });
  mocks.sign.mockResolvedValueOnce({ data: { signedUrl: 'https://signed.example/photo' }, error: null });
  expect(await readCsReplySourceAction({ id, surface: 'review' })).toMatchObject({ ok: true, source: { id, revision: '14', rating: 3, imageCount: 1, imageUrls: ['https://signed.example/photo'] } });
  expect(mocks.sign).toHaveBeenCalledWith('customer/photo.jpg',3600);
  mocks.rpc.mockResolvedValueOnce({ data: { ...question, id: '22222222-2222-4222-8222-222222222222' }, error: null });
  expect((await readCsReplySourceAction({ id, surface: 'product_question' })).ok).toBe(false);
  mocks.rpc.mockResolvedValueOnce({ data: { ...question, revision: 14 }, error: null });
  expect((await readCsReplySourceAction({ id, surface: 'product_question' })).ok).toBe(false);
});
it('조회 시점 영수증 없음은 그대로 반환하고 저장 실패로 확정하지 않는다', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
  expect(await readCsReplyOperationAction(operation)).toEqual({ ok: true, accountId: operation.accountId, receipt: null });
  expect(mocks.rpc).toHaveBeenCalledWith('admin_cs_reply_operation', expect.objectContaining({ p_operation_id: operation.operationId, p_body: operation.body, p_expected_revision: '14' }));
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
it('완료 영수증 복구는 최초 응답 유실로 빠졌을 수 있는 공개 캐시 갱신을 마친다', async () => {
  const receipt = { ...operation, revision: '15', changed: true, savedAt: '2026-10-14T00:00:00Z' };
  mocks.rpc.mockResolvedValueOnce({ data: receipt, error: null });
  expect(await readCsReplyOperationAction(operation)).toEqual({ ok: true, accountId: operation.accountId, receipt });
  expect(mocks.revalidate).toHaveBeenCalledWith('/admin/cs/reviews'); expect(mocks.revalidate).toHaveBeenCalledWith('/shop/[goodId]', 'page');
});
it('다른 계정이나 payload와 일치하지 않는 영수증은 거절한다', async () => {
  expect((await readCsReplyOperationAction({ ...operation, accountId: id })).ok).toBe(false);
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockResolvedValueOnce({ data: { ...operation, body: '다른 문구', revision: '15', changed: true, savedAt: '2026-10-14T00:00:00Z' }, error: null });
  expect((await readCsReplyOperationAction(operation)).ok).toBe(false);
});
