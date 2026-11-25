import { expect, it } from 'vitest';
import { claimReasonConfirmMessage, claimReasonError, claimReasonReceiptMatches, claimReasonReturnFeeNote, claimReasonSavedMessage, normalizeClaimReasonRequest, parseClaimReasonContext, parseClaimReasonHistory, parseClaimReasonReceipt } from './claim-reason-change';
import { reasonContext as context, reasonReceipt as receipt, reasonRequest as request, returnReasonContext, returnReasonReceipt } from './claim-reason-change.fixture';
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

/* CLM-029: 반품도 같은 정정을 쓴다. 반품배송비 차감은 사유로 다시 계산되고, 확인은 저장 순간 확인창 한 번이다. */
it('반품 문맥의 반품배송비 정보와 영수증의 차감 전후를 좁힌다', () => {
  expect(parseClaimReasonContext(returnReasonContext)).toEqual(returnReasonContext);
  expect(parseClaimReasonContext({ ...context, returnFee: undefined })).toEqual(context);
  expect(parseClaimReasonContext({ ...context, returnFee: returnReasonContext.returnFee })).toBeNull();
  expect(parseClaimReasonContext({ ...returnReasonContext, returnFee: { ...returnReasonContext.returnFee, deductionAmount: -1 } })).toBeNull();
  expect(parseClaimReasonContext({ ...returnReasonContext, returnFee: { ...returnReasonContext.returnFee, deductionAmount: null } })).not.toBeNull();
  expect(parseClaimReasonReceipt(returnReasonReceipt)).toEqual(returnReasonReceipt);
  const legacy: Record<string, unknown> = { ...receipt }; delete legacy.claimType; delete legacy.fromReturnFeeDeduction; delete legacy.toReturnFeeDeduction;
  expect(parseClaimReasonReceipt(legacy)).toEqual({ ...receipt, claimType: null, fromReturnFeeDeduction: null, toReturnFeeDeduction: null });
  expect(parseClaimReasonReceipt({ ...returnReasonReceipt, claimType: 'gift' })).toBeNull();
  expect(parseClaimReasonReceipt({ ...returnReasonReceipt, toReturnFeeDeduction: -3000 })).toBeNull();
});
it('반품 확인창은 차감 변화·배송비 청구 취소·기존 비용·고객 알림을 한 번에 말한다', () => {
  const toDefect = claimReasonConfirmMessage(returnReasonContext, { reasonType: 'defect', reason: ' 받은 상품이 깨져 있었어요 ' });
  expect(toDefect).toContain('단순 변심 → 상품 하자·오배송'); expect(toDefect).toContain('고객에게 보일 설명: 받은 상품이 깨져 있었어요');
  expect(toDefect).toContain('반품배송비를 빼지 않습니다(지금 차감 예정 3,000원 → 0원).'); expect(toDefect).toContain('고객에게 앱 알림을 보냅니다');
  const toChange = claimReasonConfirmMessage({ ...returnReasonContext, reasonType: 'defect', returnFee: { ...returnReasonContext.returnFee!, deductionAmount: 0, feeInvoiceOpen: true },
    fee: { kind: 'return_shipping', amount: 3000, note: '기존 협의', confirmedAt: context.requestedAt } }, { reasonType: 'change_of_mind', reason: '정상 상품 확인' });
  expect(toChange).toContain('단순 변심 반품배송비를 환불 금액에서 뺄 수 있습니다'); expect(toChange).toContain('배송비 청구는 사유를 바꾸면 취소됩니다');
  expect(toChange).toContain('기존 운영 확인액 3,000원(기존 협의)은 바뀌지 않습니다');
  /* 교환·같은 분류·설정 꺼짐은 반품배송비 문장을 넣지 않는다. */
  expect(claimReasonConfirmMessage(context, { reasonType: 'defect', reason: '하자' })).not.toContain('반품배송비');
  expect(claimReasonConfirmMessage(returnReasonContext, { reasonType: 'change_of_mind', reason: '설명만 정정' })).not.toContain('반품배송비');
  expect(claimReasonConfirmMessage({ ...returnReasonContext, returnFee: { ...returnReasonContext.returnFee!, enabled: false } }, { reasonType: 'defect', reason: '하자' })).not.toContain('반품배송비');
});
it('반품배송비 안내와 저장 결과 문장', () => {
  expect(claimReasonReturnFeeNote(returnReasonContext)).toContain('지금 사유로는 환불 금액에서 반품배송비 3,000원을 뺍니다.');
  expect(claimReasonReturnFeeNote(returnReasonContext)).toContain('편도 3,000원, 최초 무료배송 주문은 왕복');
  expect(claimReasonReturnFeeNote({ ...returnReasonContext, returnFee: { ...returnReasonContext.returnFee!, deductionAmount: null } })).toContain('환불 접수 때 정해집니다');
  expect(claimReasonReturnFeeNote({ ...returnReasonContext, returnFee: { ...returnReasonContext.returnFee!, enabled: false } })).toContain('설정이 꺼져 있어');
  expect(claimReasonReturnFeeNote(context)).toBeNull();
  expect(claimReasonSavedMessage(returnReasonReceipt)).toBe('반품 사유를 정정하고 고객에게 앱 알림을 남겼습니다. 반품배송비 차감이 3,000원에서 0원으로 바뀌었습니다.');
  expect(claimReasonSavedMessage(receipt)).toBe('교환 사유를 정정하고 고객에게 앱 알림을 남겼습니다.');
  expect(claimReasonSavedMessage({ ...receipt, changed: false })).toContain('고객 알림을 추가하지 않았습니다');
  expect(claimReasonError(undefined, 'claim_reason_finance_started')).toContain('환불 접수');
  expect(claimReasonError(undefined, 'claim_reason_stage_unavailable')).toContain('[환불 접수] 전까지');
});
