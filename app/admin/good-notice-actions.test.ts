import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), rpc: vi.fn(), presets: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('@/lib/admin/goods-notice-presets.server', () => ({ loadGoodsNoticePresets: mocks.presets }));
import { findGoodNoticePresets, loadLastSavedGoodNotice } from './good-notice-actions';
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ user: { id: 'staff' }, isStaff: true }); mocks.client.mockResolvedValue({ rpc: mocks.rpc }); });
describe('goods notice copying', () => {
  it('rejects nonstaff before reading saved values or presets', async () => {
    mocks.auth.mockResolvedValue({ user: { id: 'fan' }, isStaff: false });
    expect(await findGoodNoticePresets('cotton', 1)).toEqual({ error: '관리자 권한이 필요합니다.' });
    expect(await loadLastSavedGoodNotice()).toEqual({ error: '관리자 권한이 필요합니다.' });
    expect(mocks.presets).not.toHaveBeenCalled(); expect(mocks.client).not.toHaveBeenCalled();
  });
  it('copies all seven saved values verbatim and searches named presets by page', async () => {
    const notice = { maker: '굿즈 메이커', origin: '한국', material: '면', size: 'L', madeOn: '2026', asManager: '직접 이름', asContact: '직접 연락처' };
    mocks.rpc.mockResolvedValue({ data: { name: '상품', notice }, error: null });
    expect(await loadLastSavedGoodNotice()).toEqual({ name: '상품', notice });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_last_good_notice');
    mocks.presets.mockResolvedValue({ presets: [{ name: '면', notice }], total: 1, filters: { query: '면', page: 2 } });
    await findGoodNoticePresets('  면 ', 2);
    expect(mocks.presets).toHaveBeenCalledWith({ query: '면', page: 2 });
  });
  it('returns a retry message without private provider details', async () => {
    mocks.rpc.mockRejectedValue(new Error('secret provider state'));
    expect(await loadLastSavedGoodNotice()).toEqual({ error: '최근 값을 불러오지 못했습니다. 다시 시도해주세요.' });
  });
});
