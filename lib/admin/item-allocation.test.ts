import { describe, expect, it } from 'vitest';
import { settledExportFixture } from '@/test/fixtures/settled-export';
import { buildSettledExportModel } from './settled-export';
import {
  allocateLegacyOrderDiscounts, LEGACY_ALLOCATION_ISSUES, orderItemAllocations, parseLegacyCouponTerms, parseOrderAllocationInputs, smartStoreItemDiscount,
  type OrderAllocationInput,
} from './item-allocation';

/** 거래확정 엑셀 고정 데이터와 같은 버전 1 주문을 배분 입력으로 옮긴다. */
function legacyInputFromSettled(): OrderAllocationInput {
  const order = settledExportFixture().orders[0];
  return {
    orderId: order.id, calculationVersion: 1, couponDiscount: order.couponDiscount, storeCredits: order.storeCredits, volumeDiscount: 0,
    coupon: order.coupon, items: order.items.map(item => ({ id: item.id, goodId: item.goodId, qty: item.qty, unitPrice: item.unitPrice, regularUnitPrice: item.regularUnitPrice, allocation: null })),
  };
}

describe('품목별 쿠폰·적립금 배분(10/14 회의 A5)', () => {
  it('버전 1 할인 주문을 거래확정 엑셀과 같은 값으로 나눈다', () => {
    const settled = buildSettledExportModel(settledExportFixture());
    const allocations = orderItemAllocations(legacyInputFromSettled());
    for (const line of settled.lines) {
      expect(allocations.get(line.itemId)).toEqual({ source: 'legacy', volumeDiscount: 0, couponDiscount: line.couponAmount, storeCreditDiscount: line.creditAmount, paidGoodsTotal: line.salesAmount });
    }
    expect([...allocations.values()].reduce((sum, value) => sum + value.paidGoodsTotal, 0) + settled.orders[0].shippingFee).toBe(settled.orders[0].total);
  });

  it('입력 품목 순서가 달라도 같은 품목에 같은 금액을 준다', () => {
    const input = legacyInputFromSettled();
    const reversed = { ...input, items: [...input.items].reverse() };
    expect(orderItemAllocations(reversed)).toEqual(orderItemAllocations(input));
  });

  it('쿠폰 대상 기록이 없거나 대상 합계가 다르면 추정하지 않는다', () => {
    const input = legacyInputFromSettled();
    expect(orderItemAllocations({ ...input, coupon: { ...input.coupon!, terms: null } }).size).toBe(0);
    expect(orderItemAllocations({ ...input, coupon: { ...input.coupon!, eligibleSubtotal: 1 } }).size).toBe(0);
    expect(allocateLegacyOrderDiscounts({ couponDiscount: 1000, storeCredits: 0, coupon: null, items: [{ id: 'a', goodId: 'g', amount: 5000 }] }).issues)
      .toEqual([LEGACY_ALLOCATION_ISSUES.couponUnrecorded]);
    expect(allocateLegacyOrderDiscounts({ couponDiscount: 0, storeCredits: 9000, coupon: null, items: [{ id: 'a', goodId: 'g', amount: 5000 }] }).issues)
      .toEqual([LEGACY_ALLOCATION_ISSUES.creditMismatch]);
  });

  it('할인 없는 버전 1 주문은 품목 금액 그대로이고, 버전 2는 기록된 배분 원장만 쓴다', () => {
    const plain = orderItemAllocations({ ...legacyInputFromSettled(), couponDiscount: 0, storeCredits: 0, coupon: null });
    expect([...plain.values()].every(value => value.couponDiscount === 0 && value.storeCreditDiscount === 0)).toBe(true);
    const recorded = { volumeDiscount: 100, couponDiscount: 200, storeCreditDiscount: 300, paidGoodsTotal: 400 };
    const v2: OrderAllocationInput = { orderId: 'o', calculationVersion: 2, couponDiscount: 200, storeCredits: 300, volumeDiscount: 100, coupon: null,
      items: [{ id: 'i', goodId: 'g', qty: 1, unitPrice: 1000, regularUnitPrice: null, allocation: recorded }] };
    expect(orderItemAllocations(v2).get('i')).toEqual({ source: 'recorded', ...recorded });
    expect(orderItemAllocations({ ...v2, items: [{ ...v2.items[0], allocation: null }] }).size).toBe(0);
  });

  it('스마트스토어 상품별 할인액은 정가 차이와 배분 할인을 더하고 정가가 없으면 비운다', () => {
    const allocation = { source: 'legacy' as const, volumeDiscount: 0, couponDiscount: 501, storeCreditDiscount: 339, paidGoodsTotal: 9160 };
    expect(smartStoreItemDiscount({ qty: 2, unitPrice: 5000, regularUnitPrice: 6000 }, allocation)).toBe(2840);
    expect(smartStoreItemDiscount({ qty: 2, unitPrice: 5000, regularUnitPrice: null }, allocation)).toBeNull();
    expect(smartStoreItemDiscount({ qty: 2, unitPrice: 5000, regularUnitPrice: 4000 }, allocation)).toBeNull();
  });

  it('카테고리·IP 쿠폰은 주문 당시 스냅샷 판정(couponEligible·당시 IP)으로 대상 품목을 고른다', () => {
    const input = legacyInputFromSettled();
    const [first, second, third] = input.items;
    const settled = buildSettledExportModel(settledExportFixture());
    // 같은 두 품목이 대상이면 상품 쿠폰과 같은 값이 나온다.
    const category = orderItemAllocations({ ...input, coupon: { ...input.coupon!, terms: { goodsScope: 'selected_categories', targetGoodIds: [], targetCategoryIds: ['c1'] } },
      items: [{ ...first, couponEligible: true }, { ...second, couponEligible: true }, { ...third, couponEligible: false }] });
    expect(settled.lines.map(line => category.get(line.itemId)?.couponDiscount)).toEqual([501, 500, 0]);
    const ip = orderItemAllocations({ ...input, coupon: { ...input.coupon!, terms: { goodsScope: 'selected_ips', targetGoodIds: [], targetIpIds: ['maple'] } },
      items: [{ ...first, ipId: 'maple' }, { ...second, ipId: 'maple' }, { ...third, ipId: 'other' }] });
    expect(settled.lines.map(line => ip.get(line.itemId)?.couponDiscount)).toEqual([501, 500, 0]);
    // 판정 근거가 없는 카테고리 쿠폰(이전 수집본)은 추정하지 않는다.
    expect(allocateLegacyOrderDiscounts({ couponDiscount: 1000, storeCredits: 0, coupon: { discountAmount: 1000, eligibleSubtotal: 5000,
      terms: { goodsScope: 'selected_categories', targetGoodIds: [], targetCategoryIds: ['c1'] } }, items: [{ id: 'a', goodId: 'g', amount: 5000 }] }))
      .toEqual({ coupon: null, credits: null, issues: [LEGACY_ALLOCATION_ISSUES.couponUnrecorded] });
    // 분류가 바뀌어 대상 합계가 기록과 다르면 배분하지 않는다.
    expect(orderItemAllocations({ ...input, coupon: { ...input.coupon!, terms: { goodsScope: 'selected_categories', targetGoodIds: [], targetCategoryIds: ['c1'] } },
      items: input.items.map(item => ({ ...item, couponEligible: true })) }).size).toBe(0);
    expect(parseLegacyCouponTerms({ goodsScope: 'selected_brands', targetGoodIds: [] })).toBeUndefined();
  });

  it('DB 응답에서 형식이 어긋난 주문만 버린다', () => {
    const valid = { orderId: 'o1', calculationVersion: 1, couponDiscount: 0, storeCredits: 0, volumeDiscount: 0, coupon: null,
      items: [{ id: 'i1', goodId: 'g', qty: 1, unitPrice: 1000, regularUnitPrice: null, allocation: null }] };
    const parsed = parseOrderAllocationInputs([valid, { ...valid, orderId: 'o2', items: [{ ...valid.items[0], qty: 0 }] },
      { ...valid, orderId: 'o3', coupon: { discountAmount: 1, eligibleSubtotal: 1, terms: { goodsScope: 'nope' } } }]);
    expect(parsed.map(order => order.orderId)).toEqual(['o1']);
    expect(parseOrderAllocationInputs(null)).toEqual([]);
  });
});
