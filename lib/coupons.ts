import { krw } from './format';
import { parseCouponTargetingRecord, type CouponTargeting } from './coupon-targeting';

/* 쿠폰 표시·안내의 공용 로직 (S7 · ADR-0011 B1).
 *
 * 주의: 여기 계산은 카트 요약에 "적용하면 얼마인가"를 미리 보여주는 표시용
 * 파생일 뿐이다. 실제 할인 확정은 place_order RPC 가 같은 규칙으로 다시
 * 계산해 orders.discount_total 에 스냅샷으로 남긴다 — 규칙이 어긋나면 카트
 * 미리보기와 청구액이 달라지므로, 대표 케이스를 coupon_redemption.sql 스모크와
 * 같은 기대값으로 고정한 테스트가 두 구현을 묶는다. */

export interface CouponSummary extends Partial<CouponTargeting> {
  code: string;
  name: string;
  discountType: 'fixed' | 'percent';
  discountValue: number;
  maxDiscountAmount: number | null;
  minSubtotal: number;
  endsAt: string | null;
  startsAt?: string;
  status?: 'active' | 'archived';
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
  eligibilityReason?: string | null;
}

/** 쿠폰함 티켓 카드가 구분하는 표시 상태. 만료는 DB 상태가 아니라 파생이다. */
export type CouponDisplayState = 'usable' | 'used' | 'expired' | 'ineligible';

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
  userCoupon: Pick<UserCouponSummary, 'status' | 'expiresAt' | 'eligibilityReason'> & {
    coupon: Pick<CouponSummary, 'endsAt' | 'startsAt' | 'status'>;
  },
  now: number = Date.now(),
): CouponDisplayState {
  if (userCoupon.status === 'used') return 'used';
  const effectiveExpiry = couponEffectiveExpiresAt(userCoupon);
  if (effectiveExpiry && Date.parse(effectiveExpiry) < now) return 'expired';
  if (userCoupon.coupon.status === 'archived' || userCoupon.eligibilityReason || userCoupon.coupon.startsAt && Date.parse(userCoupon.coupon.startsAt) > now) return 'ineligible';
  return 'usable';
}

/** 카트·주문서가 공유하는 미리보기 할인. 조건 미달·만료 선택은 0원으로 접고,
 * 결제사 최소 결제액을 지키도록 place_order 와 같은 캡을 건다 — 주문 제출 시
 * RPC 가 같은 규칙으로 확정하므로 미리보기와 청구액이 어긋나지 않는다. */
export function couponPreviewDiscount(
  applied: Pick<UserCouponSummary, 'status' | 'expiresAt' | 'coupon' | 'eligibilityReason'> | null,
  subtotal: number,
  shippingFee: number,
  now: number = Date.now(),
): number {
  if (!applied) return 0;
  if (couponDisplayState(applied, now) !== 'usable') return 0;
  // A target-only discount requires the server's item quote; the whole-basket
  // compatibility helper must never silently discount non-target goods.
  if (applied.coupon.goodsScope === 'selected_goods') return 0;
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
export function couponConditionLabel(coupon: Pick<CouponSummary, 'minSubtotal' | 'goodsScope'>): string {
  const scope = coupon.goodsScope === 'selected_goods' ? '대상 굿즈 합계 ' : '';
  return coupon.minSubtotal > 0
    ? `${scope}${krw(coupon.minSubtotal)} 이상 구매 시`
    : coupon.goodsScope === 'selected_goods' ? '선택한 대상 굿즈에만 사용' : '금액 제한 없음';
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
  coupon_archived: '사용이 중단된 쿠폰이에요.',
  coupon_first_purchase_only: '유효한 굿즈 결제 이력이 없는 첫구매 고객만 쓸 수 있어요.',
  coupon_repeat_purchase_only: '유효한 굿즈 결제 이력이 있는 고객만 쓸 수 있어요.',
  coupon_first_purchase_reserved: '첫구매 혜택으로 진행 중인 주문을 완료하거나 취소해주세요.',
  coupon_first_purchase_pending: '진행 중인 다른 주문을 완료하거나 취소한 뒤 첫구매 쿠폰을 사용해주세요.',
  coupon_no_eligible_goods: '쿠폰 대상 굿즈를 담으면 사용할 수 있어요.',
  coupon_no_discount: '최소 유상 결제액을 유지해야 하므로 이 주문에는 쿠폰 할인을 적용할 수 없어요.',
};

export const COUPON_ACTION_FALLBACK_MESSAGE = '쿠폰을 적용하지 못했어요. 잠시 후 다시 시도해주세요.';

export function mapCouponActionError(message: unknown): string {
  const normalized = typeof message === 'string' ? message.toLowerCase() : '';
  for (const [code, label] of Object.entries(COUPON_ACTION_MESSAGES)) {
    if (normalized.includes(code)) return label;
  }
  return COUPON_ACTION_FALLBACK_MESSAGE;
}

function object(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function money(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 999_999_999_999; }
function instant(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)); }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shared parser for admin definitions and held customer coupons. */
export function parseCouponDefinitionRow(definition: unknown): CouponSummary | null {
  if (!object(definition)) return null;
  const targeting = parseCouponTargetingRecord({ recipientSegment: definition.recipient_segment, goodsScope: definition.goods_scope, targetGoodIds: definition.target_good_ids });
  if (!targeting || typeof definition.code !== 'string' || !/^[A-Z0-9][A-Z0-9-]{2,23}$/.test(definition.code)
    || typeof definition.name !== 'string' || !definition.name.trim() || definition.name.length > 80
    || typeof definition.discount_type !== 'string' || !['fixed', 'percent'].includes(definition.discount_type)
    || typeof definition.status !== 'string' || !['active', 'archived'].includes(definition.status)
    || !money(definition.discount_value) || definition.discount_value <= 0 || !money(definition.min_subtotal)
    || !(definition.max_discount_amount === null || money(definition.max_discount_amount) && definition.max_discount_amount > 0)
    || definition.discount_type === 'fixed' && definition.max_discount_amount !== null
    || definition.discount_type === 'percent' && definition.discount_value > 100
    || !instant(definition.starts_at) || !(definition.ends_at === null || instant(definition.ends_at))
    || definition.ends_at !== null && Date.parse(definition.ends_at as string) <= Date.parse(definition.starts_at)
    || !(definition.grade_benefit === null || typeof definition.grade_benefit === 'string' && ['welcome', 'silver', 'gold', 'platinum'].includes(definition.grade_benefit))) return null;
  if (definition.status === 'active' && targeting.goodsScope === 'selected_goods' && targeting.targetGoodIds.length === 0) return null;
  return { ...targeting, code: definition.code, name: definition.name, discountType: definition.discount_type as 'fixed' | 'percent',
    discountValue: definition.discount_value, maxDiscountAmount: definition.max_discount_amount as number | null,
    minSubtotal: definition.min_subtotal, startsAt: definition.starts_at, endsAt: definition.ends_at as string | null,
    status: definition.status as 'active' | 'archived', gradeBenefit: definition.grade_benefit as string | null };
}

/** Validate the full response before interpreting money or current eligibility. */
export function parseUserCouponRows(value: unknown): UserCouponSummary[] | null {
  if (!Array.isArray(value)) return null;
  const coupons: UserCouponSummary[] = [];
  for (const row of value) {
    if (!object(row) || typeof row.id !== 'string' || !UUID.test(row.id) || typeof row.status !== 'string' || !['active', 'used'].includes(row.status)
      || !instant(row.issued_at) || !(row.expires_at === null || instant(row.expires_at)) || !(row.used_at === null || instant(row.used_at))
      || (row.status === 'used') !== (row.used_at !== null) || !object(row.coupons)) return null;
    const coupon = parseCouponDefinitionRow(row.coupons);
    if (!coupon || !(row.coupons.recipient_reason === null || typeof row.coupons.recipient_reason === 'string' && /^coupon_[a-z_]+$/.test(row.coupons.recipient_reason))) return null;
    coupons.push({ id: row.id, status: row.status as UserCouponStatus, issuedAt: row.issued_at, expiresAt: row.expires_at as string | null,
      usedAt: row.used_at as string | null, eligibilityReason: row.coupons.recipient_reason as string | null, coupon });
  }
  return coupons;
}
