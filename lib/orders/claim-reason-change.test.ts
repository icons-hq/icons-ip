import { expect, it } from 'vitest';
import { claimReasonReceiptMatches, normalizeClaimReasonRequest, parseClaimReasonContext, parseClaimReasonHistory, parseClaimReasonReceipt } from './claim-reason-change';
import { reasonContext as context, reasonReceipt as receipt, reasonRequest as request } from './claim-reason-change.fixture';
it('최초 actor·행 버전·분류·고객 설명·협의·비용 확인만 받는다', () => {
  expect(normalizeClaimReasonRequest(request)).toEqual(request);
  for (const bad of [{ actorId: '' }, { revision: -1 }, { reasonType: 'seller_fault' }, { reason: '' }, { reason: 'x'.repeat(201) }, { agreement: 'x' }, { agreement: 'x'.repeat(501) }, { reason: '설명\n추가' }, { agreement: '협의\t내용' }, { confirmed: false }, { feeReviewed: null }, { amount: 1000 }]) {
    expect(normalizeClaimReasonRequest({ ...request, ...bad })).toBeNull();
  }
  expect(normalizeClaimReasonRequest({ ...request, reason: 'x'.repeat(200), agreement: 'x'.repeat(500) })).not.toBeNull();
  expect(normalizeClaimReasonRequest({ ...request, reason: ' 정정 설명 ', agreement: ' 협의 근거 ' })).toMatchObject({ reason: '정정 설명', agreement: '협의 근거' });
});
it('고객 이력에서 내부 협의와 운영자 식별자를 명시적으로 제외한다', () => {
  const parsed = parseClaimReasonHistory([receipt])!;
  expect(parsed[0]).toMatchObject({ fromReason: context.reason, toReason: request.reason, requestedAt: context.requestedAt });
  expect(parsed[0]).not.toHaveProperty('agreement'); expect(parsed[0]).not.toHaveProperty('actorId'); expect(parsed[0]).not.toHaveProperty('feeReviewed');
});
it('다른 클레임 문맥과 손상된 revision·무변경 결과를 거부한다', () => {
  expect(parseClaimReasonContext(context)).toEqual(context); expect(parseClaimReasonReceipt(receipt)).toEqual(receipt);
  expect(parseClaimReasonContext({ ...context, history: [{ ...receipt, claimId: context.orderId }] })).toBeNull();
  expect(parseClaimReasonReceipt({ ...receipt, resultRevision: receipt.revision + 2 })).toBeNull();
  expect(parseClaimReasonReceipt({ ...receipt, changed: false })).toBeNull();
  expect(parseClaimReasonReceipt({ ...receipt, fromReasonType: receipt.toReasonType, fromReason: receipt.toReason, changed: false, resultRevision: receipt.revision })).not.toBeNull();
  for (const delta of [{ actorId: context.orderId }, { agreement: '다른 내부 근거' }, { feeReviewed: true }, { toReason: '다른 설명' }, { revision: 99 }]) expect(claimReasonReceiptMatches({ ...receipt, ...delta }, request)).toBe(false);
  expect(claimReasonReceiptMatches(receipt, request)).toBe(true);
});

it('DB char_length와 같은 코드포인트로 비BMP 사유·협의의 200/500자 경계를 검사한다', () => {
  const emoji = '😀';
  const full = { ...request, reason: emoji.repeat(200), agreement: emoji.repeat(500) };
  expect(normalizeClaimReasonRequest(full)).toEqual(full);
  expect(normalizeClaimReasonRequest({ ...full, reason: emoji.repeat(201) })).toBeNull();
  expect(normalizeClaimReasonRequest({ ...full, agreement: emoji.repeat(501) })).toBeNull();
  const saved = { ...receipt, fromReason: emoji.repeat(200), toReason: emoji.repeat(199), agreement: emoji.repeat(500) };
  expect(parseClaimReasonHistory([saved])).not.toBeNull();
  expect(parseClaimReasonReceipt(saved)).not.toBeNull();
  expect(parseClaimReasonContext({ ...context, reason: emoji.repeat(200), originalReason: emoji.repeat(200), history: [saved] })).not.toBeNull();
});
