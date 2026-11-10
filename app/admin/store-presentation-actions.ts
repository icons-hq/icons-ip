'use server';
import { revalidatePath, updateTag } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { parseStorePresentationSection, parseGoodsColorChips, STORE_PRESENTATION_PATH, STORE_PRESENTATION_CACHE_TAG, type StorePresentation, type StorePresentationSection, type GoodsColorChip } from '@/lib/store-presentation';
type Failure = { error: string; uncertain?: boolean };
export type StorePresentationSaveResult = { section: StorePresentationSection; values: StorePresentation[StorePresentationSection]; revision: number } | Failure;
export type GoodsListingColorsResult = { colors: GoodsColorChip[]; revision: number } | Failure;
function failure(error?: { code?: string; message?: string }): Failure {
  if (error?.code === 'PT409') return { error: '다른 관리자가 수정했습니다. 입력값을 보관한 뒤 최신 설정을 다시 불러와주세요.' };
  if (['22023', '42501', 'P0002', '23505'].includes(error?.code ?? '')) return { error: '현재 권한과 입력값을 확인해주세요. 대상이 삭제·보관되었을 수 있습니다.' };
  return { error: '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true };
}
export async function saveStorePresentationAction(section: StorePresentationSection, input: unknown, expectedRevision: number, operationId: string): Promise<StorePresentationSaveResult> {
  try {
    if (!await requireAdminActionAccess(STORE_PRESENTATION_PATH, { capability: 'store.manage' })) return { error: '스토어 관리 권한이 필요합니다.' };
    const values = parseStorePresentationSection(section, input);
    if (!values || !isUuid(operationId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return { error: '설정값과 저장 기준을 확인해주세요.' };
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_store_presentation', { p_section: section, p_values: values, p_expected_revision: expectedRevision, p_operation_id: operationId });
    if (error) return failure(error);
    const saved = parseStorePresentationSection(section, data?.values);
    if (!saved || data.section !== section || !Number.isSafeInteger(data.revision) || data.revision !== expectedRevision + 1) return failure();
    updateTag(STORE_PRESENTATION_CACHE_TAG); revalidatePath(STORE_PRESENTATION_PATH); revalidatePath('/', 'layout');
    return { section, values: saved, revision: data.revision };
  } catch (error) { unstable_rethrow(error); return failure(); }
}
export async function loadGoodsListingColorsAction(goodId: string): Promise<GoodsListingColorsResult> {
  try {
    if (!await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' })) return { error: '상품 관리 권한이 필요합니다.' };
    const client = await createClient();
    const { data, error } = await client.rpc('admin_get_goods_listing_colors', { p_good_id: goodId });
    const colors = parseGoodsColorChips(data?.colors);
    if (error || !colors || !Number.isSafeInteger(data?.revision) || data.revision < 0) return { error: '저장된 색상칩을 불러오지 못했습니다.' };
    return { colors, revision: data.revision };
  } catch (error) { unstable_rethrow(error); return { error: '저장된 색상칩을 불러오지 못했습니다.' }; }
}
export async function saveGoodsListingColorsAction(goodId: string, input: unknown, expectedRevision: number, operationId: string): Promise<GoodsListingColorsResult> {
  try {
    if (!await requireAdminActionAccess('/admin/catalog/goods', { capability: 'catalog.manage' })) return { error: '상품 관리 권한이 필요합니다.' };
    const colors = parseGoodsColorChips(input);
    if (!colors || !isUuid(operationId) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !/^[a-z0-9][a-z0-9-]{0,199}$/.test(goodId)) return { error: '색상칩은 이름·6자리 색상값을 확인해 최대 20개까지 등록해주세요.' };
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_goods_listing_colors', { p_good_id: goodId, p_colors: colors, p_expected_revision: expectedRevision, p_operation_id: operationId });
    if (error) return failure(error);
    const saved = parseGoodsColorChips(data?.colors);
    if (!saved || data?.revision !== expectedRevision + 1) return failure();
    revalidatePath('/admin/catalog/goods'); revalidatePath('/', 'layout');
    return { colors: saved, revision: data.revision };
  } catch (error) { unstable_rethrow(error); return failure(); }
}
