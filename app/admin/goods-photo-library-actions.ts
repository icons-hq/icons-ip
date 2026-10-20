'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { GOODS_PHOTOS_PATH, validGoodsPhotoInput, goodsPhotoError, type GoodsPhotoInput, type GoodsPhotoPage } from '@/lib/admin/goods-photo-library';
import { loadGoodsPhotos } from '@/lib/admin/goods-photo-library.server';

export async function findGoodsPhotosAction(query: string, archived: boolean, page: number): Promise<{ data: GoodsPhotoPage } | { error: string }> {
  if (!await requireAdminActionAccess(GOODS_PHOTOS_PATH)) return { error: '관리자 권한이 필요합니다.' };
  if (typeof query !== 'string' || query.length > 100 || typeof archived !== 'boolean' || !Number.isSafeInteger(page) || page < 1 || page > 100000) return { error: '검색 조건을 확인해주세요.' };
  try { return { data: await loadGoodsPhotos(query.trim(), archived, page) }; }
  catch (error) { unstable_rethrow(error); return { error: '사진 보관함을 불러오지 못했습니다. 다시 조회해주세요.' }; }
}
export async function saveGoodsPhotoAction(input: GoodsPhotoInput): Promise<{ id: string; revision: number } | { error: string }> {
  if (!await requireAdminActionAccess(GOODS_PHOTOS_PATH)) return { error: '관리자 권한이 필요합니다.' };
  if (!validGoodsPhotoInput(input)) return { error: '사진 이름(1~100자)과 업로드 상태를 확인해주세요.' };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_goods_photo', { p_id: input.id, p_image_path: input.imagePath, p_name: input.name.trim(), p_expected_revision: input.revision, p_archived: input.archived });
    if (error) return { error: goodsPhotoError(error.message) };
    if (!data || data.id !== input.id || !Number.isSafeInteger(data.revision) || data.revision < 1) return { error: '저장 결과를 확인하지 못했습니다. 목록을 다시 조회해주세요.' };
    revalidatePath(GOODS_PHOTOS_PATH);
    return { id: data.id, revision: data.revision };
  } catch (error) { unstable_rethrow(error); return { error: goodsPhotoError(undefined) }; }
}
