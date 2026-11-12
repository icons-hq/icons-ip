import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadGoodAnnouncements } from './good-announcements.server';
const mocks = vi.hoisted(() => ({ configured: true, rpc: vi.fn() }));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: mocks.configured }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
beforeEach(() => { mocks.configured = true; vi.clearAllMocks(); });
describe('공개 상품 공지 읽기', () => {
  it('현재 상품만 지정하고 DB가 정한 다음 전시 경계를 전달한다', async () => {
    mocks.rpc.mockResolvedValue({ data: { items: [], nextChangeAt: '2026-10-13T00:00:00Z' }, error: null });
    expect(await loadGoodAnnouncements('good-a')).toEqual({ items: [], nextChangeAt: '2026-10-13T00:00:00Z' });
    expect(mocks.rpc).toHaveBeenCalledWith('get_good_announcements', { p_good_id: 'good-a' });
  });
  it('공지마다 노출 위치를 싣고 위치가 없던 응답은 상단, 모르는 위치는 조회 실패로 본다', async () => {
    const item = { id: '00000000-0000-4000-8000-000000062211', title: '안내', body: '본문', format: 'plain', category: 'general', device: 'all', important: false };
    mocks.rpc.mockResolvedValueOnce({ data: { items: [{ ...item, placement: 'bottom' }, { ...item, id: '00000000-0000-4000-8000-000000062212' }], nextChangeAt: null }, error: null });
    expect((await loadGoodAnnouncements('good-a')).items.map(row => row.placement)).toEqual(['bottom', 'top']);
    mocks.rpc.mockResolvedValueOnce({ data: { items: [{ ...item, placement: 'side' }], nextChangeAt: null }, error: null });
    expect(await loadGoodAnnouncements('good-a')).toEqual({ items: [], nextChangeAt: null, unavailable: true });
  });
  it('미설정에서는 조용히 비우고 DB 오류는 공지 조회 실패로 표시한다', async () => {
    mocks.configured = false; expect(await loadGoodAnnouncements('good-a')).toEqual({ items: [], nextChangeAt: null }); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.configured = true; mocks.rpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
    expect(await loadGoodAnnouncements('good-a')).toEqual({ items: [], nextChangeAt: null, unavailable: true });
  });
});
