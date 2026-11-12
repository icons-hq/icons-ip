import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ load: vi.fn(), loadDraft: vi.fn() }));
vi.mock('@/lib/store-credits.server', () => ({ loadMyStoreCreditCheckout: mocks.load }));
vi.mock('@/lib/checkout-draft.server', () => ({ loadDraftStoreCreditCheckout: mocks.loadDraft }));
import { quoteCheckoutStoreCreditsAction, quoteDraftStoreCreditsAction } from './store-credit-actions';
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

/* 주문서 초안(ADR-0030)의 적립금 사용 한도는 그 주문서 품목과 쿠폰으로 계산한다(1014-032). */
describe('checkout draft store credits', () => {
  const VARIANT = '00000000-0000-4000-8000-000000000002';
  const items = [{ goodId: 'g2', variantId: VARIANT, qty: 2 }];
  it('선택 주문은 장바구니 쿠폰, 바로구매는 주문서에서 고른 쿠폰으로 품목 기준 한도를 묻는다', async () => {
    mocks.loadDraft.mockResolvedValue({ valid: true });
    expect(await quoteDraftStoreCreditsAction(1000, null, items, { kind: 'cart' })).toMatchObject({ ok: true });
    expect(mocks.loadDraft).toHaveBeenLastCalledWith(1000, null, items, { kind: 'cart' });
    const coupon = '11111111-1111-4111-8111-111111111111';
    expect(await quoteDraftStoreCreditsAction(0, null, items, { kind: 'direct', userCouponId: coupon.toUpperCase() })).toMatchObject({ ok: true });
    expect(mocks.loadDraft).toHaveBeenLastCalledWith(0, null, items, { kind: 'direct', userCouponId: coupon });
  });
  it('품목·쿠폰 모양이 틀리면 묻지 않는다', async () => {
    for (const [itemsInput, coupon] of [[[], { kind: 'cart' }], [items, { kind: 'direct', userCouponId: 'x' }], [items, null], [[{ goodId: 'g2', variantId: 'x', qty: 1 }], { kind: 'cart' }]] as const) {
      expect(await quoteDraftStoreCreditsAction(0, null, itemsInput, coupon)).toMatchObject({ ok: false });
    }
    expect(mocks.loadDraft).not.toHaveBeenCalled();
  });
});

