'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { recordClaimDefectiveStock } from '@/lib/admin/defective-stock.server';
import { normalizeClaimRefundAccountIdentity } from '@/lib/orders/claim-refund-account';
import {
  BANK_REFUND_LOAD_FAILED, bankRefundError, bankRefundReceiptMatches, normalizeBankRefundRequest,
  parseBankRefundContext, parseBankRefundReceipt, parseBankRefundRecovery,
  type BankRefundContext, type BankRefundFailure, type BankRefundReceipt, type BankRefundIdentity, type BankRefundResult,
} from '@/lib/admin/bank-transfer-refund';

async function authorized(identity: BankRefundIdentity) {
  const auth = await requireAdminActionAccess('/admin/sales/claims/cancels', { capability: 'sales.manage', adminOnly: true });
  return Boolean(auth && auth.user.id === identity.actorId);
}
function identityArgs(identity: BankRefundIdentity) {
  return { p_order_id: identity.orderId, p_claim_id: identity.claimId, p_expected_actor_id: identity.actorId, p_expected_session_id: identity.sessionId };
}
/* 반품 불량 재고(QNA-035): [취소 확정]에서 finalizer가 재고를 정한 직후 선택을 원장에 기록한다. 송금 완료·복구 읽기에서도 멱등으로
   다시 부른다. 실패해도 영수증 성공은 유지하고 경고만 붙인다. 'use server' 파일에서 export하지 않는 지역 함수다. */
async function defectiveNotice(receipt: BankRefundReceipt): Promise<string | undefined> {
  if (receipt.state !== 'recorded' || (receipt.kind !== 'confirm_cancellation' && receipt.kind !== 'complete_transfer')) return undefined;
  const recorded = await recordClaimDefectiveStock(receipt.claimId);
  return recorded.error ? `환불 처리는 기록됐습니다. ${recorded.error}` : undefined;
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
    if (error) {
      /* 읽기 실패에는 '저장됐는지 확인' 안내가 맞지 않는다 — 권한·단계처럼 이유를 아는 오류만 그대로 보이고 나머지는 문구만 '다시 불러오라'로 바꾼다(응답 분류는 그대로). */
      const failure = bankRefundError(error.code, error.message);
      return failure.uncertain ? { ...failure, error: BANK_REFUND_LOAD_FAILED } : failure;
    }
    const context = parseBankRefundContext(data);
    if (!context || context.actorId !== identity.actorId || context.orderId !== identity.orderId || context.claimId !== identity.claimId) return { error: BANK_REFUND_LOAD_FAILED };
    return { context };
  } catch (error) { unstable_rethrow(error); return { error: BANK_REFUND_LOAD_FAILED }; }
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
    const notice = await defectiveNotice(receipt);
    refresh(receipt.orderId, receipt.claimId);
    return notice ? { receipt, notice } : { receipt };
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
    const notice = await defectiveNotice(receipt);
    refresh(receipt.orderId, receipt.claimId);
    return notice ? { receipt, notice } : { receipt };
  } catch (error) { unstable_rethrow(error); return bankRefundError(); }
}
