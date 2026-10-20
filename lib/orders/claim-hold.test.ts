import { expect, it } from 'vitest';
import { claimHoldReceiptMatches, normalizeClaimHoldRequest, parseClaimHoldContext, parseClaimHoldReceipt } from './claim-hold';
import { holdContext as context, holdReceipt as receipt, holdRequest as request } from './claim-hold.fixture';

it('보류·해제 이외의 작업이나 금융 필드를 받지 않고 계정·유형·버전을 결속한다', () => {
  expect(normalizeClaimHoldRequest(request)).toEqual(request);
  for (const change of [{ revision: -1 }, { revision: 1.2 }, { claimType: 'refund' }, { actorId: 'invalid' },
    { confirmed: false }, { decision: 'approve' }, { amount: 1000 }, { note: '짧음' }, { note: '합성 보류 사유\n줄바꿈은 불가합니다' }]) {
    expect(normalizeClaimHoldRequest({ ...request, ...change })).toBeNull();
  }
  expect(normalizeClaimHoldRequest({ ...request, decision: 'resume', note: null })).toMatchObject({ decision: 'resume', note: null });
  expect(normalizeClaimHoldRequest({ ...request, decision: 'resume' })).toBeNull();
});

it('다른 계정·유형·본문·처리결과는 같은 요청의 결과로 채택하지 않는다', () => {
  expect(parseClaimHoldContext(context)).toEqual(context);
  expect(parseClaimHoldReceipt(receipt)).toEqual(receipt);
  expect(parseClaimHoldReceipt({ ...receipt, resultRevision: 2 })).toBeNull();
  expect(parseClaimHoldReceipt({ ...receipt, stage: 'completed' })).toBeNull();
  for (const change of [{ actorId: context.orderId }, { claimType: 'exchange' as const }, { note: '다른 합성 보류 본문을 전달합니다' }, { revision: 3 }]) {
    expect(claimHoldReceiptMatches({ ...receipt, ...change }, request)).toBe(false);
  }
});
