import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { normalizeClaimRefundAccountIdentity } from '@/lib/orders/claim-refund-account';
import { isUuid } from '@/lib/uuid';
import { transactionExactKeys, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { bankRefundError, parseBankRefundAccountView, type BankRefundAccountView, type BankRefundFailure, type BankRefundIdentity } from './bank-transfer-refund';

async function authorized(identity: BankRefundIdentity) {
  const auth = await requireAdminActionAccess('/admin/sales/claims/cancels', { capability: 'sales.manage', adminOnly: true });
  return Boolean(auth && auth.user.id === identity.actorId);
}
function identityArgs(identity: BankRefundIdentity) {
  return { p_order_id: identity.orderId, p_claim_id: identity.claimId, p_expected_actor_id: identity.actorId, p_expected_session_id: identity.sessionId };
}
/** Only the private, no-store POST route may deliver this audited, session-bound view. */
export async function viewBankRefundAccount(input: unknown): Promise<{ account: BankRefundAccountView } | BankRefundFailure> {
  const identity = normalizeClaimRefundAccountIdentity(input);
  if (!identity || !transactionRecord(input) || !transactionExactKeys(input, ['actorId', 'sessionId', 'orderId', 'claimId', 'viewId', 'revision'])
    || !isUuid(input.viewId) || !transactionInteger(input.revision)) return bankRefundError('22023', 'invalid_bank_refund_operation');
  if (!await authorized(identity)) return bankRefundError('42501');
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_view_bank_transfer_refund_account', { ...identityArgs(identity), p_view_id: input.viewId, p_expected_revision: input.revision });
    if (error) return bankRefundError(error.code === '23505' ? 'PT409' : error.code, error.message);
    const account = parseBankRefundAccountView(data);
    if (!account || account.viewId !== input.viewId || account.actorId !== identity.actorId || account.orderId !== identity.orderId
      || account.claimId !== identity.claimId || account.revision !== input.revision) return { error: '감사 기록이 확인된 계좌정보를 받지 못했습니다. 다시 확인해주세요.' };
    return { account };
  } catch (error) { unstable_rethrow(error); return { error: '환불계좌를 확인하지 못했습니다. 다시 확인해주세요.' }; }
}
