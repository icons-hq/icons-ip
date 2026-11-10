import { describe, expect, it } from 'vitest';
import { shippingCollectReceipt, shippingCollectRequest } from '@/test/fixtures/shipping-collect';
import { parseShippingCollectEventReceipt, parseShippingCollectEventRequest, parseShippingCollectObligations, shippingCollectEventReceiptMatches } from './shipping-collect-events';
describe('착불 수납 DTO', () => {
  it('원예정금액·기록금액·수납상태를 독립 보존한다', () => {
    const receipt = shippingCollectReceipt();expect(parseShippingCollectEventReceipt(receipt)).toEqual(receipt);
    expect(shippingCollectEventReceiptMatches(receipt, shippingCollectRequest)).toBe(true);
    expect(parseShippingCollectObligations([receipt.obligation], shippingCollectRequest.orderId)).toHaveLength(1);
  });
  it('다른주문·중복배송건·계약비공개필드와 중복event는 거절한다', () => {
    const receipt = shippingCollectReceipt();
    expect(parseShippingCollectObligations([receipt.obligation], shippingCollectRequest.shipmentId)).toBeNull();
    expect(parseShippingCollectObligations([receipt.obligation, receipt.obligation], shippingCollectRequest.orderId)).toBeNull();
    expect(parseShippingCollectEventReceipt({ ...receipt, obligation: { ...receipt.obligation, contractReference: 'private' } })).toBeNull();
    expect(parseShippingCollectEventReceipt({ ...receipt, obligation: { ...receipt.obligation, events: [...receipt.obligation.events, ...receipt.obligation.events] } })).toBeNull();
  });
  it('정수·미래형태·공백·변경된actor입력은 엄격한 request를 통과하지 못한다', () => {
    expect(parseShippingCollectEventRequest(shippingCollectRequest)).toEqual(shippingCollectRequest);
    for (const patch of [{ amount: 0.1 }, { amount: Number.MAX_SAFE_INTEGER + 1 }, { expectedRevision: 0 }, { reference: ' hidden ' }, { note: '' }, { party: '' }, { event: 'correction' }, { reversesOperationId: shippingCollectRequest.orderId },
      { occurredAt: '2026-02-30T01:00:00Z' }, { expectedActorId: 'bad' }, { futureField: true }]) {
      expect(parseShippingCollectEventRequest({ ...shippingCollectRequest, ...patch })).toBeNull();
    }
  });
  it('정정 요청은 반대 기록 대상과 금액을 명시한다', () => {
    const request = { ...shippingCollectRequest, event: 'correction', reversesOperationId: shippingCollectRequest.orderId };
    expect(parseShippingCollectEventRequest(request)).toEqual(request);
  });
  it('같은ms의다른microsecond와다른금액·사유를 동일저장으로 인정하지않는다', () => {
    const receipt = shippingCollectReceipt();
    for (const patch of [{ amount: 2251 }, { note: '다른 내용' }, { party: '다른 운송사' }, { reversesOperationId: shippingCollectRequest.orderId }, { occurredAt: '2026-10-14T01:00:00.123457Z' }, { expectedRevision: 2 }]) {
      expect(shippingCollectEventReceiptMatches(receipt, { ...shippingCollectRequest, ...patch })).toBe(false);
    }
  });
});
