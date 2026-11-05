'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { GOODS_PHOTOS_PATH, normalizeGoodsPhotoQuery, validGoodsPhotoInput, goodsPhotoError, type GoodsPhotoInput, type GoodsPhotoPage } from '@/lib/admin/goods-photo-library';
import { loadGoodsPhotos } from '@/lib/admin/goods-photo-library.server';

export async function findGoodsPhotosAction(query: string, archived: boolean, page: number): Promise<{ data: GoodsPhotoPage } | { error: string }> {
  if (!await requireAdminActionAccess(GOODS_PHOTOS_PATH)) return { error: '관리자 권한이 필요합니다.' };
  if (typeof query !== 'string' || query.length > 100 || typeof archived !== 'boolean' || !Number.isSafeInteger(page) || page < 1 || page > 100000) return { error: '검색 조건을 확인해주세요.' };
  // R20: 저장된 이름(NFC)과 같은 형태로 찾는다. macOS에서 붙여 넣은 NFD 검색어도 걸린다.
  try { return { data: await loadGoodsPhotos(normalizeGoodsPhotoQuery(query), archived, page) }; }
  catch (error) { unstable_rethrow(error); return { error: '사진 보관함을 불러오지 못했습니다. 다시 조회해주세요.' }; }
}
/**
 * 사진 하나를 저장한다. 여러 장을 연달아 올릴 때는 `{ revalidate: false }`로 저장마다 하던 화면 다시 그리기를 건너뛰고
 * 끝에 finishGoodsPhotoUploadsAction을 한 번 부른다(R19 — 서버 액션의 revalidatePath는 현재 화면 전체를 다시 렌더한다).
 */
export async function saveGoodsPhotoAction(input: GoodsPhotoInput, options?: { revalidate?: boolean }): Promise<{ id: string; revision: number } | { error: string }> {
  if (!await requireAdminActionAccess(GOODS_PHOTOS_PATH)) return { error: '관리자 권한이 필요합니다.' };
  const photo = input && typeof input === 'object' && typeof input.name === 'string' ? { ...input, name: input.name.normalize('NFC') } : input;
  if (!validGoodsPhotoInput(photo)) return { error: '사진 이름(1~100자)과 업로드 상태를 확인해주세요.' };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_goods_photo', { p_id: photo.id, p_image_path: photo.imagePath, p_name: photo.name.trim(), p_expected_revision: photo.revision, p_archived: photo.archived });
    if (error) return { error: goodsPhotoError(error.message) };
    if (!data || data.id !== photo.id || !Number.isSafeInteger(data.revision) || data.revision < 1) return { error: '저장 결과를 확인하지 못했습니다. 목록을 다시 조회해주세요.' };
    if (options?.revalidate !== false) revalidatePath(GOODS_PHOTOS_PATH);
    return { id: data.id, revision: data.revision };
  } catch (error) { unstable_rethrow(error); return { error: goodsPhotoError(undefined) }; }
}
/** 여러 장 업로드를 마친 뒤 사진 보관함 화면 캐시를 한 번만 갱신한다. */
export async function finishGoodsPhotoUploadsAction(): Promise<void> {
  if (!await requireAdminActionAccess(GOODS_PHOTOS_PATH)) return;
  revalidatePath(GOODS_PHOTOS_PATH);
}
