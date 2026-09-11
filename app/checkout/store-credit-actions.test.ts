import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/lib/store-credits.server', () => ({ loadMyStoreCreditCheckout: mocks.load }));
import { quoteCheckoutStoreCreditsAction } from './store-credit-actions';
beforeEach(() => vi.resetAllMocks());
describe('checkout store credits', () => {
  it('loads the authenticated account without accepting a client identity or totals', async () => {
    const quote = { enabled: true, requestedAmount: 1500, available: 2000, maxUse: 2000, valid: true };
    mocks.load.mockResolvedValue(quote);
    expect(await quoteCheckoutStoreCreditsAction('1500')).toEqual({ ok: true, quote });
    expect(mocks.load).toHaveBeenCalledWith(1500, null);
    expect(await quoteCheckoutStoreCreditsAction({ userId: 'other', amount: 1 })).toMatchObject({ ok: false });
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });
  it('recalculates against the shipping destination without accepting client fees', async () => {
    mocks.load.mockResolvedValue({ valid: true });
    expect(await quoteCheckoutStoreCreditsAction(500, { postalCode: '01234', address1: '합성  주소', total: 1 })).toMatchObject({ ok: true });
    expect(mocks.load).toHaveBeenCalledWith(500, { postalCode: '01234', address1: '합성 주소' });
    expect(await quoteCheckoutStoreCreditsAction(500, { postalCode: 'x', address1: '합성 주소' })).toMatchObject({ ok: false });
    expect(mocks.load).toHaveBeenCalledTimes(1);
  });
  it('keeps failed balance queries unavailable instead of promising zero or a discount', async () => {
    mocks.load.mockResolvedValue(null);
    expect(await quoteCheckoutStoreCreditsAction(0)).toMatchObject({ ok: false });
    mocks.load.mockRejectedValue(new Error('private network information'));
    expect(await quoteCheckoutStoreCreditsAction(0)).toMatchObject({ ok: false, error: expect.not.stringContaining('private') });
  });
});
