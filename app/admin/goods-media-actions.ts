'use server';
import { revalidatePath } from 'next/cache';
import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import { cancelGoodsMediaUpload, cleanupGoodsMediaUploads, prepareGoodsMediaUpload, verifyAndPromoteGoodsMedia, type GoodsMediaVerification } from '@/lib/admin/goods-media.server';
import { GOODS_MEDIA_PATH, GOODS_MEDIA_SETTINGS_PATH, GOODS_MEDIA_FILE_ERROR, parseGoodMediaSnapshot, parseGoodsMediaSelection, parseGoodsMediaSettings, validGoodsMediaUpload, type GoodMediaSnapshot, type GoodsMediaSettingsSnapshot } from '@/lib/goods-media';
import { isUuid } from '@/lib/uuid';

export async function prepareGoodsMediaAction(input: { id: string; kind: unknown; mimeType: unknown; size: unknown }): Promise<{ ok: true; id: string; path: string } | { ok: false; error: string }> {
  try {
    const auth = await requireAdminActionAccess(GOODS_MEDIA_PATH, { capability: 'catalog.manage' });
    if (!auth) return { ok: false, error: '상품 관리 권한이 필요합니다.' };
    if (!isUuid(input.id) || !validGoodsMediaUpload(input)) return { ok: false, error: GOODS_MEDIA_FILE_ERROR };
    const grant = await prepareGoodsMediaUpload(auth.user.id, input.id, input.kind, input.size);
    if (!grant) return { ok: false, error: '영상 업로드를 준비하지 못했습니다. 진행 중인 업로드를 마친 뒤 다시 시도해주세요.' };
    await cleanupGoodsMediaUploads(2); return { ok: true, ...grant };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '영상 업로드를 준비하지 못했습니다. 다시 시도해주세요.' }; }
}
export async function verifyGoodsMediaAction(id: string): Promise<GoodsMediaVerification> {
  try {
    const auth = await requireAdminActionAccess(GOODS_MEDIA_PATH, { capability: 'catalog.manage' });
    if (!auth || !isUuid(id)) return { ok: false, error: '영상을 확인할 수 없습니다. 상품 관리 권한이 있는 계정인지 확인한 뒤 파일을 다시 올려주세요.' };
    return verifyAndPromoteGoodsMedia(auth.user.id, id);
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '영상 확인이 끝났는지 알 수 없습니다. [같은 업로드 결과 확인]을 눌러주세요. 다시 올리지 않아도 됩니다.', uncertain: true }; }
}
export async function cancelGoodsMediaAction(id: string): Promise<void> {
  if (!isUuid(id)) return;
  try { const auth = await getCurrentAdminAuthState(); if (auth.user) await cancelGoodsMediaUpload(auth.user.id, id); }
  catch (error) { unstable_rethrow(error); }
}
type MediaSaveFailure = { error: string; uncertain?: boolean };
export type GoodMediaSaveResult = { snapshot: GoodMediaSnapshot } | MediaSaveFailure;
export type MediaSettingsSaveResult = { snapshot: GoodsMediaSettingsSnapshot } | MediaSaveFailure;
const unknownSave = (): MediaSaveFailure => ({ error: '저장됐는지 확인하지 못했습니다. 입력을 바꾸지 말고 [같은 요청 결과 확인]을 눌러주세요. 같은 요청은 두 번 저장되지 않습니다.', uncertain: true });
function failure(error: { code?: string } | null): MediaSaveFailure | null {
  if (error?.code === 'PT409') return { error: '다른 관리자가 먼저 수정했습니다. 지금 입력한 내용을 따로 적어 둔 뒤 화면을 새로고침하고, 최신 내용에서 다시 저장해주세요.' };
  return error && ['42501', '23505', '23514', '22023', 'P0002'].includes(error.code ?? '') ? { error: '저장하지 못했습니다. 이 작업 권한이 있는 계정인지와 상품·영상 상태를 확인해주세요. 올린 지 오래되어 만료된 영상은 다시 올려야 합니다.' } : null;
}
export async function saveGoodMediaAction(goodId: string, input: unknown, revision: number, operationId: string): Promise<GoodMediaSaveResult> {
  try {
    if (!await requireAdminActionAccess(GOODS_MEDIA_PATH, { capability: 'catalog.manage' })) return { error: '상품 관리 권한이 필요합니다.' };
    const values = parseGoodsMediaSelection(input);
    if (!values || !/^[a-z0-9][a-z0-9-]{0,199}$/.test(goodId) || !isUuid(operationId) || !Number.isSafeInteger(revision) || revision < 0) return { error: '저장 요청의 형식이 맞지 않습니다. 화면을 새로고침한 뒤 영상과 제목을 다시 확인하고 저장해주세요.' };
    const client = await createClient(), { data, error } = await client.rpc('admin_save_good_media', { p_good_id: goodId, p_values: values, p_revision: revision, p_operation_id: operationId });
    const known = failure(error); if (known) return known;
    const snapshot = !error ? parseGoodMediaSnapshot(data) : null;
    if (!snapshot || snapshot.goodId !== goodId || snapshot.revision !== revision + 1
      || ['video', 'shortclip'].some(kind => { const key = kind as 'video' | 'shortclip'; return (snapshot[key]?.id ?? null) !== (values[key]?.id ?? null) || (snapshot[key]?.title ?? null) !== (values[key]?.title ?? null); })) return unknownSave();
    revalidatePath(GOODS_MEDIA_PATH); revalidateGoodsSurfaces(); return { snapshot };
  } catch (error) { unstable_rethrow(error); return unknownSave(); }
}
export async function saveGoodsMediaSettingsAction(input: unknown, revision: number, operationId: string): Promise<MediaSettingsSaveResult> {
  try {
    if (!await requireAdminActionAccess(GOODS_MEDIA_SETTINGS_PATH, { capability: 'store.manage' })) return { error: '스토어 관리 권한이 필요합니다.' };
    const values = parseGoodsMediaSettings(input);
    if (!values || !isUuid(operationId) || !Number.isSafeInteger(revision) || revision < 0) return { error: '저장 요청의 형식이 맞지 않습니다. 화면을 새로고침한 뒤 미디어 표시 설정을 다시 저장해주세요.' };
    const client = await createClient(), { data, error } = await client.rpc('admin_save_goods_media_settings', { p_values: values, p_revision: revision, p_operation_id: operationId });
    const known = failure(error); if (known) return known;
    const result = !error ? parseGoodsMediaSettings(data?.values) : null;
    if (!result || data.revision !== revision + 1 || result.priority !== values.priority || result.shortclips !== values.shortclips) return unknownSave();
    revalidatePath(GOODS_MEDIA_SETTINGS_PATH); revalidateGoodsSurfaces(); return { snapshot: { values: result, revision: data.revision } };
  } catch (error) { unstable_rethrow(error); return unknownSave(); }
}
