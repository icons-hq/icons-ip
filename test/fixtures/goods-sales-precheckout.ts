import type { GoodsSalesPrecheckoutQuote } from '@/lib/goods-sales';

export const goodsSalesPrecheckoutQuote: GoodsSalesPrecheckoutQuote = {
  calculatedAt: '2026-10-15T00:00:00Z', subtotal: 16000, nextChangeAt: '2026-10-16T00:00:00Z',
  lines: [{
    goodId: 'g1', variantId: '00000000-0000-4000-8000-000000000001', qty: 2,
    regularPrice: 10000, effectivePrice: 8000, pricePeriodId: '00000000-0000-4000-8000-000000000002',
    startsAt: '2026-10-14T00:00:00Z', endsAt: '2026-10-16T00:00:00Z', available: true,
    supply: { mode: 'stock', availableQty: 10, policyId: null, policyRevision: null, state: 'stock',
      startsAt: null, endsAt: null, expectedShipDate: null, calculatedAt: '2026-10-15T00:00:00Z', nextChangeAt: null },
  }],
  goods: [{ goodId: 'g1', qty: 2, orderQuantityLimitEnabled: true, minOrderQty: 2, maxOrderQty: 3,
    memberPurchaseLimitEnabled: true, memberLifetimeQtyLimit: 5, memberReservedQty: 1, memberRemainingQty: 4, reason: null }],
  paymentMethods: { card: true, bankTransfer: false },
  shipping: { status: 'checkout_required' },
};
