'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { claimWithdrawalError, claimWithdrawalReceiptMatches, normalizeClaimWithdrawalRequest, parseClaimWithdrawalContext, parseClaimWithdrawalReceipt, type ClaimWithdrawalResult } from '@/lib/orders/claim-withdrawal';
const access = () => requireAdminActionAccess('/admin/sales/claims/returns', { capability: 'sales.manage' });
export async function loadAdminClaimWithdrawalAction(claimId: string): Promise<ClaimWithdrawalResult> {
  if (!await access()) return { error: claimWithdrawalError('42501') };
  if (!isUuid(claimId)) return { error: '요청번호를 확인해주세요.' };
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_order_claim_withdrawal_context', { p_claim_id: claimId });
    const context = parseClaimWithdrawalContext(data);
    if (error || !context || context.claimId !== claimId) return { error: claimWithdrawalError(error?.code, error?.message) };
    return { context };
  } catch (error) { unstable_rethrow(error); return { error: '요청의 최신 상태를 읽지 못했습니다.' }; }
}
export async function readAdminClaimWithdrawalAction(id: string): Promise<ClaimWithdrawalResult> {
  if (!await access()) return { error: claimWithdrawalError('42501'), uncertain: true };
  if (!isUuid(id)) return { error: '요청번호를 확인해주세요.', uncertain: true };
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_read_order_claim_withdrawal', { p_operation_id: id });
    if (error) return { error: claimWithdrawalError(error.code, error.message), uncertain: true };
    if (data === null) return { receipt: null };
    const receipt = parseClaimWithdrawalReceipt(data);
    return receipt?.id === id && receipt.actorKind === 'operator' ? { receipt } : { error: '저장 결과를 확인하지 못했습니다.', uncertain: true };
  } catch (error) { unstable_rethrow(error); return { error: '저장 결과를 읽지 못했습니다.', uncertain: true }; }
}
export async function submitAdminClaimWithdrawalAction(input: unknown): Promise<ClaimWithdrawalResult> {
  if (!await access()) return { error: claimWithdrawalError('42501') };
  const request = normalizeClaimWithdrawalRequest(input); if (!request) return { error: claimWithdrawalError(undefined, 'invalid_claim_withdrawal') };
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_withdraw_order_claim', { p_claim_id: request.claimId, p_operation_id: request.id,
      p_expected_revision: request.revision, p_reason: request.reason, p_confirmed: request.confirmed });
    if (error) return { error: claimWithdrawalError(error.code, error.message), conflict: error.code === 'PT409', uncertain: !['PT409', '42501', '22023', '23514', 'P0002'].includes(error.code ?? '') };
    const receipt = parseClaimWithdrawalReceipt(data);
    if (!receipt || !claimWithdrawalReceiptMatches(receipt, request, true)) return { error: '저장 결과가 불확실합니다. 같은 요청을 확인해주세요.', uncertain: true };
    for (const path of ['/admin/sales/claims', '/admin/sales/orders', `/admin/sales/orders/${receipt.orderId}`, `/orders/${receipt.orderId}`]) revalidatePath(path, path === '/admin/sales/claims' ? 'layout' : 'page');
    return { receipt };
  } catch (error) { unstable_rethrow(error); return { error: '저장 결과가 불확실합니다. 같은 요청을 확인해주세요.', uncertain: true }; }
}
