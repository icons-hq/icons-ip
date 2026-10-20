'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { claimTypeError, claimTypeReceiptMatches, normalizeClaimTypeRequest, parseClaimTypeContext, parseClaimTypeReceipt, type ClaimTypeResult } from '@/lib/orders/claim-type-conversion';
const access = () => requireAdminActionAccess('/admin/sales/claims/returns', { capability: 'sales.manage' });
export async function loadClaimTypeContextAction(claimId: string): Promise<ClaimTypeResult> {
  if (!await access()) return { error: claimTypeError('42501') };
  if (!isUuid(claimId)) return { error: '요청번호를 확인해주세요.' };
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_order_claim_type_change_context', { p_claim_id: claimId });
    const context = parseClaimTypeContext(data); return !error && context?.claimId === claimId ? { context } : { error: claimTypeError(error?.code, error?.message) };
  } catch (error) { unstable_rethrow(error); return { error: '최신 요청을 읽지 못했습니다.' }; }
}
export async function readClaimTypeChangeAction(id: string): Promise<ClaimTypeResult> {
  if (!await access()) return { error: claimTypeError('42501'), uncertain: true };
  if (!isUuid(id)) return { error: '변경 요청번호를 확인해주세요.', uncertain: true };
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_read_order_claim_type_change', { p_operation_id: id });
    if (error) return { error: claimTypeError(error.code, error.message), uncertain: true };
    if (data === null) return { receipt: null };
    const receipt = parseClaimTypeReceipt(data); return receipt?.id === id ? { receipt } : { error: '해당 변경의 저장 결과를 확인하지 못했습니다.', uncertain: true };
  } catch (error) { unstable_rethrow(error); return { error: '저장 결과를 읽지 못했습니다.', uncertain: true }; }
}
export async function convertClaimTypeAction(input: unknown): Promise<ClaimTypeResult> {
  if (!await access()) return { error: claimTypeError('42501') };
  const request = normalizeClaimTypeRequest(input); if (!request) return { error: claimTypeError(undefined, 'invalid_claim_conversion') };
  try {
    const client = await createClient(); const { data, error } = await client.rpc('admin_convert_order_claim_type', {
      p_claim_id: request.claimId, p_operation_id: request.id, p_expected_revision: request.revision, p_to_type: request.toType,
      p_agreement: request.agreement, p_confirmed: true, p_refund_account: request.refundAccount,
    });
    if (error) return { error: claimTypeError(error.code, error.message), conflict: error.code === 'PT409', uncertain: !['PT409','42501','22023','23514','P0002'].includes(error.code ?? '') };
    const receipt = parseClaimTypeReceipt(data);
    if (!receipt || !claimTypeReceiptMatches(receipt, request)) return { error: '저장 결과가 불확실합니다. 같은 요청을 확인해주세요.', uncertain: true };
    for (const path of ['/admin/sales/claims', '/admin/sales/orders', `/admin/sales/orders/${receipt.orderId}`, `/orders/${receipt.orderId}`]) revalidatePath(path, path === '/admin/sales/claims' ? 'layout' : 'page');
    return { receipt };
  } catch (error) { unstable_rethrow(error); return { error: '저장 결과가 불확실합니다. 같은 요청을 확인해주세요.', uncertain: true }; }
}
