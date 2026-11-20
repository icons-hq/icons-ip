'use server';
import { revalidatePath } from 'next/cache';
import { revalidateGoodsSurfaces } from '@/lib/admin/revalidate-goods.server';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { parseDetailSection, PRODUCT_DETAIL_PRESENTATION_PATH, type DetailPresentation, type DetailSection } from '@/lib/product-detail-presentation';
export type DetailSaveResult = { section: DetailSection; values: DetailPresentation[DetailSection]; revision: number } | { error: string; uncertain?: boolean };
const unknownResult = (): DetailSaveResult => ({ error: '저장됐는지 확인하지 못했습니다. 입력을 바꾸지 말고 \'같은 요청 결과 확인\'을 눌러주세요. 같은 요청은 두 번 저장되지 않습니다.', uncertain: true });
export async function saveDetailPresentationAction(section: DetailSection, input: unknown, revision: number, operationId: string): Promise<DetailSaveResult> {
  try {
    if (!await requireAdminActionAccess(PRODUCT_DETAIL_PRESENTATION_PATH, { capability: 'store.manage' })) return { error: '스토어 관리 권한이 필요합니다.' };
    const values = parseDetailSection(section, input);
    if (!values || !isUuid(operationId) || !Number.isSafeInteger(revision) || revision < 0) return { error: '저장할 수 없는 입력이 있습니다. 문구·대상·기간을 확인하고, 계속되면 화면을 새로고침한 뒤 다시 저장해주세요.' };
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_product_detail_presentation', { p_section: section, p_values: values, p_expected_revision: revision, p_operation_id: operationId });
    if (error?.code === 'PT409') return { error: '다른 관리자가 수정했습니다. 입력값을 보관한 뒤 최신 설정을 다시 불러와주세요.' };
    if (error && ['22023', '42501', 'P0002', '23505'].includes(error.code ?? '')) return { error: '저장하지 못했습니다. 고른 카테고리나 상품이 삭제되었을 수 있으니 대상을 다시 골라주세요. 계속되면 스토어 관리 권한이 있는 계정인지 확인해주세요.' };
    if (error || !parseDetailSection(section, data?.values) || data?.section !== section || data?.revision !== revision + 1) return unknownResult();
    revalidatePath(PRODUCT_DETAIL_PRESENTATION_PATH); revalidateGoodsSurfaces();
    return { section, values: data.values, revision: data.revision };
  } catch (error) { unstable_rethrow(error); return unknownResult(); }
}
