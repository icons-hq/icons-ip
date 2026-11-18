const { legacyOperatorAccessFixture } = await vi.hoisted(() => import('@/lib/admin/access.test-fixtures'));
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: { isConfigured: true, isStaff: true, operatorAccess: legacyOperatorAccessFixture(), user: { id: 'staff' } }, rpc: vi.fn(), revalidatePath: vi.fn() }));
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
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/shop/[goodId]', 'page');
  });
  it('공개 필수 항목 오류를 안내하고 DB 내부 상세는 노출하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'goods_publish_incomplete private diagnostic' } });
    const result = await setAdminGoodPublishedAction({}, form(true));
    expect(result.error).toContain('대표 이미지');
    expect(JSON.stringify(result)).not.toContain('private diagnostic');
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
  /* ADR-0044: 대표 카테고리가 없으면 공개하지 않는다. 옛 상품 유형 오류 코드는 더 매핑하지 않는다. */
  it('대표 카테고리 없음으로 차단된 경우 이유를 알려준다', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'goods_category_required' } });
    expect((await setAdminGoodPublishedAction({}, form(true))).error).toBe('대표 카테고리를 고른 뒤 공개해주세요.');
    mocks.rpc.mockResolvedValue({ error: { message: 'goods_type_category_required' } });
    expect((await setAdminGoodPublishedAction({}, form(true))).error).toBe('게시 상태를 변경하지 못했습니다. 최신 상품을 확인해주세요.');
  });
  it('KC 미검토로 차단된 경우 검토할 작업을 알려준다', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'goods_kc_review_required private diagnostic' } });
    const result = await setAdminGoodPublishedAction({}, form(true));
    expect(result.error).toContain('KC 정보에서 검토를 완료한 뒤 공개');
    expect(result.error).toContain('상품 전체 KC 해당 없음');
    expect(result.error).not.toContain('private diagnostic');
  });
});
