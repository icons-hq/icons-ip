const { legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), client: vi.fn(), rpc: vi.fn(), presets: vi.fn(), goodNotice: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
vi.mock('@/lib/admin/goods-notice-presets.server', () => ({ loadGoodsNoticePresets: mocks.presets, loadGoodNoticeOfGood: mocks.goodNotice }));
import { findGoodNoticePresets, loadGoodNoticeOf, loadLastSavedGoodNotice } from './good-notice-actions';
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'staff' }, isStaff: true, operatorAccess: legacyOperatorAccessFixture() }); mocks.client.mockResolvedValue({ rpc: mocks.rpc }); });
describe('goods notice copying', () => {
  it('rejects nonstaff before reading saved values or presets', async () => {
    mocks.auth.mockResolvedValue({ isConfigured: true, user: { id: 'fan' }, isStaff: false });
    expect(await findGoodNoticePresets('cotton', 1)).toEqual({ error: '관리자 권한이 필요합니다.' });
    expect(await loadLastSavedGoodNotice()).toEqual({ error: '관리자 권한이 필요합니다.' });
    expect(await loadGoodNoticeOf('good-a')).toEqual({ error: '관리자 권한이 필요합니다.' });
    expect(mocks.presets).not.toHaveBeenCalled(); expect(mocks.client).not.toHaveBeenCalled(); expect(mocks.goodNotice).not.toHaveBeenCalled();
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

describe('고른 상품의 고시정보 읽기(loadGoodNoticeOf)', () => {
  const notice = { maker: '메이커', origin: '한국', material: '면', size: 'L', madeOn: '2026-11', asManager: '이름', asContact: '02-000' };
  it('고른 상품의 이름과 7칸을 그대로 돌려준다', async () => {
    mocks.goodNotice.mockResolvedValue({ name: '키링', notice });
    expect(await loadGoodNoticeOf('good-a')).toEqual({ name: '키링', notice });
    expect(mocks.goodNotice).toHaveBeenCalledExactlyOnceWith('good-a');
  });
  it('상품 번호 형식이 맞지 않으면 읽지 않고 다시 고르게 한다', async () => {
    for (const bad of [undefined, null, 42, '', 'Good A', '-lead', 'a'.repeat(101), '../x', { id: 'good-a' }]) {
      expect(await loadGoodNoticeOf(bad)).toEqual({ error: '복사할 상품을 다시 골라주세요.' });
    }
    expect(mocks.goodNotice).not.toHaveBeenCalled();
  });
  it('상품이 없거나 보관됐으면 찾을 수 없다고 알린다', async () => {
    mocks.goodNotice.mockResolvedValue(null);
    expect(await loadGoodNoticeOf('good-a')).toEqual({ error: '상품을 찾을 수 없습니다. 목록을 다시 열어 골라주세요.' });
  });
  it('읽기에 실패해도 내부 사정 없이 다시 시도하라고만 알린다', async () => {
    mocks.goodNotice.mockRejectedValue(new Error('secret provider state'));
    expect(await loadGoodNoticeOf('good-a')).toEqual({ error: '고시정보를 불러오지 못했습니다. 다시 시도해주세요.' });
  });
});
