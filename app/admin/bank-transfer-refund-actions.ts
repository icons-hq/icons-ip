'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { normalizeClaimRefundAccountIdentity } from '@/lib/orders/claim-refund-account';
import {
  bankRefundError, bankRefundReceiptMatches, normalizeBankRefundRequest,
  parseBankRefundContext, parseBankRefundReceipt, parseBankRefundRecovery,
  type BankRefundContext, type BankRefundFailure, type BankRefundIdentity, type BankRefundResult,
} from '@/lib/admin/bank-transfer-refund';

async function authorized(identity: BankRefundIdentity) {
  const auth = await requireAdminActionAccess('/admin/sales/claims/cancels', { capability: 'sales.manage', adminOnly: true });
  return Boolean(auth && auth.user.id === identity.actorId);
}
function identityArgs(identity: BankRefundIdentity) {
  return { p_order_id: identity.orderId, p_claim_id: identity.claimId, p_expected_actor_id: identity.actorId, p_expected_session_id: identity.sessionId };
}
function refresh(orderId: string, claimId: string) {
  for (const path of ['/admin/sales/claims/refund-transfers', '/admin/sales/orders', '/admin/sales/dispatch', '/orders', `/admin/sales/orders/${orderId}`, `/orders/${orderId}`]) revalidatePath(path);
  for (const kind of ['cancels', 'returns']) { revalidatePath(`/admin/sales/claims/${kind}`); revalidatePath(`/admin/sales/claims/${kind}/${claimId}`); }
  revalidatePath('/gifts', 'layout');
}
export async function loadBankRefundContextAction(input: unknown): Promise<{ context: BankRefundContext } | BankRefundFailure> {
  const identity = normalizeClaimRefundAccountIdentity(input);
  if (!identity) return bankRefundError('22023', 'invalid_bank_refund_operation');
  if (!await authorized(identity)) return bankRefundError('42501');
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_bank_transfer_refund_context', identityArgs(identity));
    if (error) return bankRefundError(error.code, error.message);
    const context = parseBankRefundContext(data);
    if (!context || context.actorId !== identity.actorId || context.orderId !== identity.orderId || context.claimId !== identity.claimId) return { error: '최신 환불 상태를 읽지 못했습니다.' };
    return { context };
  } catch (error) { unstable_rethrow(error); return { error: '최신 환불 상태를 읽지 못했습니다.' }; }
}
export async function recordBankRefundAction(input: unknown): Promise<BankRefundResult> {
  const request = normalizeBankRefundRequest(input);
  if (!request) return bankRefundError('22023', 'invalid_bank_refund_operation');
  if (!await authorized(request)) return bankRefundError('42501');
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_record_bank_transfer_refund', { ...identityArgs(request),
      p_operation_id: request.operationId, p_kind: request.kind, p_expected_revision: request.revision, p_expected_amount: request.amount,
      p_occurred_at: request.occurredAt, p_evidence: request.evidence, p_note: request.note, p_confirmed: request.confirmed });
    if (error) return bankRefundError(error.code, error.message);
    const receipt = parseBankRefundReceipt(data);
    if (!receipt || receipt.state !== 'recorded' || !bankRefundReceiptMatches(receipt, request)) return bankRefundError();
    refresh(receipt.orderId, receipt.claimId);
    return { receipt };
  } catch (error) { unstable_rethrow(error); return bankRefundError(); }
}
export async function readBankRefundAction(input: unknown, seal = false): Promise<BankRefundResult> {
  const request = parseBankRefundRecovery(input);
  if (!request || typeof seal !== 'boolean') return { ...bankRefundError('22023', 'invalid_bank_refund_operation'), uncertain: true };
  if (!await authorized(request)) return bankRefundError('42501');
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_read_bank_transfer_refund', { ...identityArgs(request),
      p_operation_id: request.operationId, p_kind: request.kind, p_expected_revision: request.revision, p_expected_amount: request.amount, p_seal: seal });
    if (error) return { ...bankRefundError(error.code, error.message), uncertain: true };
    if (data === null && !seal) return { receipt: null };
    const receipt = parseBankRefundReceipt(data);
    if (!receipt || !bankRefundReceiptMatches(receipt, request)) return bankRefundError();
    refresh(receipt.orderId, receipt.claimId);
    return { receipt };
  } catch (error) { unstable_rethrow(error); return bankRefundError(); }
}
