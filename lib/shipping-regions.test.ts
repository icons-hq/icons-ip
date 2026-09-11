import { describe, expect, it } from 'vitest';
import { parseShippingQuote } from './fulfillment';
import { parseAddressGoodsSalesQuote, parseAddressShippingQuote, parseRegionalShippingSnapshot, parseShippingDestination, shippingRegionStatusMessage } from './shipping-regions';
const destination = { postalCode: '12345', address1: '합성시 검증구 검증로 1' };
const base = { originId: '00000000-0000-4000-8000-000000000001', originCode: 'test', originName: '합성 출고지',
  policySubtotal: 10000, baseFee: 3000, freeThreshold: 30000, policyFee: 3000, individualFee: 0, totalFee: 3000,
  expectedShipDate: '2026-09-30', hasPreorder: true, hasStockItems: true };
const legacy = { ...base, regionMode: 'legacy_base_only', regionStatus: 'unconfigured', regionalContractFee: null, regionalFee: 0, finalFee: 3000,
  policyId: null, policyVersion: null, ruleId: null, regionLabel: null, carrierCode: 'hanjin', feeUnit: null, unitCount: 0,
  destinationPostalCode: destination.postalCode, matchedAddressPrefix: null };
const managed = { ...legacy, totalFee: 5500, regionMode: 'managed', regionStatus: 'surcharge', regionalContractFee: 2500, regionalFee: 2500, finalFee: 5500,
  policyId: '00000000-0000-4000-8000-000000000002', policyVersion: 1, ruleId: '00000000-0000-4000-8000-000000000003',
  regionLabel: '합성 검증지역', feeUnit: 'per_shipment', unitCount: 1, matchedAddressPrefix: '합성시 검증구' };
function quote(group = legacy as Record<string, unknown>) { return { totalFee: group.totalFee, groups: [group], checkoutAllowed: true, finalTotalFee: group.finalFee, destination, nextChangeAt: null }; }
describe('주소별 배송비 견적 계약', () => {
  it('기존 운임은 보존하며 미확인 계약료를 0원으로 바꾸지 않는다', () => {
    const parsed = parseAddressShippingQuote(quote());
    expect(parsed?.groups[0]).toMatchObject({ regionalContractFee: null, regionalFee: 0, finalFee: 3000, expectedShipDate: '2026-09-30' });
    expect(parseAddressShippingQuote(quote({ ...legacy, regionalContractFee: 0 }))).toBeNull();
    expect(shippingRegionStatusMessage('unconfigured')).toBe('표시된 배송비로 주문이 확정됩니다.');
  });
  it('기존 parser의 기본 배송료 합계 검증을 유지하며 추가료를 별도로 검사한다', () => {
    expect(parseShippingQuote({ totalFee: 5500, groups: [managed] })).toBeNull();
    expect(parseAddressShippingQuote(quote(managed))?.totalFee).toBe(5500);
    expect(parseAddressShippingQuote(quote({ ...managed, regionalFee: 2400 }))).toBeNull();
    expect(parseAddressShippingQuote(quote({ ...managed, finalFee: 3000 }))).toBeNull();
    expect(parseAddressShippingQuote(quote({ ...managed, unitCount: 2 }))).toBeNull();
    expect(parseAddressShippingQuote(quote({ ...managed, policyVersion: null }))).toBeNull();
  });
  it('무료 관계에 따른 면제와 명시적 계약료 0원을 구별한다', () => {
    expect(parseAddressShippingQuote(quote({ ...managed, totalFee: 3000, regionalFee: 0, finalFee: 3000, unitCount: 0 }))?.groups[0].regionalContractFee).toBe(2500);
    expect(parseAddressShippingQuote(quote({ ...managed, totalFee: 3000, regionalContractFee: 0, regionalFee: 0, finalFee: 3000 }))?.groups[0].unitCount).toBe(1);
  });
  it('주소·정책 미확정 그룹이 있으면 혼합 출고지 전체 결제를 막는다', () => {
    const pending = { ...managed, totalFee: 3000, regionStatus: 'manual_review', regionalContractFee: null, regionalFee: null, finalFee: null,
      ruleId: null, regionLabel: null, matchedAddressPrefix: null, unitCount: 0 };
    const mixed = { totalFee: 6000, groups: [pending, { ...legacy, originId: 'other-origin' }], checkoutAllowed: false, finalTotalFee: null, destination, nextChangeAt: null };
    expect(parseAddressShippingQuote(mixed)?.checkoutAllowed).toBe(false);
    expect(parseAddressShippingQuote({ ...mixed, checkoutAllowed: true, finalTotalFee: 6000 })).toBeNull();
    expect(parseAddressShippingQuote({ ...mixed, groups: [pending, pending] })).toBeNull();
  });
  it('주소는 공백을 정규화하고 정확한 주소 시작 경계를 검증한다', () => {
    expect(parseShippingDestination({ postalCode: ' 12345 ', address1: '\t합성시\u00a0검증구  검증로 1\n', ignored: 'not retained' })).toEqual(destination);
    expect(parseShippingDestination({ postalCode: '1234', address1: '합성시' })).toBeNull();
    expect(parseAddressShippingQuote({ ...quote(managed), destination: { ...destination, address1: '합성시 검증구역 검증로 1' } })).toBeNull();
  });
  it('과거 배송 스냅샷의 지역표 부재를 새 정책으로 추정하지 않는다', () => {
    expect(parseRegionalShippingSnapshot(base)).toBeNull();
    expect(parseRegionalShippingSnapshot(managed)?.policyVersion).toBe(1);
  });
  it('sales parser는 기존 가격·쿠폰 검증을 재사용한다', () => {
    const sale = { calculatedAt: '2026-09-10T00:00:00Z', subtotal: 10000, lines: [{ goodId: 'g1', variantId: '00000000-0000-4000-8000-000000000010',
      qty: 1, available: true, regularPrice: 10000, effectivePrice: 10000, pricePeriodId: null, startsAt: null, endsAt: null }],
    goods: [{ goodId: 'g1', qty: 1, orderQuantityLimitEnabled: false, minOrderQty: null, maxOrderQty: null,
      memberPurchaseLimitEnabled: false, memberLifetimeQtyLimit: null, memberReservedQty: null, memberRemainingQty: null, reason: null }],
    paymentMethods: { card: true, bankTransfer: true }, shipping: quote(managed) };
    expect(parseAddressGoodsSalesQuote(sale)?.shipping.finalTotalFee).toBe(5500);
    expect(parseAddressGoodsSalesQuote({ ...sale, subtotal: 9999 })).toBeNull();
    expect(parseAddressGoodsSalesQuote({ ...sale, shipping: { ...sale.shipping, nextChangeAt: '2026-09-09T00:00:00Z' } })).toBeNull();
  });
});
