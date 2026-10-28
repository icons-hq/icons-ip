import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { UserCouponSummary } from '@/lib/coupons';
import { MyCoupons, type MyCouponsCheckoutRules } from './MyCoupons';

vi.mock('@/components/shell/CardRewardAvailability', () => ({
  useCardRewardsEnabled: () => true,
}));

const LEGACY: MyCouponsCheckoutRules = { transactionMode: 'legacy', couponPolicy: null };

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
      <MyCoupons checkoutRules={LEGACY} coupons={[heldCoupon({ id: 'a' })]} />,
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
        checkoutRules={LEGACY}
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

  it('정의가 변경되어도 발급 당시 시작과 만료를 KST로 표시한다', () => {
    const coupon = heldCoupon({ id: 'snapshot', expiresAt: '2026-10-20T14:59:00Z' });
    coupon.usableFrom = '2026-10-13T15:00:00Z';
    coupon.coupon = { ...coupon.coupon, startsAt: '2026-10-15T15:00:00Z', endsAt: '2026-10-25T14:59:00Z', usesValiditySnapshot: true };
    const html = renderToStaticMarkup(<MyCoupons checkoutRules={LEGACY} coupons={[coupon]} />);
    expect(html).toContain('2026.10.14 00:00 ~ 2026.10.20 23:59 (KST)');
    expect(html).not.toContain('2026.10.16');
    expect(html).not.toContain('2026.10.25');
  });

  it('등급 혜택 쿠폰은 등급 뱃지 색 변종을 단다', () => {
    const html = renderToStaticMarkup(
      <MyCoupons checkoutRules={LEGACY} coupons={[heldCoupon({ id: 'g', gradeBenefit: 'gold', name: 'GOLD 달성 쿠폰' })]} />,
    );

    expect(html).toContain('wc-coupon-card__badge--gold');
    expect(html).toContain('GOLD');
  });

  /* 코드 입력 발급은 회원 등급을 묻지 않는다 — 보유한 등급 쿠폰 코드로 상위 등급 코드 규칙을 짐작하지 못하게 한다. */
  it('등급 혜택 쿠폰은 코드 줄을 그리지 않고 일반 쿠폰은 코드를 보여 준다', () => {
    const html = renderToStaticMarkup(
      <MyCoupons
        checkoutRules={LEGACY}
        coupons={[
          heldCoupon({ id: 'g', gradeBenefit: 'silver', name: 'SILVER 달성 쿠폰' }),
          heldCoupon({ id: 'plain', name: '일반 쿠폰' }),
        ]}
      />,
    );
    const cards = html.split('<li class="wc-coupon-card').slice(1);

    expect(cards).toHaveLength(2);
    expect(cards[0]).toContain('SILVER 달성 쿠폰');
    expect(cards[0]).not.toContain('wc-coupon-card__code');
    expect(cards[0]).not.toContain('CPNFIX5K');
    expect(cards[1]).toContain('<p class="wc-coupon-card__code">CPNFIX5K</p>');
  });

  it('빈 쿠폰함은 카트의 코드 입력으로 안내한다', () => {
    const html = renderToStaticMarkup(<MyCoupons checkoutRules={LEGACY} coupons={[]} />);

    expect(html).toContain('보유한 쿠폰이 없어요');
    expect(html).toContain('href="/cart"');
    expect(html).not.toContain('wc-coupon-card ');
  });

  /* MY-14(11 §5.4): 사용조건 값만 굵게, 안내 박스는 굵은 소제목 두 묶음. */
  it('사용조건 값을 강조하고 안내를 쿠폰 안내·취소·반품 안내 두 묶음으로 나눈다', () => {
    const html = renderToStaticMarkup(<MyCoupons checkoutRules={LEGACY} coupons={[heldCoupon({ id: 'a' })]} />);
    const guide = html.slice(html.indexOf('wc-coupon-guide'));

    expect(html).toContain('<dt>사용조건</dt><dd class="wc-coupon-card__condition">₩20,000 이상 구매 시</dd>');
    expect(guide.indexOf('<p>쿠폰 안내</p>')).toBeLessThan(guide.indexOf('<p>취소·반품 안내</p>'));
    expect(guide.slice(guide.indexOf('<p>취소·반품 안내</p>'))).toContain('주문 취소가 확정되면 사용한 쿠폰이 돌아옵니다.');
  });

  it('정책 안내 박스를 늘 남긴다', () => {
    const html = renderToStaticMarkup(<MyCoupons checkoutRules={LEGACY} coupons={[]} />);

    /* R25: 운영 주문서(legacy)는 주문 1건에 굿즈 쿠폰 1장이고 배송비 쿠폰 선택을 받지 않는다 — 사실대로 안내한다. */
    expect(html).toContain('장바구니와 주문서에서 보유 쿠폰을 고르거나 코드를 입력할 수 있어요.');
    expect(html).toContain('한 주문에 굿즈 쿠폰 1장을 쓸 수 있어요.');
    expect(html).toContain('배송비 쿠폰은 지금 주문에 쓸 수 없어요.');
    expect(html).not.toContain('주문서에서 굿즈 쿠폰의 적용 순서');
  });
});

/* R25: 쿠폰 안내는 지금 주문서 계약을 따른다 — 거래 런타임이 켜지면 주문서가 쿠폰 조합 정책대로 굿즈 쿠폰 여러 장·배송비 쿠폰을 받는다. */
describe('MyCoupons 쿠폰 안내 — 주문서 계약', () => {
  const guide = (checkoutRules: MyCouponsCheckoutRules) => {
    const html = renderToStaticMarkup(<MyCoupons checkoutRules={checkoutRules} coupons={[]} />);
    return html.slice(html.indexOf('wc-coupon-guide'), html.indexOf('<p>취소·반품 안내</p>'));
  };
  const policy = (stackingEnabled: boolean, maxGoodsCoupons: number, shippingEnabled: boolean) => ({ revision: 1, stackingEnabled, maxGoodsCoupons, shippingEnabled });

  it('중복 사용·배송비 쿠폰이 켜진 거래 런타임이면 여러 장과 배송비 쿠폰을 안내하고 쓸 수 없다고 하지 않는다', () => {
    const text = guide({ transactionMode: 'transaction', couponPolicy: policy(true, 3, true) });
    expect(text).toContain('장바구니에서 굿즈 쿠폰을 미리 고르거나 코드를 입력하고, 주문서에서 함께 쓸 쿠폰을 확정해요.');
    expect(text).toContain('중복 사용을 허용한 쿠폰끼리 굿즈 쿠폰 최대 3장과 배송비 쿠폰 1장을 함께 쓸 수 있어요.');
    expect(text).toContain('굿즈 쿠폰은 남은 굿즈 금액에, 배송비 쿠폰은 선결제 운송비에 적용돼요. 설치비와 착불 운송비는 배송비 할인에서 제외됩니다.');
    expect(text).not.toContain('배송비 쿠폰은 지금 주문에 쓸 수 없어요');
    expect(text).not.toContain('한 주문에 굿즈 쿠폰 1장을 쓸 수 있어요');
  });

  it('중복 사용이 꺼져 있으면 굿즈·배송비 쿠폰 중 1장이라고 알린다', () => {
    const text = guide({ transactionMode: 'transaction', couponPolicy: policy(false, 1, true) });
    expect(text).toContain('한 주문에 굿즈 쿠폰 또는 배송비 쿠폰 1장을 쓸 수 있어요.');
    expect(text).toContain('배송비 쿠폰은 선결제 운송비에 적용돼요.');
  });

  it('배송비 쿠폰이 꺼져 있으면 굿즈 쿠폰만 여러 장이라고 알리고 배송비 쿠폰은 쓸 수 없다고 한다', () => {
    const text = guide({ transactionMode: 'transaction', couponPolicy: policy(true, 2, false) });
    expect(text).toContain('중복 사용을 허용한 굿즈 쿠폰끼리 최대 2장까지 함께 쓸 수 있어요.');
    expect(text).toContain('굿즈 쿠폰은 대상 굿즈 금액에 적용돼요. 배송비 쿠폰은 지금 주문에 쓸 수 없어요.');
  });

  it('최대 1장이면 굿즈 쿠폰 1장으로 알린다', () => {
    expect(guide({ transactionMode: 'transaction', couponPolicy: policy(true, 1, false) })).toContain('한 주문에 굿즈 쿠폰 1장을 쓸 수 있어요.');
    expect(guide({ transactionMode: 'transaction', couponPolicy: policy(false, 1, false) })).toContain('한 주문에 굿즈 쿠폰 1장을 쓸 수 있어요.');
  });

  it.each([
    ['정책 미확인', { transactionMode: 'transaction', couponPolicy: null }],
    ['런타임 미확인', { transactionMode: 'unavailable', couponPolicy: null }],
  ] as const)('%s이면 장수·배송비 쿠폰을 단정하지 않고 주문서에서 확인하라고 한다', (_label, checkoutRules) => {
    const text = guide(checkoutRules);
    expect(text).toContain('함께 쓸 수 있는 쿠폰 수와 배송비 쿠폰 사용 여부는 주문서에서 확인해주세요.');
    expect(text).not.toContain('배송비 쿠폰은 지금 주문에 쓸 수 없어요');
    expect(text).not.toContain('한 주문에 굿즈 쿠폰 1장');
  });
});
