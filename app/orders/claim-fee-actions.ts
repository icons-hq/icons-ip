'use server';
import { unstable_rethrow } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { parseGoodsGroupIdentity } from '@/lib/admin/goods-groups';
import { transactionInteger } from '@/lib/goods-transaction-values';
import { isUuid } from '@/lib/uuid';
import { claimFeeError, normalizeClaimFeeValues, parseClaimFeeDocument } from '@/lib/orders/claim-fees';
export async function readOrderClaimFeesAction(orderId: unknown, rawIdentity: unknown) {
 const identity = parseGoodsGroupIdentity(rawIdentity);
 if (!identity || !isUuid(orderId)) return { error: claimFeeError('22023') };
 try {
  const { data, error } = await (await createClient()).rpc('get_my_order_claim_fees', { p_order: orderId, p_actor: identity.actorId, p_session: identity.sessionId });
  const documents = !error && Array.isArray(data) ? data.map(parseClaimFeeDocument) : null;
  if (!documents || documents.some(d => !d || d.orderId !== orderId || d.policy !== null)) return { error: claimFeeError(error?.code, error?.message) };
  return { documents: documents.filter((d): d is NonNullable<typeof d> => d !== null) };
 } catch (error) { unstable_rethrow(error); return { error: claimFeeError() }; }
}
export async function readClaimFeesAction(claimId: unknown, rawIdentity: unknown, operator: boolean) {
 const identity = parseGoodsGroupIdentity(rawIdentity);
 if (!identity || !isUuid(claimId) || typeof operator !== 'boolean') return { error: claimFeeError('22023') };
 if (operator && !await requireAdminActionAccess('/admin/sales/orders', { capability: 'sales.manage' })) return { error: claimFeeError('42501') };
 try {
  const { data, error } = await (await createClient()).rpc(operator ? 'admin_get_claim_fees' : 'get_my_claim_fees', { p_claim: claimId, p_actor: identity.actorId, p_session: identity.sessionId });
  const document = error ? null : parseClaimFeeDocument(data);
  return document?.claimId === claimId ? { document } : { error: claimFeeError(error?.code, error?.message) };
 } catch (error) { unstable_rethrow(error); return { error: claimFeeError() }; }
}
export async function changeClaimFeeAction(claimId: unknown, invoiceId: unknown, kind: unknown, rawValues: unknown, revision: unknown, claimRevision: unknown, operationId: unknown, rawIdentity: unknown) {
 const identity = parseGoodsGroupIdentity(rawIdentity), values = normalizeClaimFeeValues(kind, rawValues);
 if (!identity || !values || !isUuid(claimId) || !isUuid(operationId) || (kind === 'issue' ? invoiceId !== null : !isUuid(invoiceId)) || !transactionInteger(revision, 0) || !transactionInteger(claimRevision, 0)) return { error: claimFeeError('22023') };
 if (kind !== 'report_payment') {
  const auth = await requireAdminActionAccess('/admin/sales/orders', { capability: 'sales.manage' });
  if (!auth || auth.user.id !== identity.actorId) return { error: claimFeeError('42501') };
 }
 try {
  const client = await createClient();
  const args = { p_claim: claimId, p_invoice: invoiceId, p_revision: revision, p_claim_revision: claimRevision, p_operation: operationId, p_actor: identity.actorId, p_session: identity.sessionId };
  const { data, error } = await client.rpc(kind === 'report_payment' ? 'report_my_claim_fee_payment' : 'admin_change_claim_fee', kind === 'report_payment' ? args : { ...args, p_kind: kind, p_values: values });
  const document = error ? null : parseClaimFeeDocument(data);
  if (!document || document.claimId !== claimId) return { error: claimFeeError(error?.code, error?.message), uncertain: !error || !['22023', 'PT409', '42501', 'P0002'].includes(error.code) };
  // A replay acknowledges the original command. Render current state, since a
  // later claim change may already have canceled the invoice or opened a refund.
  const current = await client.rpc(kind === 'report_payment' ? 'get_my_claim_fees' : 'admin_get_claim_fees', { p_claim: claimId, p_actor: identity.actorId, p_session: identity.sessionId });
  const latest = current.error ? null : parseClaimFeeDocument(current.data);
  if (!latest || latest.claimId !== claimId || latest.orderId !== document.orderId) return { error: '저장은 확인했지만 최신 청구 상태를 읽지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true };
  revalidatePath('/admin/sales/claims', 'layout'); revalidatePath(`/orders/${latest.orderId}`); return { document: latest };
 } catch (error) { unstable_rethrow(error); return { error: claimFeeError(), uncertain: true }; }
}
