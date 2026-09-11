import type { AdminFieldErrors } from '@/lib/admin/catalog';
import { kstDateTimeToIso } from '@/lib/admin/kst';
import { LOYALTY_GRADES } from '@/lib/loyalty';
import { parseCouponTargeting, type CouponTargetGood, type CouponTargeting } from '@/lib/coupon-targeting';

export const ADMIN_COUPON_LIST_PATH = '/admin/sales/coupons';
export const ADMIN_COUPON_PAGE_SIZE = 20;

export type AdminCouponStatusFilter = 'all' | 'active' | 'archived';

export const ADMIN_COUPON_STATUS_OPTIONS: { value: AdminCouponStatusFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'active', label: '활성' },
  { value: 'archived', label: '보관' },
];

/* 어드민 쿠폰 콘솔의 폼 계약 (S7 #329).
 * 검증의 진실원은 admin_upsert_coupon RPC 와 coupons 테이블 체크다 — 여기는
 * 운영자에게 필드 단위 피드백을 주기 위한 1차 정규화만 한다. */

export interface AdminCouponRecord extends Partial<CouponTargeting> {
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
  termsRevision?: number;
  targetGoods?: CouponTargetGood[];
}

export interface AdminCouponFilters {
  query: string;
  status: AdminCouponStatusFilter;
  page: number;
  selectedCode: string | null;
  inputError?: string;
}

export interface AdminCouponListData {
  filters: AdminCouponFilters;
  records: AdminCouponRecord[];
  selectedRecord: AdminCouponRecord | null;
  pageSize: number;
  total: number;
}

export interface AdminCouponFormValue extends CouponTargeting {
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
  expectedRevision: number | null;
}

export type AdminCouponFormResult =
  | { ok: true; value: AdminCouponFormValue }
  | { ok: false; errors: AdminFieldErrors };

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,23}$/;
const GRADE_SET = new Set<string>(LOYALTY_GRADES);

type SearchParamValue = string | string[] | undefined;

function singleParam(value: SearchParamValue) {
  return typeof value === 'string' ? value : '';
}

export function normalizeAdminCouponFilters(
  values: Record<string, SearchParamValue>,
): AdminCouponFilters {
  const rawQuery = singleParam(values.q).trim();
  const rawStatus = singleParam(values.status);
  const rawPage = Number(singleParam(values.page));
  const rawSelectedCode = singleParam(values.couponCode).trim().toUpperCase();

  return {
    ...(rawQuery.length > 100 ? { inputError: '검색어는 100자 이하로 입력해주세요.' } : {}),
    query: rawQuery.length <= 100 ? rawQuery : '',
    status: rawStatus === 'active' || rawStatus === 'archived' ? rawStatus : 'all',
    page: Number.isSafeInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 100000) : 1,
    selectedCode: CODE_PATTERN.test(rawSelectedCode) ? rawSelectedCode : null,
  };
}

export const DEFAULT_ADMIN_COUPON_FILTERS: AdminCouponFilters = {
  query: '',
  status: 'all',
  page: 1,
  selectedCode: null,
};

export function adminCouponListHref(
  filters: AdminCouponFilters,
  overrides: Partial<AdminCouponFilters> = {},
) {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (next.query) params.set('q', next.query);
  if (next.status !== 'all') params.set('status', next.status);
  if (next.selectedCode) params.set('couponCode', next.selectedCode);
  params.set('page', String(next.page));
  return `${ADMIN_COUPON_LIST_PATH}?${params.toString()}`;
}

export function adminCouponResetHref() {
  return adminCouponListHref(DEFAULT_ADMIN_COUPON_FILTERS);
}

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
  const targeting = parseCouponTargeting(formData);
  if (!targeting.ok) Object.assign(errors, targeting.errors);

  const code = readString(formData, 'code').toUpperCase();
  const previousCode = readString(formData, 'previousCode').toUpperCase() || null;
  const revisionRaw = readString(formData, 'expectedRevision');
  const expectedRevision = revisionRaw ? Number(revisionRaw) : null;
  if (previousCode && (expectedRevision === null || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1)) errors.form = '쿠폰 목록을 새로고침한 뒤 다시 수정해주세요.';
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

  if (Object.keys(errors).length || !targeting.ok) return { ok: false, errors };

  return {
    ok: true,
    value: {
      ...targeting.value,
      expectedRevision,
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
    },
  };
}
