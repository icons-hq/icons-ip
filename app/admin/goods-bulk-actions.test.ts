import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/admin/revalidate-goods.server', () => ({ revalidateGoodsSurfaces: mocks.refresh }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => undefined }));
import { previewGoodsBulkAction, commitGoodsBulkAction, readGoodsBulkAction } from './goods-bulk-actions';
const id = 'b9000000-0000-4000-8000-000000000003', identity = { actorId: 'b9000000-0000-4000-8000-000000000001', sessionId: 'b9000000-0000-4000-8000-000000000002' };
const request = { kind: 'goods', ids: ['good-a'], command: 'stop', values: {} };
const receipt = { state: 'completed', operationId: id, goodsCount: 1, groupsCount: 0, error: null };
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: identity.actorId } }); mocks.rpc.mockResolvedValue({ data: receipt, error: null }); });
it('현재 권한과 계정 불일치에서는 DB 호출을 막는다', async () => {
  mocks.access.mockResolvedValue(null); expect(await commitGoodsBulkAction(id, identity)).toHaveProperty('authChanged', true);
  mocks.access.mockResolvedValue({ user: { id: identity.sessionId } }); expect(await readGoodsBulkAction(id, identity)).toHaveProperty('authChanged', true);
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it('무효한 입력·비공개 필드는 미리보기 전 거절한다', async () => {
  expect(await previewGoodsBulkAction(id, { ...request, values: { stock: 0 } }, identity)).toHaveProperty('error');
  expect(await commitGoodsBulkAction(id, { ...identity, role: 'admin' })).toHaveProperty('error'); expect(mocks.rpc).not.toHaveBeenCalled();
});
it('확정은 동결된 요청번호와 현재 identity만 전달한다', async () => {
  expect(await commitGoodsBulkAction(id, identity)).toEqual({ value: receipt });
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_commit_goods_bulk', { p_id: id, p_actor: identity.actorId, p_session: identity.sessionId });
  expect(mocks.refresh).toHaveBeenCalledOnce();
});
it('응답 유실 뒤 조회와 종료는 재실행하지 않는다', async () => {
  mocks.rpc.mockRejectedValueOnce(new Error('network')); expect(await commitGoodsBulkAction(id, identity)).toHaveProperty('uncertain', true);
  expect(await readGoodsBulkAction(id, identity)).toEqual({ value: receipt }); await readGoodsBulkAction(id, identity, true);
  expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(['admin_commit_goods_bulk', 'admin_read_goods_bulk', 'admin_read_goods_bulk']);
  expect(mocks.rpc.mock.calls.at(-1)?.[1]).toMatchObject({ p_seal: true });
});
it('다른 요청번호의 성공 응답을 완료로 표시하지 않는다', async () => {
  mocks.rpc.mockResolvedValue({ data: { ...receipt, operationId: identity.actorId }, error: null }); expect(await commitGoodsBulkAction(id, identity)).toHaveProperty('uncertain', true); expect(mocks.refresh).not.toHaveBeenCalled();
});
it('권한 변경 오류와 확정 거절을 구분한다', async () => {
  mocks.rpc.mockResolvedValueOnce({ error: { code: '42501', message: 'goods_group_auth_changed' } }); expect(await commitGoodsBulkAction(id, identity)).toHaveProperty('authChanged', true);
  mocks.rpc.mockResolvedValueOnce({ data: { ...receipt, state: 'rejected', goodsCount: 0, error: 'goods_bulk_changed' } });
  expect(await commitGoodsBulkAction(id, identity)).toHaveProperty('value.state', 'rejected'); expect(mocks.refresh).not.toHaveBeenCalled();
});
