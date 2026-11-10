import { transactionExactKeys, transactionRecord } from '@/lib/goods-transaction-values';
import { bankRefundError, parseBankRefundAccountView, type BankRefundAccountView, type BankRefundFailure, type BankRefundIdentity } from './bank-transfer-refund';

export async function requestBankRefundAccount(input: BankRefundIdentity & { revision: number; viewId: string }): Promise<{ account: BankRefundAccountView } | BankRefundFailure> {
  const response = await fetch('/api/admin/bank-transfer-refund-account', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  // A redirect or missing cache protection is not an acceptable raw-data response.
  if (response.redirected || !response.headers.get('cache-control')?.split(',').some(value => value.trim().toLowerCase() === 'no-store')) {
    return { error: '환불계좌를 안전하게 확인하지 못했습니다. 다시 시도해주세요.' };
  }
  if (!response.ok) return response.status === 403 || response.status === 401 ? bankRefundError('42501')
    : response.status === 409 ? bankRefundError('PT409') : { error: '현재 요청에서는 환불계좌를 확인할 수 없습니다. 최신 상태를 확인해주세요.' };
  const payload: unknown = await response.json();
  const account = transactionRecord(payload) && transactionExactKeys(payload, ['account']) ? parseBankRefundAccountView(payload.account) : null;
  if (!account || account.viewId !== input.viewId || account.actorId !== input.actorId || account.orderId !== input.orderId
    || account.claimId !== input.claimId || account.revision !== input.revision) return { error: '감사 기록이 확인된 계좌정보를 받지 못했습니다. 다시 확인해주세요.' };
  return { account };
}
