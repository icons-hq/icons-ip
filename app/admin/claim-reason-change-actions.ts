'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { claimReasonError, claimReasonReceiptMatches, normalizeClaimReasonRequest, parseClaimReasonContext, parseClaimReasonReceipt, type ClaimReasonResult } from '@/lib/orders/claim-reason-change';
const access = () => requireAdminActionAccess('/admin/sales/claims/exchanges', { capability: 'sales.manage' });
export async function loadClaimReasonContextAction(claimId: string): Promise<ClaimReasonResult> {
  const actor = await access(); if (!actor) return { error: claimReasonError('42501') };
  if (!isUuid(claimId)) return { error: '요청번호를 확인해주세요.' };
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_order_claim_reason_context', { p_claim_id: claimId });
    const context = parseClaimReasonContext(data);
    return !error && context?.claimId === claimId && context.actorId === actor.user.id ? { context } : { error: claimReasonError(error?.code, error?.message) };
  } catch (error) { unstable_rethrow(error); return { error: '최신 요청을 읽지 못했습니다.' }; }
}
export async function readClaimReasonChangeAction(id: string): Promise<ClaimReasonResult> {
  const actor = await access(); if (!actor) return { error: claimReasonError('42501'), uncertain: true };
  if (!isUuid(id)) return { error: '변경 요청번호를 확인해주세요.', uncertain: true };
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_read_order_claim_reason_change', { p_operation_id: id });
    if (error) return { error: claimReasonError(error.code, error.message), uncertain: true };
    if (data === null) return { receipt: null };
    const receipt = parseClaimReasonReceipt(data);
    return receipt?.id === id && receipt.actorId === actor.user.id ? { receipt } : { error: '해당 요청의 저장 결과를 확인하지 못했습니다.', uncertain: true };
  } catch (error) { unstable_rethrow(error); return { error: '저장 결과를 읽지 못했습니다.', uncertain: true }; }
}
export async function changeClaimReasonAction(input: unknown): Promise<ClaimReasonResult> {
  const actor = await access(); if (!actor) return { error: claimReasonError('42501') };
  const request = normalizeClaimReasonRequest(input); if (!request) return { error: claimReasonError(undefined, 'invalid_claim_reason_change') };
  if (request.actorId !== actor.user.id) return { error: claimReasonError('42501') };
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_change_order_claim_reason', {
      p_claim_id: request.claimId, p_operation_id: request.id, p_expected_revision: request.revision, p_expected_actor_id: request.actorId,
      p_reason_type: request.reasonType, p_reason: request.reason, p_agreement: request.agreement, p_confirmed: true, p_fee_reviewed: request.feeReviewed,
    });
    if (error) return { error: claimReasonError(error.code, error.message), conflict: error.code === 'PT409',
      uncertain: !['PT409', '42501', '22023', '23514', 'P0002'].includes(error.code ?? '') };
    const receipt = parseClaimReasonReceipt(data);
    if (!receipt || !claimReasonReceiptMatches(receipt, request)) return { error: '저장 결과가 불확실합니다. 같은 요청의 결과를 확인해주세요.', uncertain: true };
    if (receipt.changed) for (const path of ['/admin/sales/claims', '/admin/sales/orders', `/admin/sales/orders/${receipt.orderId}`, `/orders/${receipt.orderId}`]) {
      revalidatePath(path, path === '/admin/sales/claims' ? 'layout' : 'page');
    }
    return { receipt };
  } catch (error) { unstable_rethrow(error); return { error: '저장 결과가 불확실합니다. 같은 요청의 결과를 확인해주세요.', uncertain: true }; }
}
