import type { OrderAddressContext, OrderAddressReceipt, OrderAddressRequest } from './order-address';
export const orderAddressContextFixture: OrderAddressContext = {
  orderId: 'abcd1234-0000-7000-8000-000000000001', revision: 3, allowed: true, blocker: null, shipmentCount: 2,
  address: { recipientName: '합성 고객', phone: '01000000000', postalCode: '12345', address1: '합성시 검증로 1', address2: '101호', deliveryNote: '' }, history: [],
};
export const orderAddressRequestFixture: OrderAddressRequest = {
  id: 'abcd1234-0000-7000-8000-000000000002', orderId: orderAddressContextFixture.orderId, revision: 3,
  address: { ...orderAddressContextFixture.address, recipientName: '변경 수령자' }, reason: '전화 상담에서 고객 동의 확인', agreed: true,
};
export const orderAddressReceiptFixture: OrderAddressReceipt = {
  id: orderAddressRequestFixture.id, orderId: orderAddressRequestFixture.orderId, address: orderAddressRequestFixture.address,
  reason: orderAddressRequestFixture.reason, changedAt: '2026-10-13T10:00:00.123Z', currentMatches: true,
};
