import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { GradeBenefitCoupon, LoyaltyGradeBenefits, MyLoyaltyStanding } from '@/lib/loyalty-benefits';
import { MyGradeBenefits } from './MyGradeBenefits';

vi.mock('@/components/shell/CardRewardAvailability', () => ({ useCardRewardsEnabled: () => false }));

const NOW = new Date('2026-10-23T00:00:00.000Z');

function coupon(overrides: Partial<GradeBenefitCoupon> = {}): GradeBenefitCoupon {
  return {
    name: '골드 승급 쿠폰',
    benefitKind: 'goods',
    discountType: 'fixed',
    discountValue: 5000,
    maxDiscountAmount: null,
    minSubtotal: 50000,
    goodsScope: 'all',
    recipientSegment: 'all',
    startsAt: '2026-10-01T00:00:00.000Z',
    endsAt: null,
    validDays: 30,
    ...overrides,
  };
}

const standing: MyLoyaltyStanding = {
  grade: 'silver',
  windowSpend: 200000,
  windowItemCount: 2,
  nextNote: 'GOLD까지 300,000원',
  tiers: [
    { grade: 'silver', enabled: true, amount: 150000, itemCount: 3 },
    { grade: 'gold', enabled: true, amount: 500000, itemCount: null },
    { grade: 'platinum', enabled: false, amount: null, itemCount: null },
  ],
};

const SILVER_COUPON = coupon({ name: '실버 승급 쿠폰', discountValue: 3000, minSubtotal: 30000 });
const GOLD_COUPONS = [coupon(), coupon({ name: '골드 배송비 쿠폰', benefitKind: 'shipping', discountValue: 3000, minSubtotal: 0, validDays: null })];

/* SILVER 회원이 받는 응답 — GOLD·PLATINUM 은 오르지 않은 등급이라 쿠폰 내용 없이 종류별 장수만 온다. */
const benefits: LoyaltyGradeBenefits = {
  creditRatesEnabled: true,
  grades: [
    { grade: 'welcome', reached: true, creditRateBps: 0, couponCounts: { goods: 0, shipping: 0 }, coupons: [] },
    { grade: 'silver', reached: true, creditRateBps: 100, couponCounts: { goods: 1, shipping: 0 }, coupons: [SILVER_COUPON] },
    { grade: 'gold', reached: false, creditRateBps: 150, couponCounts: { goods: 1, shipping: 1 }, coupons: [] },
    { grade: 'platinum', reached: false, creditRateBps: 300, couponCounts: { goods: 0, shipping: 0 }, coupons: [] },
  ],
};

/* 최상위 회원이 받는 응답 — 네 등급 모두 내용이 온다. */
const platinumBenefits: LoyaltyGradeBenefits = {
  ...benefits,
  grades: [
    benefits.grades[0],
    benefits.grades[1],
    { grade: 'gold', reached: true, creditRateBps: 150, couponCounts: { goods: 1, shipping: 1 }, coupons: GOLD_COUPONS },
    { grade: 'platinum', reached: true, creditRateBps: 300, couponCounts: { goods: 0, shipping: 0 }, coupons: [] },
  ],
};

/* 등급 적립이 꺼진 기본 정책 — 적립률은 전부 null 이다. */
const ratesOff: LoyaltyGradeBenefits = {
  creditRatesEnabled: false,
  grades: benefits.grades.map((row) => ({ ...row, creditRateBps: null })),
};

function render(props: Partial<React.ComponentProps<typeof MyGradeBenefits>> = {}) {
  return renderToStaticMarkup(<MyGradeBenefits benefits={benefits} now={NOW} standing={standing} {...props} />);
}

describe('MyGradeBenefits', () => {
  it('sits in the mypage shell with its own menu entry marked current', () => {
    const html = render();

    expect(html).toContain('>회원 등급 혜택</h1>');
    expect(html).toContain('aria-label="마이페이지 메뉴"');
    expect(html).toMatch(/href="\/my\/grade-benefits"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/my\/grade-benefits"/);
    expect(html.indexOf('href="/my/grade-benefits"')).toBeLessThan(html.indexOf('href="/my/coupons"'));
  });

  it('lists each operated grade with its criterion and benefits, marking my grade', () => {
    const html = render();

    expect(html).toContain('<table class="wc-grade-benefits__table"');
    expect(html).toContain('최근 90일 결제 금액 ₩150,000 이상 또는 굿즈 주문 항목 3건 이상');
    expect(html).toContain('최근 90일 결제 금액 ₩500,000 이상');
    expect(html).toContain('가입하면 바로');
    expect(html).toContain('내 등급 · GOLD까지 300,000원');
    expect(html).toContain('wc-mypage__tier-badge--gold');
    /* 자동 승급을 운영하지 않는 등급은 내 등급이 아니면 행을 세우지 않는다. */
    expect(html).not.toContain('wc-mypage__tier-badge--platinum');
    expect(html).not.toContain('구매 금액의 3% 적립금');
  });

  it('describes coupon benefits without codes and rates only when they are paid out', () => {
    const html = render({ benefits: platinumBenefits, standing: { ...standing, grade: 'gold', nextNote: null } });

    expect(html).toContain('<strong>골드 승급 쿠폰</strong> · ₩5,000 할인');
    expect(html).toContain('₩50,000 이상 구매 시 · 사용 기간 지급일부터 30일');
    expect(html).toContain('배송비 ₩3,000 할인');
    expect(html).toContain('구매 금액의 1.5% 적립금');
    expect(html).toContain('구매 금액의 1% 적립금');
    /* 0% 는 혜택이 아니다 — WELCOME 은 혜택 없음으로 읽힌다. */
    expect(html).not.toContain('구매 금액의 0% 적립금');
    expect(html).toContain('지금은 이 등급에 지급 중인 혜택이 없어요.');
  });

  /* 코드 입력 발급은 회원 등급을 묻지 않는다 — 오르지 않은 등급은 쿠폰 이름·금액 대신 종류별 장수만 보여 준다. */
  it('shows only coupon counts for grades the member has not reached', () => {
    const html = render();

    expect(html).toContain('<strong>실버 승급 쿠폰</strong> · ₩3,000 할인');
    expect(html).toContain('<strong>굿즈 할인 쿠폰 1장</strong>');
    expect(html).toContain('<strong>배송비 할인 쿠폰 1장</strong>');
    expect(html).toContain('쿠폰 내용은 이 등급에 오르면 쿠폰함에서 확인할 수 있어요');
    expect(html).not.toContain('골드 승급 쿠폰');
    expect(html).not.toContain('골드 배송비 쿠폰');
    expect(html).not.toContain('₩50,000 이상 구매 시');
    /* 적립률은 공개 정책이라 오르지 않은 등급에도 그대로 쓴다. */
    expect(html).toContain('구매 금액의 1.5% 적립금');
  });

  it('keeps a manually held grade row even without automatic promotion', () => {
    const html = render({ benefits: platinumBenefits, standing: { ...standing, grade: 'platinum', nextNote: null } });

    expect(html).toContain('wc-mypage__tier-badge--platinum');
    expect(html).toContain('지금은 자동으로 오르는 기준이 없는 등급이에요');
    expect(html).toContain('구매 금액의 3% 적립금');
  });

  it('says where it could not read instead of inventing values', () => {
    const noBenefits = render({ benefits: null });
    expect(noBenefits).toContain('혜택 정보를 확인하지 못했어요');
    expect(noBenefits).toContain('최근 90일 결제 금액 ₩150,000 이상');

    const noStanding = render({ standing: null });
    expect(noStanding).toContain('기준을 확인하지 못했어요');
    expect(noStanding).toContain('wc-mypage__tier-badge--platinum');
    expect(noStanding).not.toContain('내 등급');

    const nothing = render({ benefits: null, standing: null });
    expect(nothing).toContain('role="alert"');
    expect(nothing).not.toContain('<table');
  });

  /* 표가 적립률 줄을 하나도 그리지 않으면(등급 적립 꺼짐 — 기본 정책) 안내도 등급 적립금을 약속하지 않는다. */
  it('mentions grade credit limits only while the table shows a grade credit rate', () => {
    const LIMIT_NOTE = '등급 적립금은 기본 적립금 정책의 주문당·보유 한도 안에서 쌓여요.';

    const off = render({ benefits: ratesOff });
    expect(off).not.toContain('적립금</strong>');
    expect(off).not.toContain(LIMIT_NOTE);
    expect(off).toContain('쿠폰마다 한 번만 지급');

    const zeroRates: LoyaltyGradeBenefits = { ...benefits, grades: benefits.grades.map((row) => ({ ...row, creditRateBps: 0 })) };
    expect(render({ benefits: zeroRates })).not.toContain(LIMIT_NOTE);
    expect(render({ benefits: null })).not.toContain(LIMIT_NOTE);

    expect(render()).toContain(LIMIT_NOTE);
  });

  it('leads to the coupon box and keeps the guide, using member-grade vocabulary only', () => {
    const html = render();

    expect(html).toContain('href="/my/coupons"');
    expect(html).toContain('등급 혜택 쿠폰 확인');
    expect(html).toContain('등급 산정 기준');
    expect(html).toContain('쿠폰마다 한 번만 지급');
    for (const banned of ['멤버십', 'VIP', '티어', '상품', '가챠', '뽑기', '충전']) expect(html).not.toContain(banned);
  });
});
