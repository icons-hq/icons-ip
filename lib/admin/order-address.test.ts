import { describe, expect, it } from 'vitest';
import { normalizeOrderAddressRequest, orderAddressReceiptMatches, parseOrderAddressContext, parseOrderAddressReceipt } from './order-address';
import { orderAddressContextFixture as context, orderAddressReceiptFixture as receipt, orderAddressRequestFixture as request } from './order-address.fixture';
describe('배송지 수정 계약', () => {
  it('Postgres UUID·주소·연락처를 정규화하되 고객 동의와 변경 근거를 요구한다', () => {
    const parsed = normalizeOrderAddressRequest({ ...request, id: request.id.toUpperCase(), address: { ...request.address, phone: '010-0000-0000' }, reason: ` ${request.reason} ` });
    expect(parsed).toEqual({ request });
    for (const input of [{ ...request, agreed: false }, { ...request, reason: '' }, { ...request, reason: 'x'.repeat(501) }, { ...request, revision: -1 }, { ...request, address: { ...request.address, address1: '주소\n주입' } }]) expect(normalizeOrderAddressRequest(input)).toHaveProperty('error');
  });
  it('과거 주문의 빠진 선택 필드는 읽고 손상된 이력·버전·주소는 거절한다', () => {
    expect(parseOrderAddressContext({ ...context, address: { recipientName: '과거 수령자' } })?.address.phone).toBe('');
    for (const input of [{ ...context, revision: '3' }, { ...context, address: { phone: 123 } }, { ...context, history: [{}] }, { ...context, shipmentCount: -1 }]) expect(parseOrderAddressContext(input)).toBeNull();
  });
  it('저장 결과는 요청번호·주문·사유·여섯 주소 필드가 모두 일치해야 수락한다', () => {
    expect(parseOrderAddressReceipt(receipt)).toEqual(receipt); expect(orderAddressReceiptMatches(receipt, request)).toBe(true);
    expect(orderAddressReceiptMatches({ ...receipt, currentMatches: false }, request)).toBe(true);
    for (const changed of [{ ...receipt, reason: '다른 근거' }, { ...receipt, id: context.orderId }, { ...receipt, address: { ...receipt.address, deliveryNote: '다른 메모' } }]) expect(orderAddressReceiptMatches(changed, request)).toBe(false);
    expect(parseOrderAddressReceipt({ ...receipt, address: {} })).toBeNull();
  });
});
