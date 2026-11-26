import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), search: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/admin/goods-option-import.server', () => ({ searchGoodsOptionImportSources: mocks.search, readGoodsOptionImportSource: mocks.read }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { GoodsOptionImportError } from '@/lib/admin/goods-option-import';
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
  /* 같은 문구라도 일반 오류로 오면 내보내지 않는다. 원인을 담아 던진 불러오기 오류만 그대로 보인다. */
  mocks.read.mockRejectedValueOnce(new Error('이 상품에는 내부 진단'));
  expect(await readGoodsOptionImportAction({ sourceId: 'source', targetId: null })).toEqual({ ok: false, error: '상품과 옵션을 불러오지 못했습니다. 현재 입력은 유지됩니다.' });
  const reason = '이 상품은 옵션 없이 파는 상품이라 불러올 옵션이 없습니다. 다른 상품을 골라 주세요.';
  mocks.read.mockRejectedValueOnce(new GoodsOptionImportError(reason));
  expect(await readGoodsOptionImportAction({ sourceId: 'source', targetId: null })).toEqual({ ok: false, error: reason });
});
/* 이 검색은 공용 상품 선택창·복사등록도 쓴다. 기존 입력({ query, field, categoryId, page })은 그대로 받고, 옵션 원본 조건은 선택 인자다. */
it('기존 검색 입력은 그대로 넘기고, 옵션 원본 조건은 줄 때만 더한다', async () => {
  mocks.search.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20 });
  expect(await searchGoodsOptionImportAction({ query: ' 키링 ', field: 'code', categoryId: '', page: 2 })).toEqual({ ok: true, accountId: 'operator', data: { rows: [], total: 0, page: 1, pageSize: 20 } });
  expect(mocks.search).toHaveBeenLastCalledWith({ query: '키링', field: 'code', categoryId: '', page: 2 });
  expect(Object.keys(mocks.search.mock.calls[0][0]).sort()).toEqual(['categoryId', 'field', 'page', 'query']);
  await searchGoodsOptionImportAction({ query: '', field: 'name', categoryId: '', page: 1, optionSourcesOnly: true, excludeGoodId: 'target' });
  expect(mocks.search).toHaveBeenLastCalledWith({ query: '', field: 'name', categoryId: '', page: 1, optionSourcesOnly: true, excludeGoodId: 'target' });
  for (const invalid of [{ optionSourcesOnly: 'yes' }, { optionSourcesOnly: true, excludeGoodId: '../etc' }]) {
    expect(await searchGoodsOptionImportAction({ query: '', field: 'name', categoryId: '', page: 1, ...invalid })).toEqual({ ok: false, error: '상품 검색 조건을 확인해주세요.' });
  }
  expect(mocks.search).toHaveBeenCalledTimes(2);
});
/* 고시 '다른 상품에서 복사' 선택창도 같은 검색에 고시 원본 조건을 더해 부른다. 두 원본 조건을 함께 주면 받지 않는다. */
it('고시 원본 조건은 줄 때만 더해 넘기고, 옵션 원본 조건과 함께 오면 거절한다', async () => {
  mocks.search.mockResolvedValue({ rows: [], total: 0, page: 1, pageSize: 20 });
  await searchGoodsOptionImportAction({ query: '', field: 'name', categoryId: '', page: 1, noticeSourcesOnly: true, excludeGoodId: 'target' });
  expect(mocks.search).toHaveBeenLastCalledWith({ query: '', field: 'name', categoryId: '', page: 1, noticeSourcesOnly: true, excludeGoodId: 'target' });
  await searchGoodsOptionImportAction({ query: '', field: 'name', categoryId: '', page: 1, noticeSourcesOnly: true });
  expect(mocks.search).toHaveBeenLastCalledWith({ query: '', field: 'name', categoryId: '', page: 1, noticeSourcesOnly: true });
  for (const invalid of [{ noticeSourcesOnly: 'yes' }, { noticeSourcesOnly: true, optionSourcesOnly: true }, { noticeSourcesOnly: true, excludeGoodId: '../etc' }]) {
    expect(await searchGoodsOptionImportAction({ query: '', field: 'name', categoryId: '', page: 1, ...invalid })).toEqual({ ok: false, error: '상품 검색 조건을 확인해주세요.' });
  }
  expect(mocks.search).toHaveBeenCalledTimes(2);
});
