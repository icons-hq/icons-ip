import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ quote: vi.fn() }));
vi.mock('@/lib/fulfillment.server', () => ({ loadGoodsShippingQuote: mocks.quote }));
import { quoteGoodsShippingAction } from './shipping-actions';
beforeEach(() => vi.resetAllMocks());
describe('public shipping quote boundary', () => {
  it('sends identifiers and quantity only, preserving option identity', async () => {
    const variantId = '00000000-0000-4000-8000-000000000001';
    mocks.quote.mockResolvedValue({ totalFee: 0, groups: [] });
    expect(await quoteGoodsShippingAction([{ goodId: 'g1', variantId, qty: 2, price: 0, shippingFee: 0 }])).toEqual({ ok: true, quote: { totalFee: 0, groups: [] } });
    expect(mocks.quote).toHaveBeenCalledWith([{ goodId: 'g1', variantId, qty: 2 }]);
  });
  it('avoids querying empty or invalid carts and does not claim free shipping on lookup failure', async () => {
    expect(await quoteGoodsShippingAction([])).toEqual({ ok: true, quote: { totalFee: 0, groups: [] } });
    expect(await quoteGoodsShippingAction([{ goodId: 'g1', qty: 0 }])).toMatchObject({ ok: false });
    expect(mocks.quote).not.toHaveBeenCalled();
    mocks.quote.mockResolvedValue(null);
    expect(await quoteGoodsShippingAction([{ goodId: 'g1', qty: 1 }])).toMatchObject({ ok: false });
    mocks.quote.mockRejectedValue(new Error('database down'));
    expect(await quoteGoodsShippingAction([{ goodId: 'g1', qty: 1 }])).toMatchObject({ ok: false });
  });
});
