import { expect, it } from 'vitest';
import { claimWithdrawalReceiptMatches, normalizeClaimWithdrawalRequest, parseClaimWithdrawalContext, parseClaimWithdrawalReceipt } from './claim-withdrawal';
import { withdrawalContextFixture as context, withdrawalReceiptFixture as receipt, withdrawalRequestFixture as request } from './claim-withdrawal.fixture';
import { isOpenOrderClaimStage, ORDER_CLAIM_STAGE_LABELS } from './claims';
it('철회는 별도 종결 단계이고 금액이나 상태 주입을 입력에서 거절한다', () => {
  expect(isOpenOrderClaimStage('withdrawn')).toBe(false); expect(ORDER_CLAIM_STAGE_LABELS.withdrawn).toBe('요청 철회');
  expect(normalizeClaimWithdrawalRequest({ ...request, reason: ` ${request.reason} ` })).toEqual(request);
  for (const value of [{ ...request, total: 0 }, { ...request, revision: -1 }, { ...request, confirmed: false }, { ...request, reason: 'a\nb' }, { ...request, reason: 'a'.repeat(501) }]) expect(normalizeClaimWithdrawalRequest(value)).toBeNull();
});
it('DB의 모든 canonical UUID를 받되 문맥과 actor별 결과가 같아야 확정한다', () => {
  expect(parseClaimWithdrawalContext(context)).toEqual(context); expect(parseClaimWithdrawalReceipt(receipt)).toEqual(receipt);
  expect(parseClaimWithdrawalContext({ ...context, claimId: '01234567-89ab-cdef-0123-456789abcdef' })).not.toBeNull();
  expect(parseClaimWithdrawalContext({ ...context, withdrawal: {} })).toBeNull();
  expect(claimWithdrawalReceiptMatches(receipt, request, true)).toBe(true);
  expect(claimWithdrawalReceiptMatches({ ...receipt, reason: '다른 본문' }, request, true)).toBe(false);
  expect(claimWithdrawalReceiptMatches(receipt, request, false)).toBe(false);
});
