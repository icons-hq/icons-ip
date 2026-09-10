import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ quote: vi.fn() }));
vi.mock('@/lib/goods-sales.server', () => ({ loadGoodsSalesQuote: mocks.quote }));
import { quoteGoodsSalesAction } from './sales-actions';
beforeEach(() => vi.resetAllMocks());
describe('public sales quote action', () => {
  it('sends only item identity and quantity to the server price/limit calculation', async () => {
    const variantId = '00000000-0000-4000-8000-000000000001';
    const quote = { subtotal: 16000, paymentMethods: { card: true, bankTransfer: false } };
    mocks.quote.mockResolvedValue(quote);
    expect(await quoteGoodsSalesAction([{ goodId: 'g1', variantId, qty: 2, price: 1, userId: 'someone-else' }]))
      .toEqual({ ok: true, quote });
    expect(mocks.quote).toHaveBeenCalledWith([{ goodId: 'g1', variantId, qty: 2 }], null);
  });
  it('validates an address and forwards only the normalized destination for regional shipping', async () => {
    const items = [{ goodId: 'g1', variantId: '00000000-0000-4000-8000-000000000001', qty: 1 }];
    mocks.quote.mockResolvedValue({ subtotal: 1000 });
    expect(await quoteGoodsSalesAction(items, { postalCode: ' 01234 ', address1: '서울  합성로 1 ', shippingFee: 0 })).toMatchObject({ ok: true });
    expect(mocks.quote).toHaveBeenLastCalledWith(items, { postalCode: '01234', address1: '서울 합성로 1' });
    expect(await quoteGoodsSalesAction(items, { postalCode: '1234', address1: '합성 주소' })).toMatchObject({ ok: false });
    expect(mocks.quote).toHaveBeenCalledTimes(1);
  });
  it('does not turn a failed quote into an unrestricted or zero-price checkout', async () => {
    expect(await quoteGoodsSalesAction([{ goodId: 'g1', qty: 0 }])).toMatchObject({ ok: false });
    expect(mocks.quote).not.toHaveBeenCalled();
    const items = [{ goodId: 'g1', variantId: '00000000-0000-4000-8000-000000000001', qty: 1 }];
    mocks.quote.mockResolvedValue(null);
    expect(await quoteGoodsSalesAction(items)).toMatchObject({ ok: false });
    mocks.quote.mockRejectedValue(new Error('offline'));
    expect(await quoteGoodsSalesAction(items)).toMatchObject({ ok: false });
  });
});
