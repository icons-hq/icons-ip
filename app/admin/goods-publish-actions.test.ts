import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: { isConfigured: true, isStaff: true, user: { id: 'staff' } }, rpc: vi.fn(), revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: async () => mocks.auth }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
import { setAdminGoodPublishedAction } from './goods-publish-actions';
function form(published: boolean, confirmed = false) {
  const data = new FormData(); data.set('id', 'good-1'); data.set('published', String(published));
  if (confirmed) data.set('confirmUnpublish', 'yes');
  return data;
}
beforeEach(() => { mocks.auth.isStaff = true; mocks.rpc.mockReset().mockResolvedValue({ data: true, error: null }); mocks.revalidatePath.mockClear(); });
describe('상품 게시 상태 액션', () => {
  it('초안 전환의 영향을 확인하기 전에는 변경하지 않는다', async () => {
    expect((await setAdminGoodPublishedAction({}, form(false))).error).toContain('확인');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('운영자만 변경하며 공개 표면과 상품 목록을 갱신한다', async () => {
    mocks.auth.isStaff = false;
    expect((await setAdminGoodPublishedAction({}, form(true))).error).toContain('권한');
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.auth.isStaff = true;
    expect((await setAdminGoodPublishedAction({}, form(false, true))).message).toContain('초안');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_set_good_published', { target_id: 'good-1', target_published: false });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/catalog/goods');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/shop/good-1');
  });
  it('공개 필수 항목 오류를 안내하고 DB 내부 상세는 노출하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'goods_publish_incomplete private diagnostic' } });
    const result = await setAdminGoodPublishedAction({}, form(true));
    expect(result.error).toContain('대표 이미지');
    expect(JSON.stringify(result)).not.toContain('private diagnostic');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  it('KC 미검토로 차단된 경우 검토할 작업을 알려준다', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'goods_kc_review_required private diagnostic' } });
    const result = await setAdminGoodPublishedAction({}, form(true));
    expect(result.error).toContain('KC');
    expect(result.error).toContain('검토');
    expect(result.error).not.toContain('private diagnostic');
  });
});
