import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), load: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/admin/category.server', () => ({ loadGoodsCategoryOptions: mocks.load }));
import { loadCategoryCodesAction } from './category-code-actions';
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({}); });
it('requires current product management access before reading codes', async () => {
  mocks.access.mockResolvedValue(null);
  expect(await loadCategoryCodesAction()).toEqual({ ok: false, error: '상품 관리 권한이 필요합니다.' });
  expect(mocks.load).not.toHaveBeenCalled();
  expect(mocks.access).toHaveBeenCalledWith('/admin/catalog/goods/import', { capability: 'catalog.manage' });
});
it('separates an empty tree from a failed read', async () => {
  mocks.load.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('private database detail'));
  expect(await loadCategoryCodesAction()).toEqual({ ok: true, categories: [] });
  expect(await loadCategoryCodesAction()).toEqual({ ok: false, error: '카테고리 코드를 불러오지 못했습니다. 다시 조회해주세요.' });
});
