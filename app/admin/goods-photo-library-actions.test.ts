import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findGoodsPhotosAction, saveGoodsPhotoAction } from './goods-photo-library-actions';
const mocks = vi.hoisted(() => ({ access: vi.fn(), rpc: vi.fn(), load: vi.fn(), revalidate: vi.fn() }));
vi.mock('@/lib/admin/action-access.server', () => ({ requireAdminActionAccess: mocks.access }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/admin/goods-photo-library.server', () => ({ loadGoodsPhotos: mocks.load }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
const photo = { id: '00000000-0000-4000-8000-000000071301', name: ' 검수 사진 ', imagePath: 'public-media/catalog/good/00000000-0000-4000-8000-000000071302.webp', revision: 4, archived: false };
beforeEach(() => { vi.clearAllMocks(); mocks.access.mockResolvedValue({ user: { id: 'staff' } }); mocks.rpc.mockResolvedValue({ data: { id: photo.id, revision: 5 }, error: null }); });
describe('공용 사진 서버 액션', () => {
  it('모든 읽기·쓰기에서 스태프 권한을 먼저 확인한다', async () => {
    mocks.access.mockResolvedValue(null);
    expect(await findGoodsPhotosAction('', false, 1)).toEqual({ error: '관리자 권한이 필요합니다.' });
    expect(await saveGoodsPhotoAction(photo)).toEqual({ error: '관리자 권한이 필요합니다.' });
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.load).not.toHaveBeenCalled();
  });
  it('원본 버전과 파일 경로를 고정하여 저장하고 결과 식별자를 확인한다', async () => {
    expect(await saveGoodsPhotoAction(photo)).toEqual({ id: photo.id, revision: 5 });
    expect(mocks.rpc).toHaveBeenCalledWith('admin_save_goods_photo', { p_id: photo.id, p_image_path: photo.imagePath, p_name: '검수 사진', p_expected_revision: 4, p_archived: false });
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/catalog/photos');
    mocks.rpc.mockResolvedValue({ data: { id: 'other', revision: 5 }, error: null });
    expect(await saveGoodsPhotoAction(photo)).toMatchObject({ error: expect.stringContaining('저장 결과') });
  });
  it('형식 오류를 RPC 전에 거르고 DB 충돌·참조 오류를 사용자에게 구분한다', async () => {
    expect(await saveGoodsPhotoAction({...photo, imagePath:'https://example.com/img.png'})).toMatchObject({error:expect.stringContaining('업로드 상태')});
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValueOnce({ error: { code: 'PT409', message: 'goods_photo_changed' } });
    expect(await saveGoodsPhotoAction(photo)).toMatchObject({ error: expect.stringContaining('입력은 유지') });
    mocks.rpc.mockResolvedValueOnce({ error: { message: 'goods_photo_in_use' } });
    expect(await saveGoodsPhotoAction({...photo, archived:true})).toMatchObject({ error: expect.stringContaining('사용 중인 사진') });
  });
  it('조회 실패를 빈 보관함으로 오해하지 않으며 정제한 검색어를 전달한다', async () => {
    mocks.load.mockRejectedValue(new Error('offline'));
    expect(await findGoodsPhotosAction(' 사진 ',true,2)).toMatchObject({ error: expect.stringContaining('불러오지 못했습니다') });
    expect(mocks.load).toHaveBeenCalledWith('사진',true,2);
  });
});
