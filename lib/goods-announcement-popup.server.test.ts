import { beforeEach, expect, it, vi } from 'vitest';
import { loadHomeAnnouncementPopup } from './goods-announcement-popup.server';
const mocks = vi.hoisted(() => ({ configured: true, rpc: vi.fn(), client: vi.fn() }));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: mocks.configured, url: 'http://local', key: 'public-test-key' }) }));
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.client }));
beforeEach(() => { vi.clearAllMocks(); mocks.configured = true; mocks.client.mockReturnValue({ rpc: mocks.rpc }); });
it('쿠키 없는 공개 RPC의 예약 경계를 읽고 응답 오류는 빈 공지와 구분한다', async () => {
  mocks.rpc.mockResolvedValueOnce({ data: { item: null, nextChangeAt: '2026-10-14T00:00:00Z' }, error: null });
  expect(await loadHomeAnnouncementPopup()).toEqual({ item: null, nextChangeAt: '2026-10-14T00:00:00Z' });
  expect(mocks.rpc).toHaveBeenCalledWith('get_home_announcement_popup');
  expect(mocks.client.mock.calls[0][2].cookies.getAll()).toEqual([]);
  mocks.rpc.mockResolvedValueOnce({ data: {}, error: null });
  expect(await loadHomeAnnouncementPopup()).toMatchObject({ item: null, unavailable: true });
});
it('미설정 프로젝트에는 요청하지 않는다', async () => {
  mocks.configured = false; expect(await loadHomeAnnouncementPopup()).toEqual({ item: null, nextChangeAt: null }); expect(mocks.rpc).not.toHaveBeenCalled();
});
