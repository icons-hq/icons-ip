import { krw } from './format';

/* 쿠폰 표시·안내의 공용 로직 (S7 · ADR-0011 B1).
 *
 * 주의: 여기 계산은 카트 요약에 "적용하면 얼마인가"를 미리 보여주는 표시용
 * 파생일 뿐이다. 실제 할인 확정은 place_order RPC 가 같은 규칙으로 다시
 * 계산해 orders.discount_total 에 스냅샷으로 남긴다 — 규칙이 어긋나면 카트
 * 미리보기와 청구액이 달라지므로, 대표 케이스를 coupon_redemption.sql 스모크와
 * 같은 기대값으로 고정한 테스트가 두 구현을 묶는다. */

export interface CouponSummary {
  code: string;
  name: string;
  discountType: 'fixed' | 'percent';
  discountValue: number;
  maxDiscountAmount: number | null;
  minSubtotal: number;
  endsAt: string | null;
  /** 등급 혜택 쿠폰이면 그 등급(welcome/silver/gold/platinum) — 쿠폰함 뱃지 색에 쓴다. */
  gradeBenefit: string | null;
}

export type UserCouponStatus = 'active' | 'used';

export interface UserCouponSummary {
  id: string;
  status: UserCouponStatus;
  issuedAt: string;
  expiresAt: string | null;
  usedAt: string | null;
  coupon: CouponSummary;
}

/** 쿠폰함 티켓 카드가 구분하는 표시 상태. 만료는 DB 상태가 아니라 파생이다. */
export type CouponDisplayState = 'usable' | 'used' | 'expired';

/** 결제사 최소 결제액(원). 진실원은 20260813242000 가드와 place_order 의
 * c_min_payable_total — 값이 어긋나면 미리보기가 결제 불가 주문을 약속한다. */
export const MIN_PAYABLE_TOTAL = 1000;

/** 실효 만료 시각 — 발급 스냅과 현재 정의 마감 중 이른 쪽. 어드민이 정의를
 * 단축하면 RPC 는 정의 마감도 보므로, 표시가 발급 스냅만 보면 "사용 가능"이
 * 주문 거부로 끝난다. */
export function couponEffectiveExpiresAt(
  userCoupon: Pick<UserCouponSummary, 'expiresAt'> & { coupon: Pick<CouponSummary, 'endsAt'> },
): string | null {
  const candidates = [userCoupon.expiresAt, userCoupon.coupon.endsAt]
    .filter((value): value is string => Boolean(value));
  if (!candidates.length) return null;
  return candidates.reduce((earliest, value) => (
    Date.parse(value) < Date.parse(earliest) ? value : earliest
  ));
}

export function couponDisplayState(
  userCoupon: Pick<UserCouponSummary, 'status' | 'expiresAt'> & {
    coupon: Pick<CouponSummary, 'endsAt'>;
  },
  now: number = Date.now(),
): CouponDisplayState {
  if (userCoupon.status === 'used') return 'used';
  const effectiveExpiry = couponEffectiveExpiresAt(userCoupon);
  if (effectiveExpiry && Date.parse(effectiveExpiry) < now) return 'expired';
  return 'usable';
}

/** 카트·주문서가 공유하는 미리보기 할인. 조건 미달·만료 선택은 0원으로 접고,
 * 결제사 최소 결제액을 지키도록 place_order 와 같은 캡을 건다 — 주문 제출 시
 * RPC 가 같은 규칙으로 확정하므로 미리보기와 청구액이 어긋나지 않는다. */
export function couponPreviewDiscount(
  applied: Pick<UserCouponSummary, 'status' | 'expiresAt' | 'coupon'> | null,
  subtotal: number,
  shippingFee: number,
  now: number = Date.now(),
): number {
  if (!applied) return 0;
  if (couponDisplayState(applied, now) !== 'usable') return 0;
  if (subtotal < applied.coupon.minSubtotal) return 0;
  return Math.min(
    couponDiscountFor(applied.coupon, subtotal),
    Math.max(0, subtotal + shippingFee - MIN_PAYABLE_TOTAL),
  );
}

/** place_order·apply RPC 와 같은 할인 규칙. 소계를 넘는 할인은 없다. */
export function couponDiscountFor(
  coupon: Pick<CouponSummary, 'discountType' | 'discountValue' | 'maxDiscountAmount'>,
  subtotal: number,
): number {
  const base = Math.max(0, Math.floor(subtotal));
  if (base <= 0) return 0;
  if (coupon.discountType === 'fixed') {
    return Math.min(coupon.discountValue, base);
  }
  return Math.min(
    Math.floor((base * coupon.discountValue) / 100),
    coupon.maxDiscountAmount ?? base,
    base,
  );
}

/** 혜택 한 줄 표기 — 카트 select 옵션과 티켓 카드가 같은 문구를 쓴다. */
export function couponBenefitLabel(
  coupon: Pick<CouponSummary, 'discountType' | 'discountValue' | 'maxDiscountAmount'>,
): string {
  if (coupon.discountType === 'fixed') {
    return `${krw(coupon.discountValue)} 할인`;
  }
  return coupon.maxDiscountAmount === null
    ? `${coupon.discountValue}% 할인`
    : `${coupon.discountValue}% 할인 (최대 ${krw(coupon.maxDiscountAmount)})`;
}

/** 사용 조건 한 줄 표기. */
export function couponConditionLabel(coupon: Pick<CouponSummary, 'minSubtotal'>): string {
  return coupon.minSubtotal > 0
    ? `${krw(coupon.minSubtotal)} 이상 구매 시`
    : '금액 제한 없음';
}

/** 유효기간 한 줄 표기 — 실효 만료(정의 단축 반영) 기준. */
export function couponExpiryLabel(
  userCoupon: Pick<UserCouponSummary, 'expiresAt'> & { coupon: Pick<CouponSummary, 'endsAt'> },
): string {
  const effectiveExpiry = couponEffectiveExpiresAt(userCoupon);
  if (!effectiveExpiry) return '기한 없음';
  const date = new Date(effectiveExpiry);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}.${mm}.${dd}까지`;
}

/* 적용·발급 RPC 의 도메인 에러(check_violation 메시지)를 구매자 언어로 번역한다.
   서버가 모르는 메시지는 일반 실패로 접는다. */
const COUPON_ACTION_MESSAGES: Record<string, string> = {
  coupon_not_found: '쿠폰 코드를 찾을 수 없어요. 다시 확인해주세요.',
  coupon_not_started: '아직 사용 기간이 시작되지 않은 쿠폰이에요.',
  coupon_expired: '사용 기간이 지난 쿠폰이에요.',
  coupon_exhausted: '준비된 수량이 모두 소진된 쿠폰이에요.',
  coupon_min_subtotal: '최소 주문 금액을 채우면 쓸 수 있는 쿠폰이에요.',
  coupon_not_owned: '보유하지 않은 쿠폰이에요.',
  coupon_already_used: '이미 사용한 쿠폰이에요.',
};

export const COUPON_ACTION_FALLBACK_MESSAGE = '쿠폰을 적용하지 못했어요. 잠시 후 다시 시도해주세요.';

export function mapCouponActionError(message: unknown): string {
  const normalized = typeof message === 'string' ? message.toLowerCase() : '';
  for (const [code, label] of Object.entries(COUPON_ACTION_MESSAGES)) {
    if (normalized.includes(code)) return label;
  }
  return COUPON_ACTION_FALLBACK_MESSAGE;
}
