'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import {
  ADMIN_CLAIM_BULK_CONVERT_ITEM_RESERVE_MS,
  adminClaimBulkConversionTarget,
  adminClaimBulkSummary,
  normalizeAdminClaimBulkConversionForm,
  runAdminClaimBulkSequentially,
  type AdminClaimBulkState,
} from '@/lib/admin/claim-bulk';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { CLAIM_TYPE_DEFINITE_ERROR_CODES, claimTypeBulkError, claimTypeError, claimTypeReceiptMatches, normalizeClaimTypeRequest, parseClaimTypeContext, parseClaimTypeReceipt, type ClaimTypeResult } from '@/lib/orders/claim-type-conversion';
import { ORDER_CLAIM_TYPE_LABELS, orderClaimReferenceLabel } from '@/lib/orders/claims';
const access = () => requireAdminActionAccess('/admin/sales/claims/returns', { capability: 'sales.manage' });
function revalidateConversion(orderId: string) {
  for (const path of ['/admin/sales/claims', '/admin/sales/orders', `/admin/sales/orders/${orderId}`, `/orders/${orderId}`]) revalidatePath(path, path === '/admin/sales/claims' ? 'layout' : 'page');
}
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
    if (error) return { error: claimTypeError(error.code, error.message), conflict: error.code === 'PT409', uncertain: !CLAIM_TYPE_DEFINITE_ERROR_CODES.includes(error.code ?? '') };
    const receipt = parseClaimTypeReceipt(data);
    if (!receipt || !claimTypeReceiptMatches(receipt, request)) return { error: '저장 결과가 불확실합니다. 같은 요청을 확인해주세요.', uncertain: true };
    revalidateConversion(receipt.orderId);
    return { receipt };
  } catch (error) { unstable_rethrow(error); return { error: '저장 결과가 불확실합니다. 같은 요청을 확인해주세요.', uncertain: true }; }
}

/**
 * 목록에서 고른 반품·교환 요청을 한 건씩 전환한다(10/27 회의 14:52 · MD-0032·0033).
 *
 * 규칙은 단건 전환과 한 벌이다. 건마다 최신 요청(버전·차단 사유)을 읽고 같은 RPC에 고객 합의 근거를
 * 보낸다. 환불계좌를 새로 받아야 하는 무통장 건은 저장하지 않고 결과표로 돌려 상세에서 입력하게 한다.
 * 건을 시작할 때 현재 유형을 다시 보므로, 응답을 잃고 다시 실행해도 이미 전환된 요청은 되돌리지 않는다.
 */
export async function bulkConvertClaimTypesAction(_state: AdminClaimBulkState, formData: FormData): Promise<AdminClaimBulkState> {
  const startedAt = Date.now();
  if (!await access()) return { error: claimTypeError('42501') };
  const normalized = normalizeAdminClaimBulkConversionForm(formData);
  if (!normalized.ok) return { error: normalized.error };
  const { agreement, claimIds, fromType } = normalized.value;
  const toType = adminClaimBulkConversionTarget(fromType);

  const client = await createClient();
  const { data: rows, error: readError } = await client.from('order_cancellation_requests').select('id,reference').in('id', claimIds);
  if (readError || !Array.isArray(rows)) return { error: '선택한 요청을 읽지 못했습니다. 새로고침한 뒤 다시 실행해주세요.' };
  const references = new Map(rows.map((row) => [String(row.id).toLowerCase(), Number(row.reference)]));
  const referenceOf = (id: string) => {
    const reference = references.get(id);
    return reference !== undefined && Number.isSafeInteger(reference) && reference > 0 ? orderClaimReferenceLabel(reference) : null;
  };

  const outcomes = await runAdminClaimBulkSequentially(claimIds, async (claimId) => {
    if (!references.has(claimId)) return { ok: false, message: claimTypeError(undefined, 'claim_not_found') };
    const loaded = await client.rpc('admin_order_claim_type_change_context', { p_claim_id: claimId });
    const context = parseClaimTypeContext(loaded.data);
    if (loaded.error || context?.claimId !== claimId) return { ok: false, message: '요청을 다시 읽지 못했습니다. 최신 상태를 확인해주세요.' };
    if (context.claimType !== fromType) return { ok: false, message: `${ORDER_CLAIM_TYPE_LABELS[fromType]} 요청이 아닙니다. 해당 목록에서 처리해주세요.` };
    if (!context.allowed) return { ok: false, message: claimTypeError(undefined, context.blocker ?? '') };
    if (toType === 'return' && context.bankRequired && !context.savedAccount) return { ok: false, message: claimTypeBulkError(undefined, 'claim_conversion_account_required') };

    const request = normalizeClaimTypeRequest({ id: crypto.randomUUID(), claimId, revision: context.revision, toType, agreement, confirmed: true, refundAccount: null });
    if (!request) return { ok: false, message: claimTypeError(undefined, 'invalid_claim_conversion') };
    const { data, error } = await client.rpc('admin_convert_order_claim_type', {
      p_claim_id: request.claimId, p_operation_id: request.id, p_expected_revision: request.revision, p_to_type: request.toType,
      p_agreement: request.agreement, p_confirmed: true, p_refund_account: null,
    });
    if (error) return { ok: false, message: claimTypeBulkError(error.code, error.message) };
    const receipt = parseClaimTypeReceipt(data);
    if (!receipt || !claimTypeReceiptMatches(receipt, request)) return { ok: false, message: claimTypeBulkError() };
    revalidateConversion(receipt.orderId);
    return { ok: true, message: `${ORDER_CLAIM_TYPE_LABELS[toType]} 요청으로 전환했습니다.` };
  }, { startedAt, reserveMs: ADMIN_CLAIM_BULK_CONVERT_ITEM_RESERVE_MS });

  return {
    summary: adminClaimBulkSummary(outcomes.map((outcome) => outcome.outcome)),
    results: outcomes.map(({ item, outcome, message }) => ({ claimId: item, reference: referenceOf(item), outcome, message })),
  };
}
