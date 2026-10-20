import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blankGoodsAnnouncement, normalizeGoodsAnnouncementFilters } from './goods-announcements';
import { loadGoodsAnnouncement, loadGoodsAnnouncements, searchGoodsForAnnouncement } from './goods-announcements.server';
const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
const ID = '00000000-0000-4000-8000-000000062211';
beforeEach(() => { vi.clearAllMocks(); });
describe('상품 공지 관리자 읽기', () => {
  it('필터·페이지 범위를 서버로 전달하고 줄어든 결과의 마지막 페이지로 이동한다', async () => {
    mocks.rpc.mockResolvedValue({ data: { total: 2, rows: [] }, error: null });
    const result = await loadGoodsAnnouncements(normalizeGoodsAnnouncementFilters({ q: '휴무', category: 'shipping', state: 'shown', from: '2026-10-01', to: '2026-10-12', page: '4', pageSize: '50' }));
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, 'admin_list_goods_announcements', expect.objectContaining({ p_query: '휴무', p_category: 'shipping', p_state: 'shown', p_from: '2026-10-01', p_to: '2026-10-12', p_limit: 50, p_offset: 150 }));
    expect(result.filters.page).toBe(1); expect(mocks.rpc).toHaveBeenLastCalledWith('admin_list_goods_announcements', expect.objectContaining({ p_offset: 0 }));
  });
  it('상세 없음과 읽기 실패를 구별한다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { announcement: null, popup: { selected: false, revision: 5, startsAt: null, endsAt: null } }, error: null }); expect(await loadGoodsAnnouncement(ID)).toBeNull();
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'offline' } }); await expect(loadGoodsAnnouncement(ID)).rejects.toThrow('불러오지 못했습니다');
    mocks.rpc.mockResolvedValueOnce({ data: { announcement: { ...blankGoodsAnnouncement(ID), reference: 1, revision: 2 }, popup: blankGoodsAnnouncement(ID).popup }, error: null });
    expect(await loadGoodsAnnouncement(ID)).toMatchObject({ id: ID, revision: 2 });
  });
  it('신규 공지도 실제 전역 버전을 읽으며 읽기 실패를 0으로 바꾸지 않는다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { announcement: null, popup: { selected: false, revision: 9, startsAt: null, endsAt: null } }, error: null });
    expect(await loadGoodsAnnouncement(ID, true)).toMatchObject({ revision: 0, popup: { revision: 9 } });
    mocks.rpc.mockResolvedValueOnce({ data: { announcement: null, popup: null }, error: null });
    await expect(loadGoodsAnnouncement(ID, true)).rejects.toThrow('응답');
  });
  it('역전된 게시 기간이나 부분 중요기간을 정상 상세로 받지 않는다', async () => {
    for (const fields of [{ startsAt: '2026-10-15T00:00:00Z', endsAt: '2026-10-14T00:00:00Z' }, { importantStartsAt: '2026-10-14T00:00:00Z', importantEndsAt: null }]) {
      mocks.rpc.mockResolvedValueOnce({ data: { announcement: { ...blankGoodsAnnouncement(ID), reference: 1, revision: 1, ...fields }, popup: blankGoodsAnnouncement(ID).popup }, error: null });
      await expect(loadGoodsAnnouncement(ID)).rejects.toThrow('응답');
    }
  });
  it('상품찾기 빈 결과와 잘못된 응답을 구별한다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { total: 0, rows: [], page: 1, pageSize: 20 }, error: null });
    expect(await searchGoodsForAnnouncement('없음', 1)).toEqual({ total: 0, rows: [], page: 1, pageSize: 20 });
    mocks.rpc.mockResolvedValueOnce({ data: { total: '0', rows: [], page: 1, pageSize: 20 }, error: null });
    await expect(searchGoodsForAnnouncement('없음', 1)).rejects.toThrow('불러오지 못했습니다');
  });
});
