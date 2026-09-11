import { describe, expect, it } from 'vitest';
import { parseGoodsSalesQuote, goodsSalesQuoteProblem } from './goods-sales';

const quote = {
  calculatedAt: '2026-09-10T12:00:00Z', subtotal: 16000,
  lines: [{ goodId: 'g1', variantId: '00000000-0000-4000-8000-000000000001', qty: 2,
    regularPrice: 10000, effectivePrice: 8000, pricePeriodId: '00000000-0000-4000-8000-000000000002',
    startsAt: '2026-09-10T00:00:00Z', endsAt: '2026-09-11T00:00:00Z', available: true }],
  goods: [{ goodId: 'g1', qty: 2, orderQuantityLimitEnabled: true, minOrderQty: 2, maxOrderQty: 3,
    memberPurchaseLimitEnabled: true, memberLifetimeQtyLimit: 5, memberReservedQty: 1, memberRemainingQty: 4, reason: null }],
  paymentMethods: { card: true, bankTransfer: false },
  shipping: { totalFee: 3000, groups: [{ originId: 'origin1', originCode: 'O1', originName: '출고지',
    policySubtotal: 16000, baseFee: 3000, freeThreshold: null, policyFee: 3000, individualFee: 0, totalFee: 3000 }] },
  nextChangeAt: '2026-09-11T00:00:00Z',
};

describe('authoritative goods sales quote', () => {
  it('keeps actual option price, goods aggregation and member remainder without client repricing', () => {
    expect(parseGoodsSalesQuote(quote)).toEqual(quote);
    expect(goodsSalesQuoteProblem(parseGoodsSalesQuote(quote)!)).toBeNull();
    const guest = { ...quote, goods: [{ ...quote.goods[0], memberReservedQty: null, memberRemainingQty: null }] };
    expect(parseGoodsSalesQuote(guest)?.goods[0].memberRemainingQty).toBeNull();
  });
  it('fails closed for inconsistent monetary/quantity snapshots and incomplete activated values', () => {
    expect(parseGoodsSalesQuote({ ...quote, subtotal: 20000 })).toBeNull();
    expect(parseGoodsSalesQuote({ ...quote, shipping: null })).toBeNull();
    expect(parseGoodsSalesQuote({ ...quote, nextChangeAt: '2026-09-09T00:00:00Z' })).toBeNull();
    expect(parseGoodsSalesQuote({ ...quote, goods: [{ ...quote.goods[0], qty: 1 }] })).toBeNull();
    expect(parseGoodsSalesQuote({ ...quote, goods: [{ ...quote.goods[0], maxOrderQty: null }] })).toBeNull();
    expect(parseGoodsSalesQuote({ ...quote, goods: [{ ...quote.goods[0], memberLifetimeQtyLimit: 0 }] })).toBeNull();
    expect(parseGoodsSalesQuote({ ...quote, lines: [{ ...quote.lines[0], effectivePrice: Number.MAX_SAFE_INTEGER + 1 }] })).toBeNull();
  });
  it('reports blocked quantities and payment intersections from the server result', () => {
    expect(goodsSalesQuoteProblem({ ...quote, goods: [{ ...quote.goods[0], reason: 'member_purchase_limit_exceeded' }] }))
      .toContain('누적 구매 한도');
    expect(goodsSalesQuoteProblem({ ...quote, paymentMethods: { card: false, bankTransfer: false } }))
      .toContain('공통 결제수단');
    expect(goodsSalesQuoteProblem({ ...quote, lines: [{ ...quote.lines[0], available: false }] })).toContain('재고');
  });
  it('keeps only a consistent server coupon allocation and surfaces ineligible selections', () => {
    const coupon = { userCouponId: '00000000-0000-4000-8000-000000000003', couponCode: 'FIRST', eligibleSubtotal: 8000, discount: 1000, reason: null };
    expect(parseGoodsSalesQuote({ ...quote, coupon })?.coupon).toEqual(coupon);
    for (const invalid of [{ ...coupon, eligibleSubtotal: 17000 }, { ...coupon, discount: 9000 }, { ...coupon, reason: 'coupon_no_eligible_goods' }, { ...coupon, userCouponId: 'bad-id' }]) {
      expect(parseGoodsSalesQuote({ ...quote, coupon: invalid })).toBeNull();
    }
    const blocked = parseGoodsSalesQuote({ ...quote, coupon: { ...coupon, discount: 0, reason: 'coupon_first_purchase_only' } });
    expect(blocked).not.toBeNull();
    expect(goodsSalesQuoteProblem(blocked!)).toContain('쿠폰');
  });
});
