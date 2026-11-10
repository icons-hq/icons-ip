import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), search: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/admin/goods-option-import.server', () => ({ searchGoodsOptionImportSources: mocks.search, readGoodsOptionImportSource: mocks.read }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { readGoodsOptionImportAction, searchGoodsOptionImportAction } from './goods-option-import-actions';
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: 'operator' } }); });
it('쓰기 권한 경계를 통과한 뒤 읽으며 잘못된 대상과 자기 자신을 거부한다', async () => {
  mocks.access.mockResolvedValueOnce(null);
  expect(await searchGoodsOptionImportAction({ query: '', field: 'name', categoryId: '', page: 1 })).toMatchObject({ ok: false });
  for (const input of [{ sourceId: 'source', targetId: 'source' }, { sourceId: 'invalid/id', targetId: null }, { sourceId: 'source' }]) expect((await readGoodsOptionImportAction(input)).ok).toBe(false);
  expect(mocks.search).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.access).toHaveBeenCalledWith('/admin/catalog/goods');
});
it('응답을 현재 계정과 선택한 원본/대상에 묶고 서버 진단을 노출하지 않는다', async () => {
  mocks.read.mockResolvedValueOnce({ source: { id: 'source' }, targetVersion: 'new' });
  expect(await readGoodsOptionImportAction({ sourceId: 'source', targetId: null })).toEqual({ ok: true, accountId: 'operator', source: { id: 'source' }, targetVersion: 'new' });
  expect(mocks.read).toHaveBeenCalledWith('source', null);
  mocks.read.mockRejectedValueOnce(new Error('internal secret token'));
  expect(await readGoodsOptionImportAction({ sourceId: 'source', targetId: 'target' })).toEqual({ ok: false, error: '상품과 옵션을 불러오지 못했습니다. 현재 입력은 유지됩니다.' });
});
