import type { SettledExportSnapshot } from '@/lib/admin/settled-export';

/** Synthetic transaction, deliberately includes leading zeroes and formula text. */
export function settledExportFixture(): SettledExportSnapshot {
  const shipmentA = '00000000-0000-4000-8000-000000004951';
  const shipmentB = '00000000-0000-4000-8000-000000004952';
  return {
    schemaVersion: 1, receiptId: '10000000-0000-4000-8000-000000004951', capturedAt: '2026-09-10T02:03:04.000Z',
    filters: { from: '2026-09-01', to: '2026-09-09', query: '합성 검증' },
    orders: [{
      id: '00000000-0000-4000-8000-000000009951', createdAt: '2026-09-01T00:00:00.000Z', doneAt: '2026-09-10T00:00:00.000Z',
      total: 32001, shippingFee: 5000, couponDiscount: 1001, storeCredits: 1000,
      coupon: { code: '000COUPON', discountAmount: 1001, eligibleSubtotal: 20002, terms: { goodsScope: 'selected_goods', targetGoodIds: ['good-a', 'good-b'] } },
      shipments: [
        { id: shipmentA, trackingNumber: '000012345678', shippingFee: 3000, status: 'delivered' },
        { id: shipmentB, trackingNumber: '000087654321', shippingFee: 2000, status: 'delivered' },
      ],
      payments: [{ id: '30000000-0000-4000-8000-000000004951', amount: 32001, status: 'paid', provider: 'toss', approvedAt: '2026-09-02T01:02:03.000Z', timeSource: 'provider_approval' }],
      items: ['a', 'b', 'c'].map((key, index) => ({
        id: `20000000-0000-4000-8000-00000000495${index + 1}`, goodId: `good-${key}`, variantId: `40000000-0000-4000-8000-00000000495${index + 1}`,
        goodName: `합성 상품 ${key}`, variantName: `합성 옵션 ${key}`, qty: 1, unitPrice: index < 2 ? 10001 : 9000,
        regularUnitPrice: index === 0 ? 10001 : index === 1 ? 12000 : 10000, shipmentId: index < 2 ? shipmentA : shipmentB,
        erpCode: `000495${index + 1}`, erpName: index === 0 ? '=HYPERLINK("https://example.test","합성 ERP")' : `주문 당시 ERP ${key}`,
        barcode: `00000000495${index + 1}`, erpCapturedAt: '2026-09-01T00:00:00.000Z',
      })),
    }],
  };
}
