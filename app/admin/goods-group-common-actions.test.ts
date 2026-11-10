import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commonTestForm, commonTestMetadata as metadata, commonTestReceipt as receipt } from '@/lib/admin/goods-group-common.test-fixtures';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), refresh: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/admin/revalidate-goods.server', () => ({ revalidateGoodsSurfaces: mocks.refresh }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { saveGoodsGroupCommonAction } from './goods-group-common-actions';
beforeEach(() => { vi.resetAllMocks(); mocks.access.mockResolvedValue({ user: { id: metadata.actorId } }); mocks.rpc.mockResolvedValue({ data: receipt, error: null }); });
describe('공통정보 원자적 저장 액션', () => {
  it('그룹·CAS 버전·계정·세션·동일 요청 ID를 DB에 결속한다', async () => {
    expect(await saveGoodsGroupCommonAction(metadata, commonTestForm())).toEqual({ value: receipt });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_goods_group_common', expect.objectContaining({ p_group_id: metadata.groupId, p_expected_revision: 1, p_expected_actor_id: metadata.actorId, p_expected_session_id: metadata.sessionId, p_operation_id: metadata.operationId }));
  });
  it.each([null, { user: { id: 'another-actor' } }])('계정·권한 불일치에는 mutation을 호출하지 않는다: %j', async access => {
    mocks.access.mockResolvedValue(access); expect(await saveGoodsGroupCommonAction(metadata, commonTestForm())).toMatchObject({ authChanged: true }); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([{ command: 'update' }, { expectedRevision: 0 }, { values: { price: 1 } }])('공통 명령 이외·추가 메타데이터를 거절한다: %j', async patch => { expect(await saveGoodsGroupCommonAction({ ...metadata, ...patch }, commonTestForm())).toHaveProperty('error'); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it('로컬 검증 실패는 mutation 전에 반환한다', async () => { const form = commonTestForm(); form.set('productAttributes','invalid'); expect(await saveGoodsGroupCommonAction(metadata, form)).toHaveProperty('error'); expect(mocks.rpc).not.toHaveBeenCalled(); });
  it('타임아웃·응답 대상 불일치를 완료로 오인하지 않는다', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('lost')); expect(await saveGoodsGroupCommonAction(metadata, commonTestForm())).toMatchObject({ uncertain: true });
    mocks.rpc.mockResolvedValueOnce({ data: { ...receipt, group: { ...receipt.group, revision: 99 } }, error: null }); expect(await saveGoodsGroupCommonAction(metadata, commonTestForm())).toMatchObject({ uncertain: true });
  });
  it('확정된 receipt는 캐시 갱신 실패에도 유지한다', async () => { mocks.refresh.mockImplementation(() => { throw new Error('cache'); }); expect(await saveGoodsGroupCommonAction(metadata, commonTestForm())).toEqual({ value: receipt }); });
});
