import { expect, it } from 'vitest';
import { claimTypeReceiptMatches, normalizeClaimTypeRequest, parseClaimTypeContext, parseClaimTypeHistory, parseClaimTypeReceipt } from './claim-type-conversion';
import { conversionContext as context, conversionRequest as request, conversionReceipt as receipt } from './claim-type-conversion.fixture';
it('전환할 유형·동의·행버전만 허용하고 금액·취소·부분계좌 입력은 거절한다', () => {
  expect(normalizeClaimTypeRequest(request)).toEqual(request);
  for (const bad of [{ toType: 'cancel' }, { confirmed: false }, { revision: -1 }, { amount: 10 }, { agreement: 'a\nvalid' }, { refundAccount: { bankName: '은행' } }]) expect(normalizeClaimTypeRequest({ ...request, ...bad })).toBeNull();
  const account = { bankName: '합성은행', accountNumber: '1234567890', accountHolder: '합성고객' };
  expect(normalizeClaimTypeRequest({ ...request, refundAccount: account })).toBeNull();
  expect(normalizeClaimTypeRequest({ ...request, toType: 'return', refundAccount: account })?.refundAccount).toEqual(account);
});
it('다른 요청·주문/클레임 이력과 본문이 다른 receipt를 확정하지 않는다', () => {
  expect(parseClaimTypeContext(context)).toEqual(context); expect(parseClaimTypeReceipt(receipt)).toEqual(receipt);
  expect(parseClaimTypeContext({ ...context, history: [{ ...receipt, claimId: receipt.orderId }] })).toBeNull();
  expect(parseClaimTypeHistory([{ ...receipt, fromType: 'exchange' }])).toBeNull();
  for (const delta of [{ revision: 3 }, { agreement: '다른 근거' }, { id: receipt.orderId }, { accountSupplied: true }]) expect(claimTypeReceiptMatches({ ...receipt, ...delta }, request)).toBe(false);
  expect(claimTypeReceiptMatches(receipt, request)).toBe(true);
});
