import { expect, it } from 'vitest';
import { SHIPPING_COLLECT_FIELDS, SHIPPING_COLLECT_LABELS, SHIPPING_COLLECT_OFF_CONFIRM, SHIPPING_COLLECT_RUNTIME_OFF, parseShippingCollectDocument, parseShippingCollectPending,
  parseShippingCollectReceipt, parseShippingCollectRequest, parseShippingCollectValues, sameShippingCollectDocument, shippingCollectError, shippingCollectMissingLabels,
  shippingCollectReceiptMatches, shippingCollectRequiredMessage, shippingCollectStatusLabel, type ShippingCollectValues } from './shipping-collect-contract';
const id = '91000000-0000-4000-8000-000000000001', operationId = '91000000-0000-4000-8000-000000000002';
const values = Object.fromEntries(SHIPPING_COLLECT_FIELDS.map(key => [key, `${key} 실제 값`])) as ShippingCollectValues;
const request = { originId: id, expectedActorId: id, expectedRevision: 0, operationId, status: 'active' as const, values };
const row = { originId: id, revision: 1, versionId: id, status: 'active' as const, values };
/* 예전 화면이 저장한 근거 네 칸. 저장된 조건에는 남아 있어 조회 응답에 함께 온다. */
const retired = { contractReference: 'TEST 계약', dispatchMappingReference: 'TEST 표기', receiptReference: '', disputeContact: 'TEST 담당' };
it('착불 조건은 고객에게 보이는 네 칸이다', () => {
  expect(SHIPPING_COLLECT_FIELDS).toEqual(['collectorName', 'collectionMethod', 'refundContact', 'customerInstructions']);
  expect(SHIPPING_COLLECT_FIELDS.map(key => SHIPPING_COLLECT_LABELS[key])).toEqual(['수납 주체', '수납 방법', '환불 문의처', '고객 안내']);
});
it("비어 있어도 '사용 안 함'으로는 저장되지만 '사용'은 네 칸이 모두 필요하다", () => {
  const empty = Object.fromEntries(SHIPPING_COLLECT_FIELDS.map(key => [key, '']));
  expect(parseShippingCollectValues(empty, 'draft')).toEqual(empty); expect(parseShippingCollectValues(empty, 'disabled')).toEqual(empty); expect(parseShippingCollectValues(empty, 'active')).toBeNull();
  expect(parseShippingCollectValues({ ...values, refundContact: '' }, 'active')).toBeNull();
  expect(parseShippingCollectRequest(request)).toEqual(request);
});
it.each(SHIPPING_COLLECT_FIELDS)('앞뒤 빈칸·줄바꿈·너무 긴 글을 거절한다: %s', field => {
  for (const bad of [' 앞 빈칸', '뒤 빈칸 ', '줄\n바꿈', 'x'.repeat(501)]) expect(parseShippingCollectValues({ ...values, [field]: bad }, 'active')).toBeNull();
});
it('모르는 칸·근거 칸이 든 저장 요청과 뒤바뀐 저장 번호를 거절한다', () => {
  expect(parseShippingCollectValues({ ...values, secret: 'no' }, 'draft')).toBeNull();
  expect(parseShippingCollectValues({ ...values, ...retired }, 'draft')).toBeNull();
  expect(parseShippingCollectRequest({ ...request, values: { ...values, contractReference: 'TEST 계약' } })).toBeNull();
  expect(parseShippingCollectRequest({ ...request, expectedRevision: -1 })).toBeNull();
  expect(parseShippingCollectDocument({ ...row, versionId: null })).toBeNull();
  expect(parseShippingCollectDocument({ ...row, revision: 0, versionId: null })).toBeNull();
});
it('저장된 조건에 예전 근거 칸이 남아 있어도 읽고, 화면에는 네 칸만 넘긴다', () => {
  expect(parseShippingCollectDocument({ ...row, values: { ...values, ...retired } })).toEqual(row);
  expect(parseShippingCollectReceipt({ ...row, values: { ...values, ...retired }, operationId })).toEqual({ ...row, operationId });
  /* 근거 칸이 비어 있어도 '사용'인 조건을 읽는다(근거 없이 켠 조건). */
  expect(parseShippingCollectDocument({ ...row, values: { ...values, contractReference: '', dispatchMappingReference: '', receiptReference: '', disputeContact: '' } })).toEqual(row);
  expect(parseShippingCollectDocument({ ...row, values: { ...values, ...retired, disputeContact: 1 } })).toBeNull();
  expect(parseShippingCollectDocument({ ...row, values: { ...values, ...retired, secret: 'no' } })).toBeNull();
  expect(parseShippingCollectDocument({ ...row, values: { ...retired } })).toBeNull();
});
it('저장 결과는 보낸 내용과 같은 조건·저장 번호·작업이어야 하고 칸 순서는 상관없다', () => {
  const receipt = { ...row, operationId }; expect(shippingCollectReceiptMatches(receipt, request)).toBe(true);
  expect(shippingCollectReceiptMatches({ ...receipt, revision: 2 }, request)).toBe(false);
  expect(shippingCollectReceiptMatches({ ...receipt, operationId: id }, request)).toBe(false);
  expect(shippingCollectReceiptMatches({ ...receipt, values: { ...values, refundContact: '다른 문의처' } }, request)).toBe(false);
  expect(sameShippingCollectDocument(row, { ...row, values: Object.fromEntries(Object.entries(values).reverse()) as ShippingCollectValues })).toBe(true);
});
it('브라우저에는 연락처·안내 글을 남길 수 없고 확인할 번호만 남긴다', () => {
  const pending = { version: 1, sessionId: id, originId: id, operationId };
  expect(parseShippingCollectPending(pending)).toEqual(pending);
  expect(parseShippingCollectPending({ ...pending, values })).toBeNull();
  expect(parseShippingCollectPending({ ...pending, sessionId: 'raw access token' })).toBeNull();
});
it("상태 이름은 '사용 / 사용 안 함' 둘이고, 빈 칸은 이름으로 말한다", () => {
  expect((['draft', 'active', 'disabled'] as const).map(shippingCollectStatusLabel)).toEqual(['사용 안 함', '사용', '사용 안 함']);
  expect(shippingCollectMissingLabels({ ...values, collectorName: '  ', customerInstructions: '' })).toEqual(['수납 주체', '고객 안내']);
  expect(shippingCollectRequiredMessage(['수납 주체', '고객 안내'])).toBe("'사용'으로 저장하려면 수납 주체 · 고객 안내 칸을 적어 주세요. 네 칸 모두 고객에게 보입니다.");
});
it('거절 문구는 고칠 방법을 말하고 근거·버전·요청 같은 말을 쓰지 않는다', () => {
  const messages = ['collect_contract_changed', 'invalid_collect_contract', 'fulfillment_origin_not_found', 'auth_context_changed', 'operation_conflict', 'operator_capability_required', undefined]
    .map(code => shippingCollectError(code));
  expect(new Set(messages).size).toBe(7);
  expect(shippingCollectError('collect_contract_changed')).toContain('다른 사람이 먼저 바꿨습니다.');
  expect(shippingCollectError('invalid_collect_contract')).toContain('수납 주체 · 수납 방법 · 환불 문의처 · 고객 안내');
  expect(shippingCollectError('fulfillment_origin_not_found')).toContain("'사용 여부'");
  expect(shippingCollectError('operation_conflict')).toContain('[저장됐는지 확인]');
  for (const shown of [...messages, SHIPPING_COLLECT_RUNTIME_OFF, SHIPPING_COLLECT_OFF_CONFIRM.title, SHIPPING_COLLECT_OFF_CONFIRM.message]) expect(shown).not.toMatch(/근거|버전|요청 번호|요청번호|환급|운영 설정을 확인/);
  expect(SHIPPING_COLLECT_RUNTIME_OFF).toContain('개발 담당자에게 요청해 주세요.');
});
