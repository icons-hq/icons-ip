import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COUPON_ACTION_FALLBACK_MESSAGE,
  MIN_PAYABLE_TOTAL,
  couponBenefitLabel,
  couponConditionLabel,
  couponDiscountFor,
  couponDisplayState,
  couponExpiryLabel,
  couponPreviewDiscount,
  couponSelectable,
  attachCouponPendingOrders,
  mapCouponActionError,
  parseUnpaidOrderCoupons,
  type CouponPendingOrder,
} from './coupons';

function noEnd(expiresAt: string | null) {
  return { coupon: { endsAt: null }, expiresAt };
}

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
    expect(couponDisplayState({ status: 'used', ...noEnd(null) }, base)).toBe('used');
  });

  it('derives expiry from the issued snapshot without a batch job', () => {
    expect(couponDisplayState({ status: 'active', ...noEnd('2026-08-30T00:00:00Z') }, base)).toBe('expired');
    expect(couponDisplayState({ status: 'active', ...noEnd('2026-09-01T00:00:00Z') }, base)).toBe('usable');
    expect(couponDisplayState({ status: 'active', ...noEnd(null) }, base)).toBe('usable');
  });

  it('honours a definition deadline the admin shortened after issuance', () => {
    /* RPC(evaluate)는 정의 마감도 본다 — 표시가 발급 스냅만 보면 "사용 가능"이 주문 거부로 끝난다. */
    expect(couponDisplayState({
      status: 'active',
      expiresAt: '2026-12-31T00:00:00Z',
      coupon: { endsAt: '2026-08-30T00:00:00Z' },
    }, base)).toBe('expired');
  });
});

/* QA1 S-D2-08: 결제 대기 주문이 잡은(사용 처리된) 쿠폰은 '사용 완료'가 아니고, 다음 새 주문이 닫을 주문이면 고를 수 있다. */
describe('결제를 마치지 않은 주문이 잡은 쿠폰', () => {
  const base = Date.parse('2026-08-31T00:00:00Z');
  const cardHold: CouponPendingOrder = { orderId: '33333333-3333-4333-8333-333333333333', orderNumber: '2026083100000001', paymentMethod: 'card', replaceable: true };
  const held = { status: 'used' as const, ...noEnd(null), pendingOrder: cardHold };

  it('사용 처리됐어도 그 주문이 결제 전이면 pending이다', () => {
    expect(couponDisplayState(held, base)).toBe('pending');
    expect(couponDisplayState({ ...held, pendingOrder: null }, base)).toBe('used');
  });

  it('다음 새 주문이 닫을 결제 대기 카드 주문의 쿠폰만 고를 수 있고, 그 주문을 닫은 뒤의 기간도 본다', () => {
    expect(couponSelectable(held, base)).toBe(true);
    expect(couponSelectable({ ...held, pendingOrder: { ...cardHold, replaceable: false } }, base)).toBe(false);
    expect(couponSelectable({ ...held, pendingOrder: { ...cardHold, paymentMethod: 'bank_transfer', replaceable: false } }, base)).toBe(false);
    expect(couponSelectable({ ...held, ...noEnd('2026-08-30T00:00:00Z') }, base)).toBe(false);
    expect(couponSelectable({ status: 'used', ...noEnd(null) }, base)).toBe(false);
    expect(couponSelectable({ status: 'active', ...noEnd(null) }, base)).toBe(true);
  });

  it('응답을 쿠폰별로 읽고 무통장 주문은 넘길 수 없는 것으로 접는다', () => {
    const holds = parseUnpaidOrderCoupons([
      { userCouponId: '11111111-1111-4111-8111-111111111111', orderId: cardHold.orderId.toUpperCase(), orderNumber: cardHold.orderNumber, paymentMethod: 'card', replaceable: true },
      { userCouponId: '22222222-2222-4222-8222-222222222222', orderId: cardHold.orderId, orderNumber: null, paymentMethod: 'bank_transfer', replaceable: true },
    ]);
    expect(holds?.get('11111111-1111-4111-8111-111111111111')).toEqual(cardHold);
    expect(holds?.get('22222222-2222-4222-8222-222222222222')?.replaceable).toBe(false);
    expect(parseUnpaidOrderCoupons([{ userCouponId: 'x', orderId: cardHold.orderId, orderNumber: null, paymentMethod: 'card', replaceable: true }])).toBeNull();
    expect(parseUnpaidOrderCoupons([{ userCouponId: '11111111-1111-4111-8111-111111111111', orderId: cardHold.orderId, orderNumber: null, paymentMethod: 'cash', replaceable: true }])).toBeNull();
    expect(parseUnpaidOrderCoupons({})).toBeNull();
  });

  it('사용 처리된 쿠폰에만 그 주문을 붙인다', () => {
    const used = { id: '11111111-1111-4111-8111-111111111111', status: 'used' as const, issuedAt: '2026-08-01T00:00:00Z', expiresAt: null, usedAt: '2026-08-30T00:00:00Z',
      coupon: { code: 'CPNFIX5K', name: '5천원', discountType: 'fixed' as const, discountValue: 5000, maxDiscountAmount: null, minSubtotal: 0, endsAt: null, gradeBenefit: null } };
    const active = { ...used, id: '22222222-2222-4222-8222-222222222222', status: 'active' as const, usedAt: null };
    const holds = new Map([[used.id, cardHold], [active.id, cardHold]]);
    const [first, second] = attachCouponPendingOrders([used, active], holds);
    expect(first.pendingOrder).toEqual(cardHold);
    expect(second.pendingOrder).toBeUndefined();
    expect(attachCouponPendingOrders([used], null)[0].pendingOrder).toBeUndefined();
  });

  it('미리보기 할인도 넘길 수 있는 쿠폰이면 계산한다', () => {
    const coupon = { code: 'CPNFIX5K', name: '5천원', discountType: 'fixed' as const, discountValue: 5000, maxDiscountAmount: null, minSubtotal: 0, endsAt: null, gradeBenefit: null };
    expect(couponPreviewDiscount({ status: 'used', expiresAt: null, coupon, pendingOrder: cardHold }, 20000, 3000, base)).toBe(5000);
    expect(couponPreviewDiscount({ status: 'used', expiresAt: null, coupon, pendingOrder: { ...cardHold, replaceable: false } }, 20000, 3000, base)).toBe(0);
  });
});

describe('couponPreviewDiscount payment floor', () => {
  const fullCoupon = {
    status: 'active' as const,
    expiresAt: null,
    coupon: {
      code: 'CPNFULL',
      name: '전액 쿠폰',
      discountType: 'fixed' as const,
      discountValue: 70000,
      maxDiscountAmount: null,
      minSubtotal: 0,
      endsAt: null,
      gradeBenefit: null,
    },
  };

  it('caps the preview so the total never drops below the provider minimum', () => {
    /* 무료배송 70,000 카트 + 70,000 전액 쿠폰 → 총액 1,000원이 되도록 69,000만 깎는다. */
    expect(couponPreviewDiscount(fullCoupon, 70000, 0)).toBe(70000 - MIN_PAYABLE_TOTAL);
  });
  it('requires a server quote for category coupons instead of discounting the entire cart', () => {
    expect(couponPreviewDiscount({ ...fullCoupon, coupon: { ...fullCoupon.coupon, goodsScope: 'selected_categories', targetCategoryIds: ['ca109300-0000-4000-8000-000000000001'] } }, 70000, 0)).toBe(0);
    expect(couponConditionLabel({ goodsScope: 'selected_categories', minSubtotal: 0 })).toBe('선택한 카테고리의 굿즈에만 사용');
  });
  it('requires a server quote for IP coupons and states the IP-only minimum', () => {
    expect(couponPreviewDiscount({ ...fullCoupon, coupon: { ...fullCoupon.coupon, goodsScope: 'selected_ips', targetIpIds: ['maple'] } }, 70000, 0)).toBe(0);
    expect(couponConditionLabel({ goodsScope: 'selected_ips', minSubtotal: 0 })).toBe('선택한 IP의 굿즈에만 사용');
    expect(couponConditionLabel({ goodsScope: 'selected_ips', minSubtotal: 50000 })).toBe('대상 굿즈 합계 ₩50,000 이상 구매 시');
  });

  it('keeps the pin between app constant and the SQL guard/cap', () => {
    const dir = join(process.cwd(), 'supabase/migrations');
    const files = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort();

    let cap: number | null = null;
    let guard: number | null = null;
    for (const name of files) {
      const sql = readFileSync(join(dir, name), 'utf8');
      const capMatch = sql.match(/c_min_payable_total\s+constant\s+bigint\s*:=\s*(\d+)/);
      const guardMatch = sql.match(/new\.total < (\d+) then\s*\n\s*raise check_violation using message = 'payment amount below provider minimum'/);
      if (capMatch) cap = Number(capMatch[1]);
      if (guardMatch) guard = Number(guardMatch[1]);
    }

    expect(cap, 'place_order 의 c_min_payable_total 을 찾지 못했다').not.toBeNull();
    expect(guard, 'korpay 최소 금액 가드를 찾지 못했다').not.toBeNull();
    expect(cap).toBe(MIN_PAYABLE_TOTAL);
    expect(guard).toBe(MIN_PAYABLE_TOTAL);
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

  it('formats the expiry line from the effective deadline', () => {
    expect(couponExpiryLabel(noEnd(null))).toBe('기한 없음');
    expect(couponExpiryLabel(noEnd('2026-09-30T14:59:59Z'))).toMatch(/^2026\.\d{2}\.\d{2}까지$/);
    /* 정의 마감이 발급 스냅보다 이르면 그쪽이 실효 기한이다. */
    expect(couponExpiryLabel({
      expiresAt: '2026-12-31T00:00:00Z',
      coupon: { endsAt: '2026-01-15T00:00:00Z' },
    })).toBe('2026.01.15까지');
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
