'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { parseDetailSection, PRODUCT_DETAIL_PRESENTATION_PATH, type DetailPresentation, type DetailSection } from '@/lib/product-detail-presentation';
export type DetailSaveResult = { section: DetailSection; values: DetailPresentation[DetailSection]; revision: number } | { error: string; uncertain?: boolean };
const unknownResult = (): DetailSaveResult => ({ error: '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true });
export async function saveDetailPresentationAction(section: DetailSection, input: unknown, revision: number, operationId: string): Promise<DetailSaveResult> {
  try {
    if (!await requireAdminActionAccess(PRODUCT_DETAIL_PRESENTATION_PATH, { capability: 'store.manage' })) return { error: '스토어 관리 권한이 필요합니다.' };
    const values = parseDetailSection(section, input);
    if (!values || !isUuid(operationId) || !Number.isSafeInteger(revision) || revision < 0) return { error: '문구·대상·기간과 저장 기준을 확인해주세요.' };
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_product_detail_presentation', { p_section: section, p_values: values, p_expected_revision: revision, p_operation_id: operationId });
    if (error?.code === 'PT409') return { error: '다른 관리자가 수정했습니다. 입력값을 보관한 뒤 최신 설정을 다시 불러와주세요.' };
    if (error && ['22023', '42501', 'P0002', '23505'].includes(error.code ?? '')) return { error: '현재 권한과 입력값을 확인해주세요. 선택한 대상이 삭제되었을 수 있습니다.' };
    if (error || !parseDetailSection(section, data?.values) || data?.section !== section || data?.revision !== revision + 1) return unknownResult();
    revalidatePath(PRODUCT_DETAIL_PRESENTATION_PATH); revalidatePath('/shop/[goodId]', 'page');
    return { section, values: data.values, revision: data.revision };
  } catch (error) { unstable_rethrow(error); return unknownResult(); }
}
