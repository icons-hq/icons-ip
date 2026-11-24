import { describe, expect, it } from 'vitest';
import { claimRefundAccountReceiptMatches, claimRefundAccountRecoveryKey, claimRefundAccountRequestMetadata, normalizeClaimRefundAccountRequest,
  parseClaimRefundAccountContext, parseClaimRefundAccountReceipt, parseClaimRefundAccountRecovery } from './claim-refund-account';
import { refundAccountIdentity as identity, refundAccountRequest as request, refundAccountContext as context, refundAccountReceipt as receipt,
  virtualAccountRefundContext } from '@/test/fixtures/claim-refund-account';

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
  it('가상계좌 주문은 등록된 계좌를 바꿀 수 있고, 결제 화면 계좌는 가린 형태만 받는다', () => {
    const recorded = { maskedAccount: '신한은행 ********4321', maskedHolder: '김*성', recordedAt: '2026-11-23T05:00:00.000Z' };
    expect(parseClaimRefundAccountContext({ ...virtualAccountRefundContext, ...recorded })).toEqual({ ...virtualAccountRefundContext, ...recorded });
    const checkoutAccount = { bankCode: '88', maskedAccount: '********6789', maskedHolder: '김*스' };
    expect(parseClaimRefundAccountContext({ ...virtualAccountRefundContext, refundAccountIssue: 'invalid', checkoutAccount })?.checkoutAccount)
      .toEqual(checkoutAccount);
    expect(parseClaimRefundAccountContext({ ...virtualAccountRefundContext, checkoutAccount: { bankCode: '신한', maskedAccount: 'x', maskedHolder: 'y' } })).toBeNull();
    // 입력된 계좌를 결제대행사에 그대로 보낼 수 없으면(DB 판정) 바꾸라고 알린다.
    expect(parseClaimRefundAccountContext({ ...virtualAccountRefundContext, ...recorded, refundAccountIssue: 'unusable' })?.refundAccountIssue)
      .toBe('unusable');
    expect(parseClaimRefundAccountContext({ ...virtualAccountRefundContext, refundAccountIssue: 'unknown' })).toBeNull();
    expect(parseClaimRefundAccountContext({ ...virtualAccountRefundContext, mode: 'card' })).toBeNull();
    // 회사 계좌 무통장 문맥에는 가상계좌 전용 값이 실리지 않는다.
    expect(parseClaimRefundAccountContext({ ...context, refundAccountIssue: 'required' })).toBeNull();
    // 예전 서버(모드 없음)는 회사 계좌 무통장으로 읽는다.
    const legacy: Record<string, unknown> = { ...context };
    for (const key of ['mode', 'refundAccountIssue', 'checkoutAccount']) delete legacy[key];
    expect(parseClaimRefundAccountContext(legacy)).toEqual(context);
  });
  it('영수증은 해당 요청의 CAS 버전만 수락하며 봉인 결과를 저장 성공으로 취급하지 않는다', () => {
    expect(claimRefundAccountReceiptMatches(receipt, request)).toBe(true);
    expect(claimRefundAccountReceiptMatches({ ...receipt, claimId: request.operationId }, request)).toBe(false);
    expect(parseClaimRefundAccountReceipt({ ...receipt, resultRevision: 3 })).toBeNull();
    expect(parseClaimRefundAccountReceipt({ ...receipt, state: 'sealed', resultRevision: 1 })?.state).toBe('sealed');
  });
});
