import { describe, expect, it } from 'vitest';
import {
  COUPON_ACTION_FALLBACK_MESSAGE,
  couponBenefitLabel,
  couponConditionLabel,
  couponDiscountFor,
  couponDisplayState,
  couponExpiryLabel,
  mapCouponActionError,
} from './coupons';

/* 대표 케이스의 기대값은 coupon_redemption.sql 스모크와 같은 숫자다.
   여기 계산이 SQL 과 어긋나면 카트 미리보기와 청구액이 달라진다. */
describe('couponDiscountFor', () => {
  it('caps a fixed discount at the subtotal (CPNBIG: 50,000 off a 30,000 cart)', () => {
    expect(couponDiscountFor(
      { discountType: 'fixed', discountValue: 50000, maxDiscountAmount: null },
      30000,
    )).toBe(30000);
  });

  it('applies a fixed discount below the subtotal (CPNFIX5K on 30,000)', () => {
    expect(couponDiscountFor(
      { discountType: 'fixed', discountValue: 5000, maxDiscountAmount: null },
      30000,
    )).toBe(5000);
  });

  it('computes a percent discount under the cap (CPNPCT10 on 70,000)', () => {
    expect(couponDiscountFor(
      { discountType: 'percent', discountValue: 10, maxDiscountAmount: 8000 },
      70000,
    )).toBe(7000);
  });

  it('clamps a percent discount to its cap (CPNPCT10 on 90,000)', () => {
    expect(couponDiscountFor(
      { discountType: 'percent', discountValue: 10, maxDiscountAmount: 8000 },
      90000,
    )).toBe(8000);
  });

  it('floors percent math like the SQL integer division', () => {
    expect(couponDiscountFor(
      { discountType: 'percent', discountValue: 10, maxDiscountAmount: null },
      10005,
    )).toBe(1000);
  });

  it('never discounts an empty subtotal', () => {
    expect(couponDiscountFor(
      { discountType: 'fixed', discountValue: 5000, maxDiscountAmount: null },
      0,
    )).toBe(0);
  });
});

describe('couponDisplayState', () => {
  const base = Date.parse('2026-08-31T00:00:00Z');

  it('marks used coupons regardless of expiry', () => {
    expect(couponDisplayState({ status: 'used', expiresAt: null }, base)).toBe('used');
  });

  it('derives expiry from the issued snapshot without a batch job', () => {
    expect(couponDisplayState({ status: 'active', expiresAt: '2026-08-30T00:00:00Z' }, base)).toBe('expired');
    expect(couponDisplayState({ status: 'active', expiresAt: '2026-09-01T00:00:00Z' }, base)).toBe('usable');
    expect(couponDisplayState({ status: 'active', expiresAt: null }, base)).toBe('usable');
  });
});

describe('coupon labels', () => {
  it('describes benefits for both discount types', () => {
    expect(couponBenefitLabel({ discountType: 'fixed', discountValue: 5000, maxDiscountAmount: null }))
      .toBe('₩5,000 할인');
    expect(couponBenefitLabel({ discountType: 'percent', discountValue: 10, maxDiscountAmount: 8000 }))
      .toBe('10% 할인 (최대 ₩8,000)');
    expect(couponBenefitLabel({ discountType: 'percent', discountValue: 10, maxDiscountAmount: null }))
      .toBe('10% 할인');
  });

  it('describes the minimum subtotal condition', () => {
    expect(couponConditionLabel({ minSubtotal: 20000 })).toBe('₩20,000 이상 구매 시');
    expect(couponConditionLabel({ minSubtotal: 0 })).toBe('금액 제한 없음');
  });

  it('formats the expiry line', () => {
    expect(couponExpiryLabel({ expiresAt: null })).toBe('기한 없음');
    expect(couponExpiryLabel({ expiresAt: '2026-09-30T14:59:59Z' })).toMatch(/^2026\.\d{2}\.\d{2}까지$/);
  });
});

describe('mapCouponActionError', () => {
  it('translates every domain rejection the RPCs raise', () => {
    expect(mapCouponActionError('coupon_not_found')).toContain('찾을 수 없');
    expect(mapCouponActionError('coupon_not_started')).toContain('시작되지 않은');
    expect(mapCouponActionError('coupon_expired')).toContain('기간이 지난');
    expect(mapCouponActionError('coupon_exhausted')).toContain('소진');
    expect(mapCouponActionError('coupon_min_subtotal')).toContain('최소 주문 금액');
    expect(mapCouponActionError('coupon_not_owned')).toContain('보유하지 않은');
    expect(mapCouponActionError('coupon_already_used')).toContain('이미 사용한');
  });

  it('folds unknown failures into the generic message', () => {
    expect(mapCouponActionError('boom')).toBe(COUPON_ACTION_FALLBACK_MESSAGE);
    expect(mapCouponActionError(undefined)).toBe(COUPON_ACTION_FALLBACK_MESSAGE);
  });
});
