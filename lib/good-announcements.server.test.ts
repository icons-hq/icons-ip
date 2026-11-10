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
  it('미설정에서는 조용히 비우고 DB 오류는 공지 조회 실패로 표시한다', async () => {
    mocks.configured = false; expect(await loadGoodAnnouncements('good-a')).toEqual({ items: [], nextChangeAt: null }); expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.configured = true; mocks.rpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
    expect(await loadGoodAnnouncements('good-a')).toEqual({ items: [], nextChangeAt: null, unavailable: true });
  });
});
