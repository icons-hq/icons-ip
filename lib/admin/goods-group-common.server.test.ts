import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mocks }));
import { loadGoodsEditorOwnership, loadGoodsGroupCommon } from './goods-group-common.server';
import { commonTestOwnership, commonTestRaw } from './goods-group-common.test-fixtures';
beforeEach(() => vi.resetAllMocks());
describe('그룹 편집기 서버 조회', () => {
  it('선택한 상품의 소유권만 읽고 같은 대상인지 검증한다', async () => {
    mocks.rpc.mockResolvedValue({ data: commonTestOwnership, error: null });
    expect(await loadGoodsEditorOwnership('group-child')).toMatchObject({ goodId: 'group-child' });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_get_goods_group_editor_ownership', { p_good_id: 'group-child' });
    await expect(loadGoodsEditorOwnership('another-good')).rejects.toThrow('그룹·합산 설정');
  });
  it('하나의 RPC에서 그룹 버전·공통 값·A/S·사이즈를 함께 읽는다', async () => {
    mocks.rpc.mockResolvedValue({ data: commonTestRaw, error: null });
    expect(await loadGoodsGroupCommon(commonTestRaw.group.id)).toMatchObject({ group: { revision: 1 }, fields: { nameEn: 'Common name' } });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_get_goods_group_common', { p_group_id: commonTestRaw.group.id });
  });
  it.each([{ data: null, error: { code: '42501' } }, { data: {}, error: null }, { data: commonTestRaw, error: { code: '50000' } }])('오류·비정상 응답을 비그룹 상품으로 폴백하지 않는다: %j', async result => {
    mocks.rpc.mockResolvedValue(result); await expect(loadGoodsEditorOwnership('group-child')).rejects.toThrow(); await expect(loadGoodsGroupCommon(commonTestRaw.group.id)).rejects.toThrow();
  });
  it('없어진 공통 그룹만 null로 반환한다', async () => { mocks.rpc.mockResolvedValue({ data: null, error: null }); expect(await loadGoodsGroupCommon(commonTestRaw.group.id)).toBeNull(); });
});
