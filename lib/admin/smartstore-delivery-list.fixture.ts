import type { SmartStoreDeliveryLine } from './smartstore-delivery-list';

export function smartStoreDeliveryLine(overrides: Partial<SmartStoreDeliveryLine> = {}): SmartStoreDeliveryLine {
  return {
    shipmentId: '60000000-0000-4000-8000-000000000003', itemId: '60000000-0000-4000-8000-000000000002', orderId: '60000000-0000-4000-8000-000000000001',
    shipmentUpdatedAt: '2026-10-21T00:00:00Z', orderNumber: '2026102110000001', productOrderNumber: '2026102120000001', shipmentNumber: '2026102130000001',
    status: 'shipping', deliveryMethod: 'parcel', shippedAt: '2026-10-20T15:01:00Z', deliveredAt: null, paidAt: '2026-10-20T15:00:00Z',
    carrier: '한진택배', trackingNumber: '001234567890', buyerName: '합성 구매자', buyerId: 'synthetic-buyer', buyerPhone: null,
    recipientName: '합성 수취인', phone: '01000000000', address: '합성 기본주소 합성 상세주소', postalCode: '00123',
    goodId: 'synthetic-good', goodCode: '000123', goodName: '=합성 상품', variantName: '빨강', customInputs: null, qty: 2,
    productPrice: null, optionPrice: null, itemDiscount: 1000, sellerDiscount: 1000, itemTotal: 19000,
    shippingFee: 3000, shippingCollectFee: 0, regionalShippingFee: 0, shippingDiscount: 0, ...overrides,
  };
}
