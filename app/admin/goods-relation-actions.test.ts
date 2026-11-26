import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveGoodsRelationAction, findGoodsForRelationAction } from './goods-relation-actions';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), read: vi.fn(), search: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/admin/goods-relations.server', () => ({ loadGoodsRelation: mocks.read, searchGoodsForRelation: mocks.search }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
const input = { id: '74000000-0000-4000-8000-000000000001', revision: 2, values: { kind: 'together', title: '함께 구매', representativeGoodId: 'good-a', enabled: true, startsAt: null, endsAt: null, goodIds: ['good-b', 'good-a'] } };
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: 'staff' } }); });
describe('연관상품 서버 액션', () => {
  it('조회·쓰기 전에 권한을 검사한다', async () => {
    mocks.access.mockResolvedValue(null);
    expect(await saveGoodsRelationAction(input)).toEqual({ error: '관리자 권한이 필요합니다.' });
    expect(await findGoodsForRelationAction('', 1)).toEqual({ error: '관리자 권한이 필요합니다.' });
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.search).not.toHaveBeenCalled();
  });
  it('순서·원본 버전을 저장하고 다시 읽은 같은 버전만 성공으로 반환한다', async () => {
    const saved = { id: input.id, revision: 3 }; mocks.rpc.mockResolvedValue({ data: saved, error: null }); mocks.read.mockResolvedValue(saved);
    expect(await saveGoodsRelationAction(input)).toEqual({ saved });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_goods_relation_composition', { p_id: input.id, p_expected_revision: 2, p_operation_id: expect.any(String), p_values: { ...input.values, visual: null } });
    expect(mocks.revalidate).toHaveBeenCalledWith('/shop/[goodId]', 'page');
    mocks.read.mockResolvedValue({ ...saved, revision: 4 });
    expect(await saveGoodsRelationAction(input)).toMatchObject({ savedId: input.id, error: expect.stringContaining('최신 내용') });
  });
  it('충돌과 미확인 저장 결과를 재조회 안내로 구별한다', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'goods_relation_changed' } });
    expect(await saveGoodsRelationAction(input)).toMatchObject({ conflict: true, error: expect.stringContaining('다른 사람이 먼저 바꿨습니다.') });
    expect(mocks.read).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: { id: input.id, revision: 3 }, error: null }); mocks.read.mockRejectedValue(new Error('offline'));
    const unread = await saveGoodsRelationAction(input);
    expect(unread).toMatchObject({ savedId: input.id, error: expect.stringContaining('[최신 내용 다시 열기]') });
    expect(unread).not.toHaveProperty('conflict');
  });
  it('다른 사람이 먼저 바꾼 저장은 문구가 아니라 conflict 값으로 알린다', async () => {
    for (const message of ['goods_relation_changed', 'goods_relation_operation_conflict']) {
      mocks.rpc.mockResolvedValue({ error: { code: 'PT409', message } });
      const result = await saveGoodsRelationAction({ ...input, operationId: '74000000-0000-4000-8000-000000000303' });
      expect(result).toMatchObject({ conflict: true }); expect(result).not.toHaveProperty('retrySameOperation');
    }
    mocks.rpc.mockResolvedValue({ error: { code: '22023', message: 'invalid_goods_relation_goods' } });
    const invalid = await saveGoodsRelationAction(input);
    expect(invalid).toMatchObject({ error: expect.stringContaining('삭제된 상품을 뺀 뒤') }); expect(invalid).not.toHaveProperty('conflict');
  });
  it('사용자가 보낸 작업 UUID를 재사용하고 네트워크 미확정에만 같은 요청 재시도를 허용한다', async () => {
    const operationId = '74000000-0000-4000-8000-000000000301';
    const unknown = '저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.';
    mocks.rpc.mockRejectedValue(new Error('offline'));
    expect(await saveGoodsRelationAction({ ...input, operationId })).toEqual({ error: unknown, retrySameOperation: true });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_goods_relation_composition', expect.objectContaining({ p_operation_id: operationId }));
    // 오류 코드가 없는 응답(연결 끊김)도 저장됐는지 모르는 상태다. '저장하지 못했습니다'로 단정하지 않는다.
    mocks.rpc.mockResolvedValue({ error: { code: '', message: 'TypeError: fetch failed' } });
    expect(await saveGoodsRelationAction({ ...input, operationId })).toEqual({ error: unknown, retrySameOperation: true });
    mocks.rpc.mockResolvedValue({ error: { code: 'PT409', message: 'goods_relation_changed' } });
    expect(await saveGoodsRelationAction({ ...input, operationId })).not.toHaveProperty('retrySameOperation');
    // 작업 UUID 없이 보낸 저장은 같은 저장을 다시 보낼 수 없어 목록에서 확인하게 한다.
    mocks.rpc.mockRejectedValue(new Error('offline'));
    const anonymous = await saveGoodsRelationAction(input);
    expect(anonymous).toMatchObject({ error: expect.stringContaining('목록에서 저장됐는지') }); expect(anonymous).not.toHaveProperty('retrySameOperation');
  });
  it('다른 구성의 표시값과 작업 UUID를 함께 저장하고 같은 버전을 다시 읽는다', async () => {
    const operationId = '74000000-0000-4000-8000-000000000302';
    const values = { ...input.values, kind: 'other_composition', visual: null, compositionLabels: [{ goodId: 'good-b', label: ' 2개 세트 ' }] };
    const saved = { id: input.id, revision: 3 }; mocks.rpc.mockResolvedValue({ data: saved, error: null }); mocks.read.mockResolvedValue(saved);
    expect(await saveGoodsRelationAction({ ...input, operationId, values })).toEqual({ saved });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_goods_relation_composition', { p_id: input.id, p_expected_revision: 2, p_operation_id: operationId,
      p_values: { ...values, compositionLabels: [{ goodId: 'good-b', label: '2개 세트' }] } });
  });
});
