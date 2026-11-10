import { describe, expect, it } from 'vitest';
import { claimRefundAccountReceiptMatches, claimRefundAccountRecoveryKey, claimRefundAccountRequestMetadata, normalizeClaimRefundAccountRequest,
  parseClaimRefundAccountContext, parseClaimRefundAccountReceipt, parseClaimRefundAccountRecovery } from './claim-refund-account';
import { refundAccountIdentity as identity, refundAccountRequest as request, refundAccountContext as context, refundAccountReceipt as receipt } from '@/test/fixtures/claim-refund-account';

describe('일반 주문 환불계좌 보완 계약', () => {
  it('기존 계좌 형식을 재사용하고 제어문자·추가 필드·불완전 정보를 거절한다', () => {
    expect(normalizeClaimRefundAccountRequest(request)).toEqual(request);
    for (const invalid of [{ ...request, unexpected: true }, { ...request, revision: -1 }, { ...request, sessionId: '' },
      { ...request, account: { ...request.account, accountHolder: '합성\n구매자' } }, { ...request, account: { ...request.account, bankName: '' } },
      { ...request, account: { ...request.account, accountNumber: '123' } }, { ...request, account: { ...request.account, accountNumber: '--------' } },
      { ...request, account: { ...request.account, extra: 'raw' } }]) expect(normalizeClaimRefundAccountRequest(invalid)).toBeNull();
  });
  it('복구 데이터에는 계좌 원문을 허용하지 않고 계정·세션·주문·클레임을 결속한다', () => {
    const metadata = claimRefundAccountRequestMetadata(request);
    expect(parseClaimRefundAccountRecovery(metadata, identity)).toEqual(metadata);
    expect(parseClaimRefundAccountRecovery(request, identity)).toBeNull();
    for (const field of ['actorId', 'sessionId', 'orderId', 'claimId'] as const) expect(parseClaimRefundAccountRecovery(metadata, { ...identity, [field]: request.operationId })).toBeNull();
    expect(claimRefundAccountRecoveryKey(identity)).not.toContain(request.account.accountNumber);
  });
  it('서버 문맥과 영수증의 명시적 투영에서 원문·해시·세션을 제거한다', () => {
    const privateData = { accountNumber: request.account.accountNumber, requestHash: 'secret-hash', sessionId: identity.sessionId };
    expect(parseClaimRefundAccountContext({ ...context, ...privateData })).toEqual(context);
    expect(parseClaimRefundAccountReceipt({ ...receipt, ...privateData })).toEqual(receipt);
    expect(parseClaimRefundAccountContext({ ...context, allowed: false })).toBeNull();
    expect(parseClaimRefundAccountContext({ ...context, maskedAccount: '마스킹값' })).toBeNull();
  });
  it('영수증은 해당 요청의 CAS 버전만 수락하며 봉인 결과를 저장 성공으로 취급하지 않는다', () => {
    expect(claimRefundAccountReceiptMatches(receipt, request)).toBe(true);
    expect(claimRefundAccountReceiptMatches({ ...receipt, claimId: request.operationId }, request)).toBe(false);
    expect(parseClaimRefundAccountReceipt({ ...receipt, resultRevision: 3 })).toBeNull();
    expect(parseClaimRefundAccountReceipt({ ...receipt, state: 'sealed', resultRevision: 1 })?.state).toBe('sealed');
  });
});
