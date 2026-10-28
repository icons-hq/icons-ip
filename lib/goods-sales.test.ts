import { describe, expect, it } from 'vitest';
import { parseGoodsSalesQuote, parseGoodsSalesPrecheckoutQuote, goodsSalesQuoteProblem, quoteLineOptionLimitMessage } from './goods-sales';
import { goodsSalesPrecheckoutQuote as precheckout } from '@/test/fixtures/goods-sales-precheckout';
import { parseAddressGoodsSalesQuote } from './shipping-regions';

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

describe('precheckout product conditions', () => {
  it('keeps product prices, supply and member conditions while shipping remains unquoted', () => {
    expect(parseGoodsSalesPrecheckoutQuote(precheckout)).toEqual(precheckout);
    expect(goodsSalesQuoteProblem(precheckout)).toBeNull();
    const preorder = { ...precheckout, lines: [{ ...precheckout.lines[0], supply: {
      ...precheckout.lines[0].supply, mode: 'preorder', state: 'open',
      policyId: '00000000-0000-4000-8000-000000000003', policyRevision: 1,
      startsAt: '2026-10-14T00:00:00Z', endsAt: '2026-10-16T00:00:00Z', expectedShipDate: '2026-10-20',
    } }] };
    expect(parseGoodsSalesPrecheckoutQuote(preorder)).toEqual(preorder);
  });
  it('rejects coupon or shipping amounts and never weakens a legacy shipping parser', () => {
    for (const shipping of [null, quote.shipping, { status: 'checkout_required', totalFee: 0 },
      { status: 'checkout_required', groups: [] }, { status: 'checkout_required', finalTotalFee: 0 },
      { status: 'quoted' }]) {
      expect(parseGoodsSalesPrecheckoutQuote({ ...precheckout, shipping })).toBeNull();
    }
    expect(parseGoodsSalesPrecheckoutQuote({ ...precheckout, coupon: null })).toBeNull();
    expect(parseGoodsSalesPrecheckoutQuote({ ...precheckout, coupon: { discount: 0 } })).toBeNull();
    expect(parseGoodsSalesQuote(precheckout)).toBeNull();
    expect(parseAddressGoodsSalesQuote(precheckout)).toBeNull();
  });
  it('retains monetary, aggregated quantity, supply and product refresh validation', () => {
    const invalid = [
      { ...precheckout, subtotal: 16001 },
      { ...precheckout, goods: [{ ...precheckout.goods[0], qty: 1 }] },
      { ...precheckout, goods: [{ ...precheckout.goods[0], memberRemainingQty: 5 }] },
      { ...precheckout, lines: [{ ...precheckout.lines[0], supply: { ...precheckout.lines[0].supply, availableQty: 1 } }] },
      { ...precheckout, nextChangeAt: precheckout.calculatedAt },
    ];
    for (const value of invalid) expect(parseGoodsSalesPrecheckoutQuote(value)).toBeNull();
  });
});

/* D5② 랜덤 판매·D7② 옵션별 구매 제한 — legacy 견적 line의 optionSaleMode·optionLimit. */
describe('옵션 판매 방식·옵션별 구매 제한 견적', () => {
  const limit = { orderMaxQty: 3, memberMaxQty: 5, memberReservedQty: 4, memberRemainingQty: 1, reason: null };
  const withLine = (line: Record<string, unknown>) => ({ ...quote, lines: [{ ...quote.lines[0], ...line }] });

  it('판매 방식과 옵션 한도를 line에 싣고, 망가진 값은 견적 전체를 버린다', () => {
    const parsed = parseGoodsSalesQuote(withLine({ optionSaleMode: 'random', optionLimit: { ...limit, orderMaxQty: null, memberMaxQty: null, memberReservedQty: null, memberRemainingQty: null } }));
    expect(parsed?.lines[0]).toMatchObject({ optionSaleMode: 'random', optionLimit: { orderMaxQty: null, reason: null } });
    expect(parseGoodsSalesQuote(withLine({ optionSaleMode: 'select', optionLimit: limit }))?.lines[0].optionLimit).toEqual(limit);
    expect(parseGoodsSalesQuote(withLine({ optionSaleMode: 'lucky' }))).toBeNull();
    expect(parseGoodsSalesQuote(withLine({ optionLimit: { ...limit, memberRemainingQty: 3 } }))).toBeNull();
    expect(parseGoodsSalesQuote(withLine({ optionLimit: { ...limit, reason: 'unknown' } }))).toBeNull();
    /* 사유는 같은 line의 한도와 맞아야 한다 — 한도가 없는 사유는 받지 않는다. */
    expect(parseGoodsSalesQuote(withLine({ optionLimit: { ...limit, orderMaxQty: null, reason: 'option_order_limit_exceeded' } }))).toBeNull();
    expect(parseGoodsSalesQuote(withLine({ optionLimit: { orderMaxQty: 1, memberMaxQty: null, memberReservedQty: null, memberRemainingQty: null,
      reason: 'option_member_limit_exceeded' } }))).toBeNull();
    /* 옛 견적(키 없음)은 그대로 받는다. */
    expect(parseGoodsSalesQuote(quote)?.lines[0].optionLimit).toBeUndefined();
  });

  it('옵션 한도를 넘긴 line이 있으면 주문을 막고 품목 줄은 확정 카피로 말한다', () => {
    const order = parseGoodsSalesQuote(withLine({ optionLimit: { ...limit, orderMaxQty: 1, reason: 'option_order_limit_exceeded' } }))!;
    expect(goodsSalesQuoteProblem(order)).toBe('한 번에 주문할 수 있는 수량이 정해진 옵션이 있어요. 장바구니에서 수량을 다시 확인해주세요.');
    expect(quoteLineOptionLimitMessage(order.lines[0], '파랑')).toBe("'파랑'은 한 번에 1개까지 주문할 수 있습니다.");
    const member = parseGoodsSalesQuote(withLine({ optionLimit: { ...limit, reason: 'option_member_limit_exceeded' } }))!;
    expect(goodsSalesQuoteProblem(member)).toContain('1인당 구매 수량');
    expect(quoteLineOptionLimitMessage(member.lines[0], '파랑')).toBe("'파랑'은 1인당 5개까지 구매할 수 있습니다.");
    expect(quoteLineOptionLimitMessage(parseGoodsSalesQuote(withLine({ optionLimit: limit }))!.lines[0], '파랑')).toBeNull();
    expect(quoteLineOptionLimitMessage(undefined, '파랑')).toBeNull();
  });
});
