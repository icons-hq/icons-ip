import type { AdminFieldErrors } from '@/lib/admin/catalog';
import { kstDateTimeToIso } from '@/lib/admin/kst';
import { LOYALTY_GRADES } from '@/lib/loyalty';

/* 어드민 쿠폰 콘솔의 폼 계약 (S7 #329).
 * 검증의 진실원은 admin_upsert_coupon RPC 와 coupons 테이블 체크다 — 여기는
 * 운영자에게 필드 단위 피드백을 주기 위한 1차 정규화만 한다. */

export interface AdminCouponRecord {
  /** RecordList 규약상 id — 쿠폰 코드가 곧 운영 식별자다. */
  id: string;
  code: string;
  name: string;
  discountType: 'fixed' | 'percent';
  discountValue: number;
  maxDiscountAmount: number | null;
  minSubtotal: number;
  startsAt: string;
  endsAt: string | null;
  issueLimit: number | null;
  issuedCount: number;
  usedCount: number;
  status: 'active' | 'archived';
  gradeBenefit: string | null;
  /* 받을 수 있는 사람. 판정은 **발급 시점에 한 번**이다(현업 슬라이스 4). */
  targetKind: string;
  targetGoodId: string | null;
}

export const COUPON_TARGET_KINDS = [
  { value: 'all', label: '누구나' },
  { value: 'first_purchase', label: '첫 구매 고객만' },
  { value: 'repeat_purchase', label: '재구매 고객만' },
  { value: 'bought_good', label: '특정 상품을 산 고객만' },
] as const;

export interface AdminCouponFormValue {
  previousCode: string | null;
  code: string;
  name: string;
  discountType: 'fixed' | 'percent';
  discountValue: number;
  maxDiscountAmount: number | null;
  minSubtotal: number;
  startsAt: string;
  endsAt: string | null;
  issueLimit: number | null;
  status: 'active' | 'archived';
  gradeBenefit: string | null;
  targetKind: string;
  targetGoodId: string | null;
}

export type AdminCouponFormResult =
  | { ok: true; value: AdminCouponFormValue }
  | { ok: false; errors: AdminFieldErrors };

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,23}$/;
const GRADE_SET = new Set<string>(LOYALTY_GRADES);

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function optionalPositiveInteger(
  formData: FormData,
  key: string,
  errors: AdminFieldErrors,
  message: string,
) {
  const raw = readString(formData, key);
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    errors[key] = message;
    return null;
  }
  return value;
}

export function normalizeAdminCouponForm(formData: FormData): AdminCouponFormResult {
  const errors: AdminFieldErrors = {};

  const code = readString(formData, 'code').toUpperCase();
  const previousCode = readString(formData, 'previousCode').toUpperCase() || null;
  const name = readString(formData, 'name');
  const discountType = readString(formData, 'discountType');
  const status = readString(formData, 'status');
  const rawGradeBenefit = readString(formData, 'gradeBenefit');

  if (!CODE_PATTERN.test(code)) {
    errors.code = '코드는 대문자·숫자·하이픈 4~24자로 입력해주세요.';
  }
  if (!name || name.length > 80) {
    errors.name = name.length > 80 ? '이름은 80자 이하로 입력해주세요.' : '쿠폰 이름을 입력해주세요.';
  }
  if (discountType !== 'fixed' && discountType !== 'percent') {
    errors.discountType = '할인 방식을 선택해주세요.';
  }
  if (status !== 'active' && status !== 'archived') {
    errors.status = '상태를 선택해주세요.';
  }
  if (rawGradeBenefit && !GRADE_SET.has(rawGradeBenefit)) {
    errors.gradeBenefit = '등급 혜택 값을 확인해주세요.';
  }

  const discountValueRaw = readString(formData, 'discountValue');
  const discountValue = Number(discountValueRaw);
  if (!discountValueRaw || !Number.isInteger(discountValue) || discountValue <= 0) {
    errors.discountValue = '할인 값은 1 이상의 정수여야 합니다.';
  } else if (discountType === 'percent' && discountValue > 100) {
    errors.discountValue = '정률 할인은 100% 이하여야 합니다.';
  }

  const maxDiscountAmount = optionalPositiveInteger(
    formData, 'maxDiscountAmount', errors, '최대 할인액은 1 이상의 정수여야 합니다.',
  );
  if (discountType === 'fixed' && maxDiscountAmount !== null) {
    errors.maxDiscountAmount = '정액 할인에는 최대 할인액을 쓰지 않아요.';
  }

  const minSubtotalRaw = readString(formData, 'minSubtotal');
  const minSubtotal = minSubtotalRaw ? Number(minSubtotalRaw) : 0;
  if (!Number.isInteger(minSubtotal) || minSubtotal < 0) {
    errors.minSubtotal = '최소 주문 금액은 0 이상의 정수여야 합니다.';
  }

  const issueLimit = optionalPositiveInteger(
    formData, 'issueLimit', errors, '발급 한도는 1 이상의 정수여야 합니다.',
  );

  const startsAt = kstDateTimeToIso(formData, 'startsAt', errors);
  if (!startsAt && !errors.startsAt) {
    errors.startsAt = '사용 시작 시각을 선택해주세요.';
  }
  const endsAt = kstDateTimeToIso(formData, 'endsAt', errors);
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    errors.endsAt = '종료 시각은 시작 시각보다 뒤여야 합니다.';
  }

  const targetKind = readString(formData, 'targetKind') || 'all';
  const targetGoodId = readString(formData, 'targetGoodId');
  if (!COUPON_TARGET_KINDS.some((entry) => entry.value === targetKind)) {
    errors.targetKind = '받을 수 있는 사람을 선택해주세요.';
  }
  /* 「이 상품을 산 사람」인데 상품이 없으면 아무도 못 받는 쿠폰이 된다. */
  if (targetKind === 'bought_good' && !targetGoodId) {
    errors.targetGoodId = '기준이 될 상품을 골라주세요.';
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      previousCode,
      code,
      name,
      discountType: discountType as 'fixed' | 'percent',
      discountValue,
      maxDiscountAmount,
      minSubtotal,
      startsAt: startsAt as string,
      endsAt,
      issueLimit,
      status: status as 'active' | 'archived',
      gradeBenefit: rawGradeBenefit || null,
      targetKind,
      targetGoodId: targetKind === 'bought_good' ? targetGoodId : null,
    },
  };
}

/** 목록·조회 결과에 쓰는 타겟 한 줄. 모르는 값은 원문을 그대로 보여준다 — 조용히 「누구나」로
 *  접으면 실제로는 걸려 있는 조건을 없다고 읽는다. */
export function couponTargetLabel(coupon: {
  targetKind: string;
  targetGoodId: string | null;
}): string {
  const known = COUPON_TARGET_KINDS.find((entry) => entry.value === coupon.targetKind);
  if (!known) return coupon.targetKind;
  if (coupon.targetKind === 'bought_good') {
    return `${known.label} (${coupon.targetGoodId ?? '상품 미지정'})`;
  }
  return known.label;
}
