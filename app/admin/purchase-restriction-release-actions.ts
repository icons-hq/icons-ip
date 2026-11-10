'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { normalizeRestrictionRelease, restrictionReleaseError, type PurchaseRestrictionReleaseReceipt } from '@/lib/admin/purchase-restriction-release';
import { loadRestrictionRelease } from '@/lib/admin/purchase-restriction-release.server';
const PATH = '/admin/sales/purchase-restrictions';
export type RestrictionReleaseResult = { receipt: PurchaseRestrictionReleaseReceipt | null } | { error: string; uncertain?: boolean };

export async function readRestrictionReleaseAction(id: string): Promise<RestrictionReleaseResult> {
  if (!await requireAdminActionAccess(PATH)) return { error: '현재 매니저 권한을 확인해주세요.' };
  if (!isUuid(id)) return { error: '해제 요청을 확인해주세요.' };
  try { return { receipt: await loadRestrictionRelease(id.toLowerCase()) }; }
  catch (error) { unstable_rethrow(error); return { error: '해제 결과를 읽지 못했습니다. 같은 요청을 다시 조회해주세요.', uncertain: true }; }
}
export async function releaseRestrictionsAction(id: string, ids: string[], reason: string, confirmed: boolean): Promise<RestrictionReleaseResult> {
  if (!await requireAdminActionAccess(PATH)) return { error: '현재 매니저 권한을 확인해주세요.' };
  const parsed = normalizeRestrictionRelease(id, ids, reason);
  if ('error' in parsed) return { error: parsed.error };
  if (confirmed !== true) return { error: '선택한 기록과 구매제한 해제 범위를 확인해주세요.' };
  try {
    const client = await createClient();
    const { error } = await client.rpc('admin_release_purchase_restrictions', { p_operation_id: parsed.value.id, p_restriction_ids: parsed.value.ids, p_reason: parsed.value.reason });
    if (error) return { error: restrictionReleaseError(error.code), uncertain: !['42501', 'PT409', '23505', '22023'].includes(error.code ?? '') };
    revalidatePath(PATH);
    const receipt = await loadRestrictionRelease(parsed.value.id);
    if (!receipt) return { error: '저장 결과를 확인하지 못했습니다. 같은 요청의 결과를 조회해주세요.', uncertain: true };
    return { receipt };
  } catch (error) { unstable_rethrow(error); return { error: '처리 결과가 불확실합니다. 같은 요청의 결과를 조회해주세요.', uncertain: true }; }
}
