import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultCategoryDisplayValues } from '@/lib/category-display';
import { saveCategoryDisplayAction, previewCategoryDisplayAction } from './category-display-actions';

const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), revalidate: vi.fn(), hydrate: vi.fn(), parsePage: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: () => {} }));
vi.mock('@/lib/category-display.server', () => ({ categoryDisplaySqlQuery: (query: unknown) => query, parseCategoryDisplayPage: mocks.parsePage, hydrateCategoryDisplayPage: mocks.hydrate }));
const id = '93930000-0000-4000-8000-000000000011', actor = '93930000-0000-4000-8000-000000000001';
const values = defaultCategoryDisplayValues(id), category = { id, name: '전시', parentId: null, depth: 1, sortOrder: 0, publicEnabled: true };
const snapshot = { category, values, revision: 1, checkedAt: '2026-10-14T00:00:00Z' };
const query = { displayCategory: id, view: 'all' as const, ips: [], types: [], priceMin: null, priceMax: null, sort: 'recommended' as const };
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: actor } }); mocks.rpc.mockResolvedValue({ data: snapshot, error: null }); });
describe('카테고리 전시 액션', () => {
  it('권한·폼 계정 변경은 RPC 전 거절한다', async () => {
    mocks.access.mockResolvedValueOnce(null);
    expect(await saveCategoryDisplayAction(id, values, 0, id, actor)).toHaveProperty('error');
    expect(await saveCategoryDisplayAction(id, values, 0, id, id)).toHaveProperty('error');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('요청 ID와 CAS를 그대로 보내고 확인한 결과만 완료 처리한다', async () => {
    expect(await saveCategoryDisplayAction(id, values, 0, id, actor)).toEqual({ snapshot });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_category_display', { p_category_id: id, p_values: values, p_expected_revision: 0, p_operation_id: id });
    expect(mocks.revalidate).toHaveBeenCalledWith('/shop');
  });
  it('Postgres jsonb가 배너 키를 다른 순서로 반환해도 정상 저장을 확인한다', async () => {
    const reordered = { ...snapshot, values: { ...values, banner: Object.fromEntries(Object.entries(values.banner).reverse()) } };
    mocks.rpc.mockResolvedValue({ data: reordered, error: null });
    expect(await saveCategoryDisplayAction(id, values, 0, id, actor)).toEqual({ snapshot });
  });
  it('CAS 충돌은 재읽기, 통신·불일치 결과는 같은 요청 재확인으로 구분한다', async () => {
    mocks.rpc.mockResolvedValueOnce({ error: { code: 'PT409' } });
    expect(await saveCategoryDisplayAction(id, values, 0, id, actor)).toHaveProperty('conflict', true);
    mocks.rpc.mockRejectedValueOnce(new Error('network'));
    expect(await saveCategoryDisplayAction(id, values, 0, id, actor)).toHaveProperty('uncertain', true);
    for (const bad of [{ ...snapshot, revision: 4 }, { ...snapshot, category: { ...category, id: actor } }, { ...snapshot, values: { ...values, mode: 'manual' } }]) {
      mocks.rpc.mockResolvedValueOnce({ data: bad, error: null });
      expect(await saveCategoryDisplayAction(id, values, 0, id, actor)).toHaveProperty('uncertain', true);
    }
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('미리보기에도 공개 표시·목적지 공통 변환을 적용하고 다른 범위 응답은 거절한다', async () => {
    const page = { category, offset: 0 }, hydrated = { ...page, banner: null };
    mocks.rpc.mockResolvedValue({ data: {}, error: null }); mocks.parsePage.mockReturnValue(page); mocks.hydrate.mockResolvedValue(hydrated);
    expect(await previewCategoryDisplayAction(id, values, query, actor)).toEqual({ page: hydrated });
    expect(mocks.hydrate).toHaveBeenCalledWith(page, expect.anything());
    mocks.parsePage.mockReturnValue({ ...page, category: { ...category, id: actor } });
    expect(await previewCategoryDisplayAction(id, values, query, actor)).toHaveProperty('error');
    expect(mocks.hydrate).toHaveBeenCalledTimes(1);
  });
});

describe('독립 전시분류 명령', () => {
  const node = { ...category, archivedAt: null, legacyCategoryId: null };
  const directory = { categories: [node], sourceCategories: [category], revision: 1, checkedAt: snapshot.checkedAt };
  const change = { action: 'create' as const, id, name: category.name, parentId: null, position: 0 };
  it('계정·입력을 먼저 확인하고 tree CAS/operation ID를 변경 없이 보낸다', async () => {
    const { updateCategoryDisplayTreeAction } = await import('./category-display-actions');
    expect(await updateCategoryDisplayTreeAction(change, 0, id, id)).toHaveProperty('error');
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: { nodeId: id, directory }, error: null });
    expect(await updateCategoryDisplayTreeAction(change, 0, id, actor)).toEqual({ nodeId: id, directory });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_update_category_display_tree', { p_change: change, p_expected_revision: 0, p_operation_id: id });
  });
  it('이름·순서·revision이 다른 응답을 저장 완료로 처리하지 않는다', async () => {
    const { updateCategoryDisplayTreeAction } = await import('./category-display-actions');
    for (const bad of [{ ...directory, revision: 2 }, { ...directory, categories: [{ ...node, name: '다름' }] }, { ...directory, categories: [{ ...node, sortOrder: 7 }] }]) {
      mocks.rpc.mockResolvedValueOnce({ data: { nodeId: id, directory: bad }, error: null });
      expect(await updateCategoryDisplayTreeAction(change, 0, id, actor)).toHaveProperty('uncertain', true);
    }
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('충돌과 통신 결과 불명확을 구분한다', async () => {
    const { updateCategoryDisplayTreeAction } = await import('./category-display-actions');
    mocks.rpc.mockResolvedValueOnce({ error: { code: 'PT409' } });
    expect(await updateCategoryDisplayTreeAction(change, 0, id, actor)).toHaveProperty('conflict', true);
    mocks.rpc.mockRejectedValueOnce(new Error('network'));
    expect(await updateCategoryDisplayTreeAction(change, 0, id, actor)).toHaveProperty('uncertain', true);
  });
});
