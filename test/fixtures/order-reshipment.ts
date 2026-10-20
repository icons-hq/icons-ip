import type { OrderReshipmentReceipt } from '@/lib/orders/reshipment-items';

export const orderReshipmentReceipt: OrderReshipmentReceipt = {
  claimId: '93942000-0000-4000-8000-000000000011',
  reshippedAt: '2026-10-14T04:00:00.000Z',
  items: [{
    orderItemId: '93942000-0000-4000-8000-000000000013',
    goodId: 'replacement-blue',
    name: '교환 출고 파랑 상품',
    variantId: '93942000-0000-4000-8000-000000000014',
    variantName: '기본',
    variantCode: 'REPLACEMENT-BLUE',
    qty: 2,
  }],
};
