import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blankGoodsAnnouncement } from '@/lib/admin/goods-announcements';
import { findGoodsForAnnouncementAction, resolveGoodsAnnouncementSaveAction, saveGoodsAnnouncementAction } from './goods-announcement-actions';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), load: vi.fn(), search: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/admin/goods-announcements.server', () => ({ loadGoodsAnnouncement: mocks.load, searchGoodsForAnnouncement: mocks.search }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
const ID = '00000000-0000-4000-8000-000000062211';
const ACCOUNT = '00000000-0000-4000-8000-000000062210';
const saved = { ...blankGoodsAnnouncement(ID), title: '배송 안내', body: '휴무 안내', reference: 1, revision: 1 };
function form() {
  const value = new FormData();
  for (const [key, text] of Object.entries({ accountId: ACCOUNT, operationId: '00000000-0000-4000-8000-000000062212', id: ID, revision: '0', title: '배송 안내', body: '휴무 안내', format: 'plain', category: 'shipping', device: 'all', enabled: 'false', important: 'false', allGoods: 'true', goodIds: '[]', usePeriod: 'false' })) value.set(key, text);
  return value;
}
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: ACCOUNT } }); mocks.rpc.mockResolvedValue({ data: { id: ID, revision: 1 }, error: null }); mocks.load.mockResolvedValue(saved); });
describe('상품 공지 저장 액션', () => {
  it('권한 확인 후 저장하고 DB의 최신 내용을 다시 읽는다', async () => {
    const result = await saveGoodsAnnouncementAction({}, form());
    expect(result.saved).toEqual(saved); expect(mocks.load).toHaveBeenCalledWith(ID);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_goods_announcement_v2', expect.objectContaining({ p_id: ID, p_expected_revision: 0, p_values: expect.objectContaining({ allGoods: true, goodIds: [] }) }));
    expect(mocks.revalidate).toHaveBeenCalledWith('/shop/[goodId]', 'page');
  });
  it('이전 저장 후 검증 실패해도 저장 버전을 잃지 않는다', async () => {
    const invalid = form(); invalid.set('title', '');
    const result = await saveGoodsAnnouncementAction({ saved }, invalid);
    expect(result.saved).toEqual(saved); expect(result.errors?.title).toBeTruthy(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('충돌과 저장 후 읽기 실패를 구별하고 재작성 대신 readback 링크를 제공한다', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: 'goods_announcement_changed' } });
    expect((await saveGoodsAnnouncementAction({}, form())).errors?.form).toContain('다른 저장 결과');
    mocks.load.mockRejectedValueOnce(new Error('offline'));
    const result = await saveGoodsAnnouncementAction({}, form());
    expect(result.savedId).toBe(ID); expect(result.outcome).toBe('saved'); expect(result.reloadRequired).toBe(true);
  });
  it('응답 유실과 결과 없음은 미확정으로 남기고 결과 재조회 뒤 홈도 갱신한다', async () => {
    mocks.rpc.mockRejectedValueOnce(new Error('network'));
    expect((await saveGoodsAnnouncementAction({}, form())).outcome).toBe('unknown');
    mocks.rpc.mockResolvedValueOnce({ data: null, error: null });
    expect((await resolveGoodsAnnouncementSaveAction({}, String(form().get('operationId')), ID, ACCOUNT)).outcome).toBe('unknown');
    expect((await resolveGoodsAnnouncementSaveAction({}, String(form().get('operationId')), ID, ACCOUNT)).outcome).toBe('saved');
    expect(mocks.revalidate).toHaveBeenCalledWith('/');
  });
  it('비스태프는 저장·상품찾기 RPC를 호출할 수 없다', async () => {
    mocks.access.mockResolvedValue(null);
    expect((await saveGoodsAnnouncementAction({}, form())).errors?.form).toContain('관리자 권한');
    expect(await findGoodsForAnnouncementAction('', 1)).toEqual({ error: '관리자 권한이 필요합니다.' });
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.search).not.toHaveBeenCalled();
  });
  it('원래 요청 계정과 현재 계정이 다르면 저장과 결과 조회를 RPC 전에 거절한다', async () => {
    mocks.access.mockResolvedValue({ user: { id: '00000000-0000-4000-8000-000000062219' } });
    expect(await saveGoodsAnnouncementAction({}, form())).toMatchObject({ outcome: 'rejected', errors: { form: expect.stringContaining('계정') } });
    expect(await resolveGoodsAnnouncementSaveAction({}, String(form().get('operationId')), ID, ACCOUNT)).toMatchObject({ outcome: 'unknown', errors: { form: expect.stringContaining('계정') } });
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.load).not.toHaveBeenCalled();
  });
  it('결과 조회에서 권한을 잃어도 unknown을 반환해 원래 요청 잠금을 유지한다', async () => {
    mocks.access.mockResolvedValue(null);
    expect((await resolveGoodsAnnouncementSaveAction({}, String(form().get('operationId')), ID, ACCOUNT)).outcome).toBe('unknown');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
