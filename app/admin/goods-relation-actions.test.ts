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
    expect(await saveGoodsRelationAction(input)).toMatchObject({ error: expect.stringContaining('다른 운영자') });
    expect(mocks.read).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: { id: input.id, revision: 3 }, error: null }); mocks.read.mockRejectedValue(new Error('offline'));
    expect(await saveGoodsRelationAction(input)).toMatchObject({ savedId: input.id, error: expect.stringContaining('저장 후') });
  });
  it('사용자가 보낸 작업 UUID를 재사용하고 네트워크 미확정에만 같은 요청 재시도를 허용한다', async () => {
    const operationId = '74000000-0000-4000-8000-000000000301';
    mocks.rpc.mockRejectedValue(new Error('offline'));
    expect(await saveGoodsRelationAction({ ...input, operationId })).toMatchObject({ retrySameOperation: true });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_goods_relation_composition', expect.objectContaining({ p_operation_id: operationId }));
    mocks.rpc.mockResolvedValue({ error: { code: 'PT409', message: 'goods_relation_changed' } });
    expect(await saveGoodsRelationAction({ ...input, operationId })).not.toHaveProperty('retrySameOperation');
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
