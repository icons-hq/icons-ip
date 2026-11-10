import { couponBenefitLabel, couponConditionLabel } from './coupons';
import { krw } from './format';
import { LOYALTY_GRADES, LOYALTY_WINDOW_DAYS, isLoyaltyGrade, type LoyaltyGrade } from './loyalty';
import { loyaltyProgressNote, parseLoyaltyPolicy, type LoyaltyCriterion } from './loyalty-policy';

/* 회원 등급 혜택 안내(/my/grade-benefits · LFS 패리티 2차 L6 · MY-05)의 읽기 모델.
 *
 * 등급별 혜택은 public.get_loyalty_grade_benefits()가 정본이다 — 지금 승급하면 지급되는 등급 혜택 쿠폰과
 * 등급 적립률(bps)만 돌려주고 쿠폰 코드는 싣지 않는다. 쿠폰 내용(이름·금액·조건·기간)은 내가 오른 등급까지만
 * 오고, 아직 오르지 않은 등급은 종류별 장수(couponCounts)만 온다 — 코드 입력 발급이 회원 등급을 묻지 않아
 * 상위 등급 쿠폰 목록을 펼치면 코드 추측 대상이 되기 때문이다. 등급 조건과 내 등급은 get_my_loyalty_status()가
 * 따로 돌려준다(loyalty-benefits.server). 이 모듈은 응답 검증과 화면 문구만 만든다 — 순수 함수라 단위 테스트한다. */

export type GradeBenefitKind = 'goods' | 'shipping';
export type GradeBenefitRecipient = 'all' | 'first_purchase' | 'repeat_purchase';
export type GradeBenefitScope = 'all' | 'selected_goods' | 'selected_categories' | 'selected_ips';

export interface GradeBenefitCoupon {
  name: string;
  benefitKind: GradeBenefitKind;
  discountType: 'fixed' | 'percent';
  discountValue: number;
  maxDiscountAmount: number | null;
  minSubtotal: number;
  goodsScope: GradeBenefitScope;
  recipientSegment: GradeBenefitRecipient;
  startsAt: string;
  endsAt: string | null;
  /** 지급일 기준 사용 일수. null 이면 정의의 사용 기간(startsAt~endsAt)을 따른다. */
  validDays: number | null;
}

export interface GradeBenefitCouponCounts {
  goods: number;
  shipping: number;
}

export interface GradeBenefitRow {
  grade: LoyaltyGrade;
  /** 내가 오른 등급(이하)인지. false 면 coupons 는 비어 있고 couponCounts 만 믿는다. */
  reached: boolean;
  /** 등급 적립률(0.01% 단위). 등급 적립이나 기본 적립금 정책이 꺼져 있으면 null 이다. */
  creditRateBps: number | null;
  /** 지급 중인 등급 혜택 쿠폰의 종류별 장수 — 오르지 않은 등급도 이것만은 안다. */
  couponCounts: GradeBenefitCouponCounts;
  /** 쿠폰 내용. 내가 오른 등급에만 실린다. */
  coupons: GradeBenefitCoupon[];
}

export interface LoyaltyGradeBenefits {
  creditRatesEnabled: boolean;
  grades: GradeBenefitRow[];
}

/** 내 등급과 등급 조건 — get_my_loyalty_status() 응답에서 화면이 쓰는 것만 남긴다. */
export interface MyLoyaltyStanding {
  grade: LoyaltyGrade;
  windowSpend: number;
  windowItemCount: number;
  /** "다음 등급까지" 한 줄. 최상위 등급이거나 다음 자동 등급이 없으면 null. */
  nextNote: string | null;
  tiers: LoyaltyCriterion[];
}

/** get_my_loyalty_status 응답 검증(프로필 스트립 로더 loadLoyaltyStatus 와 같은 판정에 정책 tiers 를 더 남긴다). */
export function parseLoyaltyStanding(data: unknown): MyLoyaltyStanding | null {
  if (!record(data) || !isLoyaltyGrade(data.grade)) return null;
  const policy = parseLoyaltyPolicy(data.policy);
  const spend = data.windowSpend;
  const count = data.windowItemCount;
  if (!policy || typeof spend !== 'number' || !Number.isSafeInteger(spend) || spend < 0
    || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return null;
  return {
    grade: data.grade,
    windowSpend: spend,
    windowItemCount: count,
    nextNote: loyaltyProgressNote(data.grade, spend, count, policy.tiers),
    tiers: policy.tiers,
  };
}

const MAX_MONEY = 2_147_483_647;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function wholeNumber(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

function instant(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function parseCoupon(value: unknown): GradeBenefitCoupon | null {
  if (!record(value)) return null;
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name || name.length > 80) return null;
  if (value.benefitKind !== 'goods' && value.benefitKind !== 'shipping') return null;
  if (value.discountType !== 'fixed' && value.discountType !== 'percent') return null;
  if (!wholeNumber(value.discountValue, 1, value.discountType === 'percent' ? 100 : MAX_MONEY)) return null;
  if (value.maxDiscountAmount !== null && !wholeNumber(value.maxDiscountAmount, 1, MAX_MONEY)) return null;
  if (value.discountType === 'fixed' && value.maxDiscountAmount !== null) return null;
  if (!wholeNumber(value.minSubtotal, 0, MAX_MONEY)) return null;
  if (value.goodsScope !== 'all' && value.goodsScope !== 'selected_goods' && value.goodsScope !== 'selected_categories' && value.goodsScope !== 'selected_ips') return null;
  if (value.recipientSegment !== 'all' && value.recipientSegment !== 'first_purchase' && value.recipientSegment !== 'repeat_purchase') return null;
  if (!instant(value.startsAt) || (value.endsAt !== null && !instant(value.endsAt))) return null;
  if (value.validDays !== null && !wholeNumber(value.validDays, 1, 365)) return null;
  /* 코드는 응답에 없어야 한다 — 실려 오면 계약이 깨진 것이다(코드 입력 발급은 등급을 묻지 않는다). */
  if ('code' in value) return null;
  return {
    name,
    benefitKind: value.benefitKind,
    discountType: value.discountType,
    discountValue: value.discountValue,
    maxDiscountAmount: value.maxDiscountAmount as number | null,
    minSubtotal: value.minSubtotal,
    goodsScope: value.goodsScope,
    recipientSegment: value.recipientSegment,
    startsAt: value.startsAt,
    endsAt: value.endsAt as string | null,
    validDays: value.validDays as number | null,
  };
}

/** get_loyalty_grade_benefits 응답 검증. 하나라도 어긋나면 null — 잘못된 혜택을 약속하지 않는다. */
export function parseLoyaltyGradeBenefits(value: unknown): LoyaltyGradeBenefits | null {
  if (!record(value) || typeof value.creditRatesEnabled !== 'boolean' || !Array.isArray(value.grades)) return null;
  if (value.grades.length !== LOYALTY_GRADES.length) return null;
  const grades: GradeBenefitRow[] = [];
  for (const [index, row] of value.grades.entries()) {
    if (!record(row) || !isLoyaltyGrade(row.grade) || row.grade !== LOYALTY_GRADES[index] || !Array.isArray(row.coupons)) return null;
    if (typeof row.reached !== 'boolean') return null;
    const rate = row.creditRateBps;
    if (value.creditRatesEnabled ? !(rate === null || wholeNumber(rate, 0, 10_000)) : rate !== null) return null;
    const counts = row.couponCounts;
    if (!record(counts) || !wholeNumber(counts.goods, 0, 1_000) || !wholeNumber(counts.shipping, 0, 1_000)) return null;
    /* 오르지 않은 등급에 쿠폰 내용이 실려 오면 공개 범위 계약이 깨진 것이다 — 화면에 쓰지 않는다. */
    if (!row.reached && row.coupons.length > 0) return null;
    const coupons: GradeBenefitCoupon[] = [];
    for (const coupon of row.coupons) {
      const parsed = parseCoupon(coupon);
      if (!parsed) return null;
      coupons.push(parsed);
    }
    if (row.reached) {
      const goods = coupons.filter((coupon) => coupon.benefitKind === 'goods').length;
      if (goods !== counts.goods || coupons.length - goods !== counts.shipping) return null;
    }
    grades.push({
      grade: row.grade,
      reached: row.reached,
      creditRateBps: rate as number | null,
      couponCounts: { goods: counts.goods, shipping: counts.shipping },
      coupons,
    });
  }
  return { creditRatesEnabled: value.creditRatesEnabled, grades };
}

/** 아직 오르지 않은 등급의 쿠폰 요약 — 종류별 장수만 적는다(굿즈 할인 → 배송비 할인 순, 0장은 뺀다). */
export function gradeBenefitCountLines(counts: GradeBenefitCouponCounts): string[] {
  return [
    counts.goods > 0 ? `굿즈 할인 쿠폰 ${counts.goods.toLocaleString('ko-KR')}장` : null,
    counts.shipping > 0 ? `배송비 할인 쿠폰 ${counts.shipping.toLocaleString('ko-KR')}장` : null,
  ].filter((line): line is string => line !== null);
}

/** 등급표 아래 '등급 적립금은 … 한도 안에서 쌓여요' 안내를 쓸지 — 표가 적립률 줄을 하나라도 그릴 때만. */
export function hasGradeCreditRates(benefits: LoyaltyGradeBenefits | null): boolean {
  return Boolean(benefits?.creditRatesEnabled && benefits.grades.some((row) => (row.creditRateBps ?? 0) > 0));
}

/** 0.01% 단위 적립률을 사람이 읽는 퍼센트로 — 100 → '1%', 150 → '1.5%', 5 → '0.05%'. */
export function gradeCreditRateLabel(bps: number): string {
  return `${(bps / 100).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}%`;
}

function kstDate(value: string): string {
  return new Date(Date.parse(value) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10).replaceAll('-', '.');
}

/** 등급 혜택 쿠폰 한 장의 안내 문구. 쿠폰함 카드와 같은 혜택·조건 표기를 쓴다(lib/coupons). */
export function gradeBenefitCouponCopy(coupon: GradeBenefitCoupon, now: Date = new Date()): {
  benefit: string;
  condition: string;
  validity: string;
  recipient: string | null;
} {
  const amount = couponBenefitLabel(coupon);
  const benefit = coupon.benefitKind === 'shipping' ? `배송비 ${amount}` : amount;
  const validity = coupon.validDays !== null
    ? `지급일부터 ${coupon.validDays}일${coupon.endsAt ? ` (최대 ${kstDate(coupon.endsAt)}까지)` : ''}`
    : coupon.endsAt
      ? `${Date.parse(coupon.startsAt) > now.getTime() ? `${kstDate(coupon.startsAt)}부터 ` : ''}${kstDate(coupon.endsAt)}까지`
      : Date.parse(coupon.startsAt) > now.getTime() ? `${kstDate(coupon.startsAt)}부터 사용` : '기한 없음';
  const recipient = coupon.recipientSegment === 'first_purchase'
    ? '아직 구매하지 않은 회원에게만 지급돼요'
    : coupon.recipientSegment === 'repeat_purchase'
      ? '구매한 적이 있는 회원에게만 지급돼요'
      : null;
  return { benefit, condition: couponConditionLabel(coupon), validity, recipient };
}

/**
 * 등급 기준 한 줄. WELCOME 은 가입 기본 등급이다. 자동 승급을 운영하지 않는 등급(enabled=false)은 null —
 * 화면은 그 등급 행을 내 등급일 때만 남긴다(운영자 수동 조정으로 머무를 수 있다).
 */
export function loyaltyCriterionCopy(grade: LoyaltyGrade, tiers: readonly LoyaltyCriterion[]): string | null {
  if (grade === 'welcome') return '가입하면 바로';
  const tier = tiers.find((item) => item.grade === grade);
  if (!tier?.enabled) return null;
  const parts = [
    tier.amount === null ? null : `결제 금액 ${krw(tier.amount)} 이상`,
    tier.itemCount === null ? null : `굿즈 주문 항목 ${tier.itemCount.toLocaleString('ko-KR')}건 이상`,
  ].filter((part): part is string => part !== null);
  return parts.length ? `최근 ${LOYALTY_WINDOW_DAYS}일 ${parts.join(' 또는 ')}` : null;
}
