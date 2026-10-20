'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { getCurrentAuthState } from '@/lib/auth/server';
import { createClient } from '@/lib/supabase/server';
import { claimRefundAccountError, claimRefundAccountReceiptMatches, normalizeClaimRefundAccountIdentity, normalizeClaimRefundAccountRequest,
  parseClaimRefundAccountContext, parseClaimRefundAccountReceipt, parseClaimRefundAccountRecovery,
  type ClaimRefundAccountContext, type ClaimRefundAccountFailure, type ClaimRefundAccountIdentity, type ClaimRefundAccountResult } from '@/lib/orders/claim-refund-account';

async function authenticate(identity: ClaimRefundAccountIdentity) {
  const auth = await getCurrentAuthState();
  return Boolean(auth.user && auth.user.id === identity.actorId);
}
function identityArgs(identity: ClaimRefundAccountIdentity) {
  return { p_order_id: identity.orderId, p_claim_id: identity.claimId, p_expected_actor_id: identity.actorId, p_expected_session_id: identity.sessionId };
}
function refreshSurfaces(orderId: string, claimId: string) {
  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/admin/sales/orders/${orderId}`);
  for (const type of ['cancels', 'returns']) revalidatePath(`/admin/sales/claims/${type}/${claimId}`);
}
export async function loadClaimRefundAccountAction(input: unknown): Promise<{ context: ClaimRefundAccountContext } | ClaimRefundAccountFailure> {
  const identity = normalizeClaimRefundAccountIdentity(input);
  if (!identity) return claimRefundAccountError('22023', 'invalid_claim_refund_account');
  if (!await authenticate(identity)) return claimRefundAccountError('42501');
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('get_my_order_claim_refund_account_context', identityArgs(identity));
    if (error) return claimRefundAccountError(error.code, error.message);
    const context = parseClaimRefundAccountContext(data);
    if (!context || context.actorId !== identity.actorId || context.orderId !== identity.orderId || context.claimId !== identity.claimId) return { error: '최신 요청 상태를 읽지 못했습니다. 다시 확인해주세요.' };
    return { context };
  } catch (error) { unstable_rethrow(error); return { error: '최신 요청 상태를 읽지 못했습니다. 다시 확인해주세요.' }; }
}
export async function saveClaimRefundAccountAction(input: unknown): Promise<ClaimRefundAccountResult> {
  const request = normalizeClaimRefundAccountRequest(input);
  if (!request) return claimRefundAccountError('22023', 'invalid_claim_refund_account');
  if (!await authenticate(request)) return claimRefundAccountError('42501');
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('set_my_order_claim_refund_account', { ...identityArgs(request), p_operation_id: request.operationId,
      p_expected_revision: request.revision, p_bank_name: request.account.bankName, p_account_number: request.account.accountNumber, p_account_holder: request.account.accountHolder });
    if (error) return claimRefundAccountError(error.code, error.message);
    const receipt = parseClaimRefundAccountReceipt(data);
    if (!receipt || receipt.state !== 'saved' || !claimRefundAccountReceiptMatches(receipt, request)) return claimRefundAccountError();
    refreshSurfaces(request.orderId, request.claimId);
    return { receipt };
  } catch (error) { unstable_rethrow(error); return claimRefundAccountError(); }
}
export async function readClaimRefundAccountAction(input: unknown, seal = false): Promise<ClaimRefundAccountResult> {
  const request = parseClaimRefundAccountRecovery(input);
  if (!request || typeof seal !== 'boolean') return { ...claimRefundAccountError('22023', 'invalid_claim_refund_account'), uncertain: true };
  if (!await authenticate(request)) return claimRefundAccountError('42501');
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('read_my_order_claim_refund_account_operation', { ...identityArgs(request), p_operation_id: request.operationId,
      p_expected_revision: request.revision, p_seal: seal });
    if (error) return { ...claimRefundAccountError(error.code, error.message), uncertain: true };
    if (data === null && !seal) return { receipt: null };
    const receipt = parseClaimRefundAccountReceipt(data);
    if (!receipt || !claimRefundAccountReceiptMatches(receipt, request)) return claimRefundAccountError();
    if (receipt.state === 'saved') refreshSurfaces(request.orderId, request.claimId);
    return { receipt };
  } catch (error) { unstable_rethrow(error); return claimRefundAccountError(); }
}
