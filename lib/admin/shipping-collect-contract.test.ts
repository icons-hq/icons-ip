import { expect, it } from 'vitest';
import { SHIPPING_COLLECT_FIELDS, parseShippingCollectDocument, parseShippingCollectPending, parseShippingCollectRequest, parseShippingCollectValues,
  sameShippingCollectDocument, shippingCollectReceiptMatches, type ShippingCollectValues } from './shipping-collect-contract';
const id = '91000000-0000-4000-8000-000000000001', operationId = '91000000-0000-4000-8000-000000000002';
const values = Object.fromEntries(SHIPPING_COLLECT_FIELDS.map(key => [key, `${key} 실제 근거`])) as ShippingCollectValues;
const request = { originId: id, expectedActorId: id, expectedRevision: 0, operationId, status: 'active' as const, values };
const row = { originId: id, revision: 1, versionId: id, status: 'active' as const, values };
it('빈 draft는 허용하지만 활성 수납 계약은 모든 실제 조건이 필요하다', () => {
  const empty = Object.fromEntries(SHIPPING_COLLECT_FIELDS.map(key => [key, '']));
  expect(parseShippingCollectValues(empty, 'draft')).toEqual(empty); expect(parseShippingCollectValues(empty, 'active')).toBeNull();
  expect(parseShippingCollectRequest(request)).toEqual(request);
});
it.each(['collectorName', 'contractReference', 'disputeContact'])('공백·제어문자·길이를 거절한다: %s', field => {
  for (const bad of [' 앞 공백', '뒤 공백 ', '줄\n바꿈', 'x'.repeat(501)]) expect(parseShippingCollectValues({ ...values, [field]: bad }, 'active')).toBeNull();
});
it('임의 추가 필드·역전된 revision을 거절한다', () => {
  expect(parseShippingCollectValues({ ...values, secret: 'no' }, 'draft')).toBeNull();
  expect(parseShippingCollectRequest({ ...request, expectedRevision: -1 })).toBeNull();
  expect(parseShippingCollectDocument({ ...row, versionId: null })).toBeNull();
  expect(parseShippingCollectDocument({ ...row, revision: 0, versionId: null })).toBeNull();
});
it('영수증은 원요청과 동일한 정책·버전·작업을 결속하고 키 순서는 무관하다', () => {
  const receipt = { ...row, operationId }; expect(shippingCollectReceiptMatches(receipt, request)).toBe(true);
  expect(shippingCollectReceiptMatches({ ...receipt, revision: 2 }, request)).toBe(false);
  expect(shippingCollectReceiptMatches({ ...receipt, operationId: id }, request)).toBe(false);
  expect(sameShippingCollectDocument(row, { ...row, values: Object.fromEntries(Object.entries(values).reverse()) as ShippingCollectValues })).toBe(true);
});
it('브라우저 복원에는 연락처·계약 본문을 담을 수 없으며 식별자만 허용한다', () => {
  const pending = { version: 1, sessionId: id, originId: id, operationId };
  expect(parseShippingCollectPending(pending)).toEqual(pending);
  expect(parseShippingCollectPending({ ...pending, values })).toBeNull();
  expect(parseShippingCollectPending({ ...pending, sessionId: 'raw access token' })).toBeNull();
});
