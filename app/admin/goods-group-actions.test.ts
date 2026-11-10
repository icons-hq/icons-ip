import { beforeEach, describe, expect, it, vi } from 'vitest';
import { groupTestGroup as group, groupTestId as id, groupTestIdentity as identity, groupTestPreview as preview, groupTestReceipt as receipt, groupTestRecovery as recovery, groupTestRequest as request, groupTestSource as source } from '@/lib/admin/goods-groups.test-fixtures';
const mocks = vi.hoisted(() => ({ access: vi.fn(), create: vi.fn(), rpc: vi.fn(), revalidate: vi.fn(), goods: vi.fn(), source: vi.fn(), list: vi.fn(), load: vi.fn(), candidates: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.create }));
vi.mock('@/lib/admin/revalidate-goods.server', () => ({ revalidateGoodsSurfaces: mocks.goods }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: (error: unknown) => { if (error instanceof Error && error.message.startsWith('NEXT_REDIRECT:')) throw error; } }));
vi.mock('@/lib/admin/goods-groups.server', () => ({ loadGoodsGroupSource: mocks.source, loadGoodsGroups: mocks.list, loadGoodsGroup: mocks.load, searchGoodsGroupCandidates: mocks.candidates }));
import { archiveGoodsGroupAction, confirmGoodsGroupConversionAction, previewGoodsGroupConversionAction, readGoodsGroupAction, readGoodsGroupOperationAction, readGoodsGroupSourceAction, saveGoodsGroupAction, searchGoodsGroupProductsAction, searchGoodsGroupsAction } from './goods-group-actions';
const values = { name: group.name, optionNames: group.optionNames, members: group.members.map(row => ({ goodId: row.goodId, values: row.values })) };
const change = { version: 1 as const, ...identity, operationId: id(22), command: 'update' as const, groupId: group.id, expectedRevision: 1 };
beforeEach(() => { vi.resetAllMocks(); mocks.access.mockResolvedValue({ user: { id: identity.actorId } }); mocks.create.mockResolvedValue({ rpc: mocks.rpc }); mocks.rpc.mockResolvedValue({ data: receipt, error: null }); mocks.source.mockResolvedValue(source); mocks.load.mockResolvedValue(group); });
describe('상품관리 액션 권한과 입력', () => {
  it.each([null, { user: { id: id(99) } }])('현재 계정·권한 불일치에서 DB 호출 전에 거절한다: %j', auth => {
    return (async () => { mocks.access.mockResolvedValue(auth);
      for (const action of [() => confirmGoodsGroupConversionAction(recovery), () => previewGoodsGroupConversionAction(request, identity), () => readGoodsGroupOperationAction(recovery), () => saveGoodsGroupAction(change, values), () => readGoodsGroupSourceAction(source.goodId, identity), () => searchGoodsGroupsAction('', 1, identity), () => searchGoodsGroupProductsAction('', 1, identity), () => readGoodsGroupAction(group.id, identity)]) expect(await action()).toHaveProperty('authChanged', true);
      expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.source).not.toHaveBeenCalled(); expect(mocks.access).toHaveBeenCalledWith('/admin/catalog/groups', { capability: 'catalog.manage' });
    })();
  });
  it('잘못된 입력·다른 명령은 인가/변경 전에 거절한다', async () => {
    expect(await previewGoodsGroupConversionAction({ ...request, selections: [] }, identity)).toHaveProperty('error');
    expect(await readGoodsGroupOperationAction({ ...recovery, selections: request.selections })).toHaveProperty('uncertain', true);
    expect(await saveGoodsGroupAction({ ...change, command: 'common' }, values)).toHaveProperty('error');
    expect(await archiveGoodsGroupAction(change)).toHaveProperty('error'); expect(mocks.access).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('로그인 리다이렉트를 일반 오류로 삼키지 않는다', async () => {
    mocks.access.mockRejectedValue(new Error('NEXT_REDIRECT:/login')); await expect(confirmGoodsGroupConversionAction(recovery)).rejects.toThrow('NEXT_REDIRECT:/login'); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
describe('변환 비교·확정·복구', () => {
  it('비교에 현재 actor/session과 입력만 전달하고 순서가 다른 계획을 거절한다', async () => {
    mocks.rpc.mockResolvedValue({ data: preview, error: null }); expect(await previewGoodsGroupConversionAction(request, identity)).toEqual({ value: preview });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_preview_goods_group_conversion', { p_request: request, p_expected_actor_id: identity.actorId, p_expected_session_id: identity.sessionId });
    expect(await previewGoodsGroupConversionAction({ ...request, name: '다른 그룹명' }, identity)).toHaveProperty('error'); expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('확정은 이미 준비된 previewId만 보내고 결과에 같은 operationId를 요구한다', async () => {
    expect(await confirmGoodsGroupConversionAction(recovery)).toEqual({ value: receipt }); expect(mocks.rpc).toHaveBeenCalledWith('admin_confirm_goods_group_conversion', {
      p_preview_id: preview.previewId, p_operation_id: recovery.operationId, p_expected_actor_id: identity.actorId, p_expected_session_id: identity.sessionId });
    expect(mocks.goods).toHaveBeenCalledOnce(); expect(mocks.revalidate).toHaveBeenCalledWith('/admin/catalog/groups');
  });
  it.each([null, {}, { ...receipt, operationId: id(99) }, { ...receipt, aggregationId: null }])('완료 여부를 확인할 수 없는 응답은 결과 불명확이다: %j', async data => {
    mocks.rpc.mockResolvedValue({ data, error: null }); expect(await confirmGoodsGroupConversionAction(recovery)).toHaveProperty('uncertain', true); expect(mocks.goods).not.toHaveBeenCalled();
  });
  it('응답 유실 뒤 조회는 변환을 재전송하지 않고 read/seal RPC만 호출한다', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('network')); expect(await confirmGoodsGroupConversionAction(recovery)).toHaveProperty('uncertain', true);
    mocks.rpc.mockResolvedValue({ data: { state: 'unresolved', operationId: recovery.operationId }, error: null }); expect(await readGoodsGroupOperationAction(recovery)).toHaveProperty('value.state', 'unresolved');
    mocks.rpc.mockResolvedValue({ data: { state: 'sealed', operationId: recovery.operationId }, error: null }); expect(await readGoodsGroupOperationAction(recovery, true)).toHaveProperty('value.state', 'sealed');
    expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(['admin_confirm_goods_group_conversion', 'admin_read_goods_group_conversion', 'admin_read_goods_group_conversion']);
    expect(mocks.rpc.mock.calls.at(-1)?.[1]).toMatchObject({ p_seal: true, p_preview_id: preview.previewId }); expect(mocks.rpc.mock.calls.at(-1)?.[1]).not.toHaveProperty('p_request');
  });
  it('저장이 확인된 뒤 캐시 갱신 실패는 완료를 뒤집지 않는다', async () => {
    mocks.goods.mockImplementation(() => { throw new Error('cache failure'); }); expect(await confirmGoodsGroupConversionAction(recovery)).toEqual({ value: receipt });
  });
});
describe('그룹 구성 저장·해제', () => {
  it('구성과 기준버전을 전용 RPC에 보내고 최신 버전 영수증에 결속한다', async () => {
    const saved = { state: 'completed', operationId: change.operationId, group: { ...group, revision: 2 } }; mocks.rpc.mockResolvedValue({ data: saved, error: null });
    expect(await saveGoodsGroupAction(change, values)).toEqual({ value: saved }); expect(mocks.rpc).toHaveBeenCalledWith('admin_save_goods_group', {
      p_group_id: group.id, p_expected_revision: 1, p_values: values, p_operation_id: change.operationId, p_expected_actor_id: identity.actorId, p_expected_session_id: identity.sessionId });
    mocks.rpc.mockResolvedValue({ data: { ...saved, group: { ...group, revision: 3 } }, error: null }); expect(await saveGoodsGroupAction(change, values)).toHaveProperty('uncertain', true);
  });
  it.each(['create', 'update', 'archive', 'common'] as const)('%s 재조회는 구조 입력 없이 고정 metadata만 전달한다', async command => {
    const metadata = { ...change, command, expectedRevision: command === 'create' ? 0 : 1 }; mocks.rpc.mockResolvedValue({ data: { state: 'sealed', operationId: metadata.operationId }, error: null });
    expect(await readGoodsGroupOperationAction(metadata, true)).toHaveProperty('value.state', 'sealed');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_read_goods_group_change', { p_group_id: group.id, p_expected_revision: metadata.expectedRevision, p_command: command,
      p_operation_id: metadata.operationId, p_expected_actor_id: identity.actorId, p_expected_session_id: identity.sessionId, p_seal: true });
  });
  it('연결 해제도 같은 identity/version 계약을 사용한다', async () => {
    const metadata = { ...change, command: 'archive' as const }; const saved = { state: 'completed', operationId: metadata.operationId, group: { ...group, revision: 2, archivedAt: '2026-10-14T00:00:00Z', members: [] } };
    mocks.rpc.mockResolvedValue({ data: saved, error: null }); expect(await archiveGoodsGroupAction(metadata)).toEqual({ value: saved }); expect(mocks.rpc.mock.calls[0][0]).toBe('admin_archive_goods_group');
  });
});
