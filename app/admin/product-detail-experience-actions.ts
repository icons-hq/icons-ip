'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { parseExperienceSection, PRODUCT_DETAIL_EXPERIENCE_PATH, type DetailExperiences, type ExperienceSection } from '@/lib/product-detail-experiences';
export type ExperienceSaveResult = { section: ExperienceSection; values: DetailExperiences[ExperienceSection]; revision: number } | { error: string; uncertain?: boolean };
const unknownResult = (): ExperienceSaveResult => ({ error: '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true });
export async function saveDetailExperienceAction(section: ExperienceSection, input: unknown, revision: number, operationId: string): Promise<ExperienceSaveResult> {
  try {
    if (!await requireAdminActionAccess(PRODUCT_DETAIL_EXPERIENCE_PATH, { capability: 'store.manage' })) return { error: '스토어 관리 권한이 필요합니다.' };
    const values = parseExperienceSection(section, input);
    if (!values || !isUuid(operationId) || !Number.isSafeInteger(revision) || revision < 0) return { error: '설정값과 저장 기준을 확인해주세요.' };
    const client = await createClient();
    const { data, error } = await client.rpc('admin_save_product_detail_experiences', { p_section: section, p_values: values, p_expected_revision: revision, p_operation_id: operationId });
    if (error?.code === 'PT409') return { error: '다른 관리자가 수정했습니다. 입력값을 보관한 뒤 최신 설정을 다시 불러와주세요.' };
    if (error && ['22023', '42501', 'P0002', '23505'].includes(error.code ?? '')) return { error: '현재 권한과 입력값을 확인해주세요.' };
    if (error || !parseExperienceSection(section, data?.values) || data?.section !== section || data?.revision !== revision + 1) return unknownResult();
    revalidatePath(PRODUCT_DETAIL_EXPERIENCE_PATH); revalidatePath('/shop/[goodId]', 'page'); revalidatePath('/interests');
    return { section, values: data.values, revision: data.revision };
  } catch (error) { unstable_rethrow(error); return unknownResult(); }
}
