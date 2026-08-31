import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { UserCouponSummary } from '@/lib/coupons';
import { MyCoupons } from './MyCoupons';

vi.mock('@/components/shell/CardRewardAvailability', () => ({
  useCardRewardsEnabled: () => true,
}));

function heldCoupon(overrides: {
  id: string;
  status?: 'active' | 'used';
  expiresAt?: string | null;
  usedAt?: string | null;
  gradeBenefit?: string | null;
  name?: string;
}): UserCouponSummary {
  return {
    id: overrides.id,
    status: overrides.status ?? 'active',
    issuedAt: '2026-08-01T00:00:00Z',
    expiresAt: overrides.expiresAt ?? null,
    usedAt: overrides.usedAt ?? null,
    coupon: {
      code: 'CPNFIX5K',
      name: overrides.name ?? '5천원 할인',
      discountType: 'fixed',
      discountValue: 5000,
      maxDiscountAmount: null,
      minSubtotal: 20000,
      endsAt: overrides.expiresAt ?? null,
      gradeBenefit: overrides.gradeBenefit ?? null,
    },
  };
}

describe('MyCoupons 티켓 카드', () => {
  it('보유 쿠폰을 코드·이름·혜택·기간·조건 순으로 그린다', () => {
    const html = renderToStaticMarkup(
      <MyCoupons coupons={[heldCoupon({ id: 'a' })]} />,
    );

    expect(html).toContain('wc-coupon-card');
    expect(html).toContain('CPNFIX5K');
    expect(html).toContain('5천원 할인');
    expect(html).toContain('₩5,000 할인');
    expect(html).toContain('유효기간');
    expect(html).toContain('기한 없음');
    expect(html).toContain('₩20,000 이상 구매 시');
    expect(html).toContain('사용 가능');
  });

  it('사용·만료 상태를 구분해 표기한다', () => {
    const html = renderToStaticMarkup(
      <MyCoupons
        coupons={[
          heldCoupon({ id: 'used', status: 'used', usedAt: '2026-08-10T00:00:00Z' }),
          heldCoupon({ id: 'expired', expiresAt: '2020-01-01T00:00:00Z' }),
        ]}
      />,
    );

    expect(html).toContain('wc-coupon-card--used');
    expect(html).toContain('사용 완료');
    expect(html).toContain('wc-coupon-card--expired');
    expect(html).toContain('기간 만료');
  });

  it('등급 혜택 쿠폰은 등급 뱃지 색 변종을 단다', () => {
    const html = renderToStaticMarkup(
      <MyCoupons coupons={[heldCoupon({ id: 'g', gradeBenefit: 'gold', name: 'GOLD 달성 쿠폰' })]} />,
    );

    expect(html).toContain('wc-coupon-card__badge--gold');
    expect(html).toContain('GOLD');
  });

  it('빈 쿠폰함은 카트의 코드 입력으로 안내한다', () => {
    const html = renderToStaticMarkup(<MyCoupons coupons={[]} />);

    expect(html).toContain('보유한 쿠폰이 없어요');
    expect(html).toContain('href="/cart"');
    expect(html).not.toContain('wc-coupon-card ');
  });

  it('정책 안내 박스를 늘 남긴다', () => {
    const html = renderToStaticMarkup(<MyCoupons coupons={[]} />);

    expect(html).toContain('주문 한 건에는 쿠폰 한 장만');
    expect(html).toContain('배송비는 제외');
  });
});
