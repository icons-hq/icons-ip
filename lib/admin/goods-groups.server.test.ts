import { beforeEach, expect, it, vi } from 'vitest';
import { groupTestGroup as group, groupTestSource as source } from './goods-groups.test-fixtures';
const mocks = vi.hoisted(() => ({ create: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.create }));
import { loadGoodsGroup, loadGoodsGroups, loadGoodsGroupSource, searchGoodsGroupCandidates } from './goods-groups.server';
beforeEach(() => { vi.resetAllMocks(); mocks.create.mockResolvedValue({ rpc: mocks.rpc }); });
it('서버 목록은 페이지 계약과 각 그룹 스냅샷을 함께 검증한다', async () => {
  const page = { rows: [group], total: 1, page: 1, pageSize: 30 }; mocks.rpc.mockResolvedValue({ data: page, error: null });
  expect(await loadGoodsGroups('그룹', 1)).toEqual(page); expect(mocks.rpc).toHaveBeenCalledWith('admin_search_goods_groups', { p_query: '그룹', p_page: 1, p_page_size: 30 });
  mocks.rpc.mockResolvedValue({ data: { ...page, page: 2 }, error: null }); await expect(loadGoodsGroups()).rejects.toThrow('목록');
});
it('상품/그룹 로더는 없는 자료와 잘못된 다른 ID 응답을 구분한다', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: source, error: null }); expect(await loadGoodsGroupSource(source.goodId)).toEqual(source);
  mocks.rpc.mockResolvedValueOnce({ data: group, error: null }); expect(await loadGoodsGroup(group.id)).toEqual(group);
  mocks.rpc.mockResolvedValue({ data: null, error: null }); expect(await loadGoodsGroup(group.id)).toBeNull(); expect(await loadGoodsGroupSource(source.goodId)).toBeNull();
  mocks.rpc.mockResolvedValue({ data: source, error: null }); await expect(loadGoodsGroupSource('different')).rejects.toThrow('현재 상태');
});
it('검색은 기존 검색 RPC의 현재 상품을 최소 필드로만 조회한다', async () => {
  const query = { select: vi.fn(), is: vi.fn(), order: vi.fn(), range: vi.fn() };
  query.select.mockReturnValue(query); query.is.mockReturnValue(query); query.order.mockReturnValue(query); query.range.mockResolvedValue({ data: [{ id: source.goodId, name: source.name, code: source.code, archived_at: null }], error: null, count: 21 });
  mocks.rpc.mockReturnValue(query); expect(await searchGoodsGroupCandidates('%_', 2)).toMatchObject({ total: 21, page: 2, rows: [{ id: source.goodId, name: source.name, code: source.code }] });
  expect(mocks.rpc).toHaveBeenCalledWith('admin_search_goods', { search_text: '%_' }, { count: 'exact' }); expect(query.select).toHaveBeenCalledWith('id,code,name,archived_at'); expect(query.range).toHaveBeenCalledWith(20, 39);
  query.range.mockResolvedValue({ data: [], error: null, count: null }); await expect(searchGoodsGroupCandidates('', 1)).rejects.toThrow('검색');
});
