'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { getCurrentAuthState } from '@/lib/auth/server';
import { createClient } from '@/lib/supabase/server';
import { retryVirtualAccountRefund } from '@/lib/orders/virtual-account-refund-retry.server';
import { claimRefundAccountError, claimRefundAccountReceiptMatches, normalizeClaimRefundAccountIdentity, normalizeClaimRefundAccountRequest,
  parseClaimRefundAccountContext, parseClaimRefundAccountReceipt, parseClaimRefundAccountRecovery,
  type ClaimRefundAccountContext, type ClaimRefundAccountFailure, type ClaimRefundAccountIdentity, type ClaimRefundAccountResult,
  type ClaimRefundAccountRetry } from '@/lib/orders/claim-refund-account';

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
    // 입금된 가상계좌 취소가 계좌 때문에 멈춰 있었다면 이 계좌로 환불을 다시 시도한다(그 밖의 주문은 DB가 대상 아님으로 돌려준다).
    const refundRetry = await retryVirtualAccountRefund(request.claimId);
    refreshSurfaces(request.orderId, request.claimId);
    return { receipt, refundRetry };
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
    if (receipt.state !== 'saved') return { receipt };
    // 저장 응답을 받지 못했던 요청 — 저장이 확인됐으면 저장 직후와 같이 환불 재시도를 건다(이미 처리 중이면 대상 아님).
    const refundRetry = await retryVirtualAccountRefund(request.claimId);
    refreshSurfaces(request.orderId, request.claimId);
    return { receipt, refundRetry };
  } catch (error) { unstable_rethrow(error); return claimRefundAccountError(); }
}
/**
 * 가상계좌 환불 다시 요청 — 계좌는 이미 등록됐는데 환불이 계좌 때문에 결제확인필요로 남은 경우(저장 직후 재시도가 실패했거나 결제 화면에서
 * 입력한 계좌를 그대로 쓰려는 경우). 본인·세션 확인은 문맥 조회가 하고, 대상 판정은 DB가 잠금 아래 다시 한다.
 */
export async function retryVirtualAccountRefundAction(input: unknown): Promise<{ refundRetry: ClaimRefundAccountRetry } | ClaimRefundAccountFailure> {
  const identity = normalizeClaimRefundAccountIdentity(input);
  if (!identity) return claimRefundAccountError('22023', 'invalid_claim_refund_account');
  if (!await authenticate(identity)) return claimRefundAccountError('42501');
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('get_my_order_claim_refund_account_context', identityArgs(identity));
    if (error) return claimRefundAccountError(error.code, error.message);
    const context = parseClaimRefundAccountContext(data);
    if (!context || context.actorId !== identity.actorId || context.orderId !== identity.orderId || context.claimId !== identity.claimId) {
      return { error: '최신 요청 상태를 읽지 못했습니다. 다시 확인해주세요.' };
    }
    if (context.mode !== 'virtual_account' || !context.refundAccountIssue || (!context.maskedAccount && !context.checkoutAccount)) {
      return { error: '지금은 환불을 다시 요청할 수 없어요. 환급 계좌를 먼저 입력해주세요.' };
    }
    const refundRetry = await retryVirtualAccountRefund(identity.claimId);
    refreshSurfaces(identity.orderId, identity.claimId);
    return { refundRetry };
  } catch (error) { unstable_rethrow(error); return { error: '환불 요청 결과를 확인하지 못했습니다. 잠시 뒤 다시 확인해주세요.' }; }
}
