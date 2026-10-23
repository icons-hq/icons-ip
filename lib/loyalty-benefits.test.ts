import { describe, expect, it } from 'vitest';
import {
  gradeBenefitCouponCopy,
  gradeCreditRateLabel,
  loyaltyCriterionCopy,
  parseLoyaltyGradeBenefits,
  parseLoyaltyStanding,
  type GradeBenefitCoupon,
} from './loyalty-benefits';
import type { LoyaltyCriterion } from './loyalty-policy';

function coupon(overrides: Partial<GradeBenefitCoupon> = {}): GradeBenefitCoupon {
  return {
    name: '실버 승급 쿠폰',
    benefitKind: 'goods',
    discountType: 'fixed',
    discountValue: 3000,
    maxDiscountAmount: null,
    minSubtotal: 30000,
    goodsScope: 'all',
    recipientSegment: 'all',
    startsAt: '2026-10-01T00:00:00.000Z',
    endsAt: null,
    validDays: null,
    ...overrides,
  };
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    creditRatesEnabled: false,
    grades: [
      { grade: 'welcome', creditRateBps: null, coupons: [] },
      { grade: 'silver', creditRateBps: null, coupons: [coupon()] },
      { grade: 'gold', creditRateBps: null, coupons: [] },
      { grade: 'platinum', creditRateBps: null, coupons: [] },
    ],
    ...overrides,
  };
}

const TIERS: LoyaltyCriterion[] = [
  { grade: 'silver', enabled: true, amount: 150000, itemCount: 3 },
  { grade: 'gold', enabled: true, amount: 500000, itemCount: null },
  { grade: 'platinum', enabled: false, amount: null, itemCount: null },
];

describe('parseLoyaltyGradeBenefits', () => {
  it('keeps the four grades in ladder order with their coupons', () => {
    const parsed = parseLoyaltyGradeBenefits(response());

    expect(parsed?.grades.map((row) => row.grade)).toEqual(['welcome', 'silver', 'gold', 'platinum']);
    expect(parsed?.grades[1].coupons).toEqual([coupon()]);
    expect(parsed?.creditRatesEnabled).toBe(false);
  });

  /* 코드 입력 발급은 등급을 묻지 않는다 — 응답에 코드가 실려 오면 계약이 깨진 것이라 화면에 쓰지 않는다. */
  it('rejects a coupon that carries its code', () => {
    const leaked = response();
    (leaked.grades as { coupons: unknown[] }[])[1].coupons = [{ ...coupon(), code: 'SILVER-3000' }];

    expect(parseLoyaltyGradeBenefits(leaked)).toBeNull();
  });

  it('rejects rates while the policy is off and out-of-range rates while it is on', () => {
    const offWithRate = response();
    (offWithRate.grades as { creditRateBps: unknown }[])[0].creditRateBps = 100;
    expect(parseLoyaltyGradeBenefits(offWithRate)).toBeNull();

    const onWithRates = response({ creditRatesEnabled: true });
    (onWithRates.grades as { creditRateBps: unknown }[]).forEach((row, index) => { row.creditRateBps = [100, 150, 300, 500][index]; });
    expect(parseLoyaltyGradeBenefits(onWithRates)?.grades.map((row) => row.creditRateBps)).toEqual([100, 150, 300, 500]);

    (onWithRates.grades as { creditRateBps: unknown }[])[3].creditRateBps = 10001;
    expect(parseLoyaltyGradeBenefits(onWithRates)).toBeNull();
  });

  it('rejects a reordered, partial or malformed ladder', () => {
    const reordered = response();
    (reordered.grades as unknown[]).reverse();
    expect(parseLoyaltyGradeBenefits(reordered)).toBeNull();
    expect(parseLoyaltyGradeBenefits({ ...response(), grades: response().grades.slice(0, 3) })).toBeNull();

    const fixedWithCap = response();
    (fixedWithCap.grades as { coupons: unknown[] }[])[1].coupons = [{ ...coupon(), maxDiscountAmount: 1000 }];
    expect(parseLoyaltyGradeBenefits(fixedWithCap)).toBeNull();
    expect(parseLoyaltyGradeBenefits(null)).toBeNull();
  });
});

describe('parseLoyaltyStanding', () => {
  it('keeps the policy tiers with the progress note used by the profile strip', () => {
    const standing = parseLoyaltyStanding({
      grade: 'silver',
      windowSpend: 200000,
      windowItemCount: 2,
      policy: { tiers: TIERS, revision: 3, updatedAt: '2026-10-20T00:00:00.000Z' },
    });

    expect(standing).toEqual({
      grade: 'silver',
      windowSpend: 200000,
      windowItemCount: 2,
      nextNote: 'GOLD까지 300,000원',
      tiers: TIERS,
    });
  });

  it('refuses an unknown grade or broken totals', () => {
    const policy = { tiers: TIERS, revision: 3, updatedAt: '2026-10-20T00:00:00.000Z' };
    expect(parseLoyaltyStanding({ grade: 'vip', windowSpend: 0, windowItemCount: 0, policy })).toBeNull();
    expect(parseLoyaltyStanding({ grade: 'silver', windowSpend: -1, windowItemCount: 0, policy })).toBeNull();
  });
});

describe('grade benefit copy', () => {
  it('reads rates in percent', () => {
    expect(gradeCreditRateLabel(100)).toBe('1%');
    expect(gradeCreditRateLabel(150)).toBe('1.5%');
    expect(gradeCreditRateLabel(5)).toBe('0.05%');
  });

  it('describes benefit, condition, validity and recipient like the coupon box', () => {
    const now = new Date('2026-10-23T00:00:00.000Z');

    expect(gradeBenefitCouponCopy(coupon(), now)).toEqual({
      benefit: '₩3,000 할인',
      condition: '₩30,000 이상 구매 시',
      validity: '기한 없음',
      recipient: null,
    });
    expect(gradeBenefitCouponCopy(coupon({ benefitKind: 'shipping', minSubtotal: 0 }), now)).toMatchObject({
      benefit: '배송비 ₩3,000 할인',
      condition: '금액 제한 없음',
    });
    expect(gradeBenefitCouponCopy(coupon({ discountType: 'percent', discountValue: 10, maxDiscountAmount: 5000, validDays: 30, endsAt: '2026-12-31T14:59:59.000Z' }), now))
      .toMatchObject({ benefit: '10% 할인 (최대 ₩5,000)', validity: '지급일부터 30일 (최대 2026.12.31까지)' });
    expect(gradeBenefitCouponCopy(coupon({ startsAt: '2026-11-01T00:00:00.000Z', endsAt: '2026-11-30T14:59:59.000Z' }), now).validity)
      .toBe('2026.11.01부터 2026.11.30까지');
    expect(gradeBenefitCouponCopy(coupon({ recipientSegment: 'first_purchase' }), now).recipient).toBe('아직 구매하지 않은 회원에게만 지급돼요');
    expect(gradeBenefitCouponCopy(coupon({ recipientSegment: 'repeat_purchase' }), now).recipient).toBe('구매한 적이 있는 회원에게만 지급돼요');
  });

  it('writes the criterion from the policy and hides grades without automatic promotion', () => {
    expect(loyaltyCriterionCopy('welcome', TIERS)).toBe('가입하면 바로');
    expect(loyaltyCriterionCopy('silver', TIERS)).toBe('최근 90일 결제 금액 ₩150,000 이상 또는 굿즈 주문 항목 3건 이상');
    expect(loyaltyCriterionCopy('gold', TIERS)).toBe('최근 90일 결제 금액 ₩500,000 이상');
    expect(loyaltyCriterionCopy('platinum', TIERS)).toBeNull();
  });
});
