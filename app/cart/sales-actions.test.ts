import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ quote: vi.fn(), precheckout: vi.fn(), rpc: vi.fn(), parse: vi.fn() }));
vi.mock('@/lib/goods-sales.server', () => ({ loadGoodsSalesQuote: mocks.quote, loadGoodsSalesPrecheckoutQuote: mocks.precheckout }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock('@/lib/shipping-regions', async (importOriginal) => ({ ...await importOriginal<typeof import('@/lib/shipping-regions')>(),
  parseAddressGoodsSalesQuote: mocks.parse }));
import { quoteGoodsSalesAction, quoteGoodsSalesPrecheckoutAction, quoteGoodsSalesWithCouponAction } from './sales-actions';
import { goodsSalesPrecheckoutQuote } from '@/test/fixtures/goods-sales-precheckout';
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

describe('precheckout sales action', () => {
  it('forwards only item identities and quantities without address, price or caller user data', async () => {
    const item = goodsSalesPrecheckoutQuote.lines[0];
    mocks.precheckout.mockResolvedValue(goodsSalesPrecheckoutQuote);
    expect(await quoteGoodsSalesPrecheckoutAction([{ ...item, price: 1, userId: 'other', destination: { postalCode: '01234' } }]))
      .toEqual({ ok: true, quote: goodsSalesPrecheckoutQuote });
    expect(mocks.precheckout).toHaveBeenCalledExactlyOnceWith([{ goodId: item.goodId, variantId: item.variantId, qty: item.qty }]);
    expect(mocks.quote).not.toHaveBeenCalled();
  });
  it('rejects invalid quantities and keeps failed product conditions unavailable', async () => {
    const item = goodsSalesPrecheckoutQuote.lines[0];
    expect(await quoteGoodsSalesPrecheckoutAction([{ ...item, qty: 0 }])).toMatchObject({ ok: false });
    expect(mocks.precheckout).not.toHaveBeenCalled();
    mocks.precheckout.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('offline'));
    expect(await quoteGoodsSalesPrecheckoutAction([item])).toMatchObject({ ok: false });
    expect(await quoteGoodsSalesPrecheckoutAction([item])).toMatchObject({ ok: false });
    expect(mocks.quote).not.toHaveBeenCalled();
  });
});

/* 바로구매 주문서(ADR-0030)의 견적은 장바구니 쿠폰 선택이 아니라 주문서에서 고른 쿠폰으로 계산한다. */
describe('direct checkout sales quote action', () => {
  const items = [{ goodId: 'g1', variantId: '00000000-0000-4000-8000-000000000001', qty: 1 }];
  const coupon = '11111111-1111-4111-8111-111111111111';
  it('품목·배송지·고른 쿠폰만 DB 견적으로 넘긴다', async () => {
    mocks.rpc.mockResolvedValue({ data: { raw: true }, error: null });
    mocks.parse.mockReturnValue({ subtotal: 1000 });
    expect(await quoteGoodsSalesWithCouponAction([{ ...items[0], price: 1 }], null, coupon.toUpperCase())).toEqual({ ok: true, quote: { subtotal: 1000 } });
    expect(mocks.rpc).toHaveBeenCalledWith('quote_goods_sales_for_address_with_coupon', { items, destination: null, p_user_coupon_id: coupon });
    await quoteGoodsSalesWithCouponAction(items, null, null);
    expect(mocks.rpc).toHaveBeenLastCalledWith('quote_goods_sales_for_address_with_coupon', { items, destination: null, p_user_coupon_id: null });
  });
  it('쿠폰 모양이 틀리거나 견적이 실패하면 할인·무료 결제를 약속하지 않는다', async () => {
    expect(await quoteGoodsSalesWithCouponAction(items, null, 'not-a-coupon')).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await quoteGoodsSalesWithCouponAction(items, null, null)).toMatchObject({ ok: false });
    mocks.rpc.mockRejectedValue(new Error('offline'));
    expect(await quoteGoodsSalesWithCouponAction(items, null, null)).toMatchObject({ ok: false });
  });
});

