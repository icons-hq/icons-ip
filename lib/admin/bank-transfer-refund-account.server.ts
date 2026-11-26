import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { recordPiiAccess } from '@/lib/admin/pii-access-log.server';
import { normalizeClaimRefundAccountIdentity } from '@/lib/orders/claim-refund-account';
import { isUuid } from '@/lib/uuid';
import { transactionExactKeys, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { BANK_REFUND_ACCOUNT_FAILED, BANK_REFUND_VIEW_ACCOUNT_LABEL, bankRefundError, parseBankRefundAccountView, type BankRefundAccountView, type BankRefundFailure, type BankRefundIdentity } from './bank-transfer-refund';

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
    if (error) {
      /* 계좌를 읽지 못한 것은 저장 결과와 무관하다 — 이유를 아는 오류만 그대로 보이고 나머지는 문구만 '다시 눌러 달라'로 바꾼다(응답 분류는 그대로). */
      const failure = bankRefundError(error.code === '23505' ? 'PT409' : error.code, error.message);
      return failure.uncertain ? { ...failure, error: BANK_REFUND_ACCOUNT_FAILED } : failure;
    }
    const account = parseBankRefundAccountView(data);
    if (!account || account.viewId !== input.viewId || account.actorId !== identity.actorId || account.orderId !== identity.orderId
      || account.claimId !== identity.claimId || account.revision !== input.revision) return { error: BANK_REFUND_ACCOUNT_FAILED };
    /* 계좌 원문 확인은 개인정보 접속기록(원문 확인)이 남아야 돌려준다. 같은 확인 번호로 다시 열면 DB 열람 영수증은 그대로다. */
    try {
      await recordPiiAccess({ actorId: identity.actorId, action: 'reveal', surface: 'refund_account', path: '/api/admin/bank-transfer-refund-account',
        subjectKind: 'claim', subjectIds: [identity.claimId], detail: { viewId: input.viewId } });
    } catch { return { error: `개인정보 접속기록을 남기지 못해 계좌정보를 보여 주지 않았습니다. 잠시 뒤 [${BANK_REFUND_VIEW_ACCOUNT_LABEL}]를 다시 눌러주세요.` }; }
    return { account };
  } catch (error) { unstable_rethrow(error); return { error: BANK_REFUND_ACCOUNT_FAILED }; }
}
