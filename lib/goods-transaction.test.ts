import { describe, expect, it } from 'vitest';
import { parseGoodsTransactionAdminReceipt, parseGoodsTransactionQuote, parseGoodsTransactionSelection, parseGoodsTransactionTotals, type GoodsTransactionDisplay } from './goods-transaction';
import { transactionEpochMicros, transactionInstant } from './goods-transaction-values';
import { chargeIds, chargePublicFixtures } from '@/test/fixtures/shipping-charge-groups';
import { parseCheckoutTransactionReceipt } from './checkout-transaction';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const calculatedAt = '2026-10-14T00:00:00Z';
const display: GoodsTransactionDisplay = {
  calculationVersion: 2, currency: 'KRW', calculatedAt, nextChangeAt: null,
  lines: [
    { lineId: id(1), goodId: 'a', variantId: id(11), qty: 3, regularUnitPrice: 10000, unitPrice: 8000, volumeUnitDiscount: 1000,
      subtotal: 24000, volumeDiscountTotal: 3000, netSubtotal: 21000, couponDiscount: 2100, storeCreditDiscount: 1582, paidGoodsTotal: 17318, volumePolicyId: id(21) },
    { lineId: id(2), goodId: 'b', variantId: id(12), qty: 1, regularUnitPrice: 5000, unitPrice: 5000, volumeUnitDiscount: 0,
      subtotal: 5000, volumeDiscountTotal: 0, netSubtotal: 5000, couponDiscount: 0, storeCreditDiscount: 418, paidGoodsTotal: 4582, volumePolicyId: null },
  ],
  shipping: [{ originId: id(31), prepaidFee: 6750, collectFee: 2250, fullFee: 9000,
    components: [{ goodId: 'a', paymentMode: 'prepaid', baseFee: 6000, regionalFee: 750, totalFee: 6750, deliveryPolicyId: id(22) },
      { goodId: 'b', paymentMode: 'collect', baseFee: 2000, regionalFee: 250, totalFee: 2250, deliveryPolicyId: id(23) }],
    collector: { name: 'TEST 수납사', method: '배송 시 지급', refundContact: 'TEST 담당자', instructions: 'TEST 합성 계약' } }],
  totals: { subtotal: 29000, volumeDiscountTotal: 3000, netGoodsTotal: 26000, couponDiscountTotal: 2100, storeCreditTotal: 2000,
    prepaidShippingTotal: 6750, collectShippingTotal: 2250, onlineTotal: 28650, customerTotal: 30900 },
  userCouponId: id(41), storeCreditMaximum: 23900, paymentMethods: { card: true, bankTransfer: true },
};
const quote = { state: 'quoted', quoteId: id(51), expiresAt: '2026-10-14T00:10:00Z', display };

describe('확정 견적 strict DTO', () => {
  it('과거 exact shape를 유지하고 새 그룹 형식만 명시적으로 확장한다', () => {
    expect(parseGoodsTransactionQuote(quote)).toEqual(quote);
    const { display: grouped, receipt } = chargePublicFixtures();
    expect(parseCheckoutTransactionReceipt(receipt)).toEqual(receipt);
    const next = { state: 'quoted', quoteId: chargeIds.quote, expiresAt: '2026-10-14T00:10:00.123456Z', display: grouped };
    expect(parseGoodsTransactionQuote(next)).toEqual(next);
    for (const chargeDetails of [null, undefined, {}, { version: 2 }]) {
      expect(parseGoodsTransactionQuote({ ...next, display: { ...grouped, shipping: [{ ...grouped.shipping[0], chargeDetails }] } })).toBeNull();
    }
  });
  it('그룹 회원의 수량/S/배분과 원래 source를 속이는 새 필드를 거절한다', () => {
    const { receipt } = chargePublicFixtures();
    for (const field of ['quantity', 'subtotal', 'baseFee', 'regionalFee'] as const) {
      const value = structuredClone(receipt); value.display.shipping[0].chargeDetails!.groups[0][field]++;
      expect(parseCheckoutTransactionReceipt(value)).toBeNull();
    }
    const privateValue = structuredClone(receipt);
    Object.assign(privateValue.display.shipping[0].chargeDetails!.groups[0], { ownerGoodId: 'PRIVATE' });
    expect(parseCheckoutTransactionReceipt(privateValue)).toBeNull();
  });
  it('같은 그룹 정체성을 다른 물리 출고지에 중복해서 붙일 수 없다', () => {
    const { receipt } = chargePublicFixtures(), original = receipt.display.shipping[0], details = original.chargeDetails!;
    receipt.display.shipping = [
      { ...original, prepaidFee:4000,fullFee:8000,components:original.components.slice(0,2),
        chargeDetails:{ ...details,unassignedBaseFee:0,originRegionalFee:0,originRegionFeeUnit:null } },
      { ...original,originId:id(99),prepaidFee:3000,collectFee:0,fullFee:3000,components:original.components.slice(2),collector:null,
        chargeDetails:{ version:1,unassignedBaseFee:0,originRegionalFee:0,originRegionFeeUnit:null,
          groups:[{ ...details.groups[0],quantity:1,subtotal:5000,baseFee:1000,regionalFee:2000,goodIds:['good-c'] }] } },
    ];
    expect(parseCheckoutTransactionReceipt(receipt)).toBeNull();
    receipt.display.shipping[1].chargeDetails!.groups[0].groupId=id(98);
    expect(parseCheckoutTransactionReceipt(receipt)).not.toBeNull();
  });
  it('실제 달력/윤년/시각/offset을 검사하고 마이크로초 원문을 허용한다', () => {
    for (const value of ['2026-02-30T00:00:00Z', '2026-02-31T00:00:00Z', '1900-02-29T00:00:00Z', '2026-04-31T00:00:00Z',
      '2026-10-14T24:00:00Z', '2026-10-14T00:60:00Z', '2026-10-14T00:00:60Z', '2026-10-14T00:00:00+25:00',
      '2026-10-14T00:00:00+09:60', '2026-10-14T00:00:00.1234567Z', '0000-01-01T00:00:00Z']) expect(transactionInstant(value)).toBe(false);
    for (const value of ['2000-02-29T00:00:00Z', '2028-02-29T23:59:59.123456+09:00', '0099-02-28T00:00:00Z']) expect(transactionInstant(value)).toBe(true);
    expect(transactionEpochMicros('2026-10-14T00:00:00.123456Z') - transactionEpochMicros('2026-10-14T00:00:00.123455Z')).toBe(BigInt(1));
    expect(transactionEpochMicros('1969-12-31T23:59:59.123456Z')).toBe(BigInt(-876544));
  });
  it('독립 예시 합계와 지급 시점을 검증하고 PG 금액에 착불을 더하지 않는다', () => {
    expect(parseGoodsTransactionQuote(quote)).toEqual(quote);
    expect(parseGoodsTransactionTotals({ ...display.totals, onlineTotal: 30900 })).toBeNull();
    expect(parseGoodsTransactionTotals({ ...display.totals, onlineTotal: '28650' })).toBeNull();
    expect(parseGoodsTransactionTotals({ ...display.totals, volumeDiscountTotal: 0 })).toBeNull();
  });
  it('잘못된 할인 배분·중복 배송/품목·누락 수납·개인정보 DTO를 거절한다', () => {
    const changes = [
      { lines: [{ ...display.lines[0], storeCreditDiscount: 1583 }, display.lines[1]] },
      { lines: [...display.lines, display.lines[0]] },
      { shipping: [...display.shipping, display.shipping[0]] },
      { shipping: [{ ...display.shipping[0], collector: null }] },
      { address: { postalCode: '00000' } },
      { userCouponId: null }, { storeCreditMaximum: 24000 },
    ];
    for (const patch of changes) expect(parseGoodsTransactionQuote({ ...quote, display: { ...display, ...patch } })).toBeNull();
  });
  it('실패 견적에 quote ID가 없고 TTL은 다음 경계와 10분을 넘지 않는다', () => {
    const blocked = { state: 'blocked', issues: [{ code: 'address_required', goodId: null }] };
    expect(parseGoodsTransactionQuote(blocked)).toEqual(blocked);
    expect(parseGoodsTransactionQuote({ ...blocked, quoteId: id(52) })).toBeNull();
    expect(parseGoodsTransactionQuote({ ...quote, expiresAt: '2026-10-14T00:10:00.001Z' })).toBeNull();
    expect(parseGoodsTransactionQuote({ ...quote, expiresAt: '2026-10-14T00:10:00.000001Z' })).toBeNull();
    expect(parseGoodsTransactionQuote({ ...quote, display: { ...display, nextChangeAt: '2026-10-14T00:05:00Z' } })).toBeNull();
  });
  it('선택 정체성에는 직접입력 revision/값을 포함하고 중복 및 임의 키를 거절한다', () => {
    const line = { goodId: 'slug-id', variantId: id(11), qty: 1, inputRevision: 0, inputValues: {} };
    expect(parseGoodsTransactionSelection([line])).toEqual([line]);
    expect(parseGoodsTransactionSelection([line, line])).toBeNull();
    expect(parseGoodsTransactionSelection([{ ...line, qty: '1' }])).toBeNull();
    expect(parseGoodsTransactionSelection([{ ...line, inputRevision: 1 }])).toBeNull();
    expect(parseGoodsTransactionSelection([{ ...line, inputRevision: 1, inputValues: { [id(61)]: '문구 A' } },
      { ...line, inputRevision: 1, inputValues: { [id(61)]: '문구 B' } }])).toHaveLength(2);
  });
  it('정책 영수증의 상품/정책 revision과 timestamp를 검증한다', () => {
    const receipt = { operationId: id(71), goodId: 'slug-id', revision: 0, goodUpdatedAt: calculatedAt, changed: false, volume: null, delivery: null };
    expect(parseGoodsTransactionAdminReceipt(receipt)).toEqual(receipt);
    expect(parseGoodsTransactionAdminReceipt({ ...receipt, revision: '0' })).toBeNull();
    expect(parseGoodsTransactionAdminReceipt({ ...receipt, goodUpdatedAt: '2026-10-14' })).toBeNull();
  });
});

it('중복 쿠폰과 선결제 운송비 할인은 각각의 원장 합계와 일치해야 한다', () => {
  const combined = structuredClone(quote);
  combined.display.coupons = [
    { userCouponId: id(41), code: 'GOODS-1', name: '상품 1', benefitKind: 'goods', discount: 1000, applicationIndex: 1 },
    { userCouponId: id(42), code: 'GOODS-2', name: '상품 2', benefitKind: 'goods', discount: 1100, applicationIndex: 2 },
    { userCouponId: id(43), code: 'SHIP-1', name: '배송비', benefitKind: 'shipping', discount: 3000, applicationIndex: 3 },
  ];
  Object.assign(combined.display.shipping[0].components[0], { shippingCouponDiscount: 3000, totalFee: 3750 });
  Object.assign(combined.display.shipping[0], { prepaidFee: 3750, fullFee: 6000 });
  Object.assign(combined.display.totals, { shippingCouponDiscountTotal: 3000, prepaidShippingTotal: 3750, onlineTotal: 25650, customerTotal: 27900 });
  expect(parseGoodsTransactionQuote(combined)).toEqual(combined);
  for (const mutate of [
    (v: typeof combined) => { v.display.coupons![0].discount++; },
    (v: typeof combined) => { v.display.coupons!.reverse(); },
    (v: typeof combined) => { v.display.coupons![1].userCouponId = id(41); },
    (v: typeof combined) => { v.display.shipping[0].components[0].shippingCouponDiscount = 2999; },
    (v: typeof combined) => { v.display.shipping[0].components[1].shippingCouponDiscount = 1; },
    (v: typeof combined) => { v.display.totals.shippingCouponDiscountTotal = 2999; },
  ]) { const invalid = structuredClone(combined); mutate(invalid); expect(parseGoodsTransactionQuote(invalid)).toBeNull(); }
});
