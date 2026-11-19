'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { parsePurchaseRestrictionBatch, parsePurchaseRestrictionBatchForm, purchaseRestrictionBatchError, type PurchaseRestrictionBatch } from '@/lib/admin/purchase-restriction-batches';
import { loadPurchaseRestrictionBatch } from '@/lib/admin/purchase-restriction-batches.server';
const PATH = '/admin/sales/purchase-restrictions';
export type PurchaseRestrictionBatchActionState = { batch: PurchaseRestrictionBatch } | { error: string; errors?: Record<string, string>; uncertain?: boolean };
export async function previewPurchaseRestrictionBatchAction(form: FormData): Promise<PurchaseRestrictionBatchActionState> {
  if (!await requireAdminActionAccess(PATH)) return { error: '관리자 권한이 필요합니다.' };
  const parsed = parsePurchaseRestrictionBatchForm(form); if (!parsed.ok) return { error: '입력 칸에 고칠 곳이 있습니다. 칸 아래 안내대로 고친 뒤 다시 확인해주세요.', errors: parsed.errors };
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_preview_purchase_restriction_batch', {
      p_batch_id: parsed.id, p_mode: parsed.mode, p_inputs: parsed.targets, p_reason_code: parsed.reasonCode, p_reason_detail: parsed.reasonDetail,
    });
    if (error) return { error: purchaseRestrictionBatchError(error.message) };
    const batch = parsePurchaseRestrictionBatch(data); if (!batch || batch.id !== parsed.id) return { error: '대상 확인 결과를 받지 못했습니다. 아직 등록되지 않았습니다. ‘등록 대상 확인’을 다시 눌러주세요.' };
    return { batch };
  } catch (error) { unstable_rethrow(error); return { error: '대상을 확인하지 못했습니다. 아직 등록되지 않았습니다. ‘등록 대상 확인’을 다시 눌러주세요.' }; }
}
export async function readPurchaseRestrictionBatchAction(id: string): Promise<PurchaseRestrictionBatchActionState> {
  if (!await requireAdminActionAccess(PATH)) return { error: '관리자 권한이 필요합니다.' };
  if (!isUuid(id)) return { error: '등록 요청 번호가 올바르지 않습니다. 등록 대상 확인부터 다시 진행해주세요.' };
  try { const batch = await loadPurchaseRestrictionBatch(id); return batch ? { batch } : { error: '등록 요청을 찾을 수 없습니다.' }; }
  catch (error) { unstable_rethrow(error); return { error: '등록 결과를 불러오지 못했습니다. 잠시 뒤 ‘등록 결과 재조회’를 다시 눌러주세요.', uncertain: true }; }
}
export async function executePurchaseRestrictionBatchAction(id: string, confirmed: boolean): Promise<PurchaseRestrictionBatchActionState> {
  if (!await requireAdminActionAccess(PATH)) return { error: '관리자 권한이 필요합니다.' };
  if (!isUuid(id) || confirmed !== true) return { error: '등록하지 않았습니다. 공통 사유 적용과 신규 주문만 제한한다는 확인 칸에 체크한 뒤 다시 눌러주세요.' };
  try {
    const client = await createClient(); const { error } = await client.rpc('admin_execute_purchase_restriction_batch', { p_batch_id: id, p_confirmed: true });
    if (error) return { error: purchaseRestrictionBatchError(error.message), uncertain: !error.code || !['PT409', '22023', '23514', '42501', 'P0002'].includes(error.code) };
    revalidatePath(PATH);
    // Read the committed ledger-backed result rather than trusting a client-side
    // count or the dispatch response. The same batch id remains recoverable.
    const batch = await loadPurchaseRestrictionBatch(id);
    if (!batch || batch.status !== 'completed') return { error: '등록됐는지 확인하지 못했습니다. ‘등록 결과 재조회’를 눌러 결과를 확인해주세요. 같은 요청이라 두 번 등록되지 않습니다.', uncertain: true };
    return { batch };
  } catch (error) { unstable_rethrow(error); return { error: '등록됐는지 확인하지 못했습니다. ‘등록 결과 재조회’를 눌러 결과를 확인해주세요. 같은 요청이라 두 번 등록되지 않습니다.', uncertain: true }; }
}
