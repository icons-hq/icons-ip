import { transactionExactKeys, transactionRecord } from '@/lib/goods-transaction-values';
import { bankRefundError, parseBankRefundAccountView, type BankRefundAccountView, type BankRefundFailure, type BankRefundIdentity } from './bank-transfer-refund';

export async function requestBankRefundAccount(input: BankRefundIdentity & { revision: number; viewId: string }): Promise<{ account: BankRefundAccountView } | BankRefundFailure> {
  const response = await fetch('/api/admin/bank-transfer-refund-account', {
    method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
  });
  // A redirect or missing cache protection is not an acceptable raw-data response.
  if (response.redirected || !response.headers.get('cache-control')?.split(',').some(value => value.trim().toLowerCase() === 'no-store')) {
    return { error: '환불계좌를 안전한 방식으로 받지 못해 보여 주지 않았습니다. 새로고침한 뒤 다시 눌러주세요.' };
  }
  if (!response.ok) return response.status === 403 || response.status === 401 ? bankRefundError('42501')
    : response.status === 409 ? bankRefundError('PT409') : { error: '지금 단계에서는 환불계좌를 열 수 없습니다. [최신 환불 상태 확인]을 눌러 상태를 확인해주세요.' };
  const payload: unknown = await response.json();
  const account = transactionRecord(payload) && transactionExactKeys(payload, ['account']) ? parseBankRefundAccountView(payload.account) : null;
  if (!account || account.viewId !== input.viewId || account.actorId !== input.actorId || account.orderId !== input.orderId
    || account.claimId !== input.claimId || account.revision !== input.revision) return { error: '열람 기록이 남은 계좌정보를 받지 못해 보여 주지 않았습니다. 잠시 뒤 다시 눌러주세요.' };
  return { account };
}
