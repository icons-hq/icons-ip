import type { AdminFieldErrors } from '@/lib/admin/catalog';
import { kstDateTimeToIso } from '@/lib/admin/kst';
import { customerServiceDate } from './customer-service-list';
import { LOYALTY_GRADES } from '@/lib/loyalty';
import { parseCouponTargeting, type CouponTargetCategory, type CouponTargetGood, type CouponTargetIp, type CouponTargeting } from '@/lib/coupon-targeting';
import { readCouponIssueSchedule, type CouponIssueSchedule } from './coupon-schedule';

export const ADMIN_COUPON_LIST_PATH = '/admin/sales/coupons';
export const ADMIN_COUPON_PAGE_SIZE = 20;
export const COUPON_PHASES = [{ value: 'all', label: '전체' }, { value: 'scheduled', label: '대기중' }, { value: 'live', label: '적용중' }, { value: 'ended', label: '완료' }, { value: 'stopped', label: '중지' }] as const;
export const COUPON_SORTS = [{ value: 'created_desc', label: '등록일 최신순' }, { value: 'name_asc', label: '혜택 이름순' }, { value: 'starts_desc', label: '사용 시작일순' }, { value: 'ends_asc', label: '종료일 가까운순' }] as const;
export const COUPON_SEGMENTS = [{ value: 'all', label: '전체 고객' }, { value: 'first_purchase', label: '첫구매 고객' }, { value: 'repeat_purchase', label: '재구매 고객' }] as const;


export type AdminCouponStatusFilter = 'all' | 'active' | 'archived';

export const ADMIN_COUPON_STATUS_OPTIONS: { value: AdminCouponStatusFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'active', label: '활성' },
  { value: 'archived', label: '보관' },
];

/* 어드민 쿠폰 콘솔의 폼 계약 (S7 #329).
 * 검증의 진실원은 admin_upsert_coupon RPC 와 coupons 테이블 체크다 — 여기는
 * 운영자에게 필드 단위 피드백을 주기 위한 1차 정규화만 한다. */

export interface AdminCouponRecord extends Partial<CouponTargeting>, Partial<CouponIssueSchedule> {
  /** RecordList 규약상 id — 쿠폰 코드가 곧 운영 식별자다. */
  id: string;
  code: string;
  name: string;
  benefitKind?: 'goods' | 'shipping'; stackable?: boolean;
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
  targetCategories?: CouponTargetCategory[];
  targetIps?: CouponTargetIp[];
}

export interface AdminCouponFilters {
  query: string;
  status: AdminCouponStatusFilter;
  page: number;
  selectedCode: string | null;
  inputError?: string;
  phase?: string;
  discountType?: string;
  segment?: string;
  dateField?: string;
  from?: string | null;
  to?: string | null;
  sort?: string;
  pageSize?: number;
}

export interface AdminCouponListData {
  filters: AdminCouponFilters;
  records: AdminCouponRecord[];
  selectedRecord: AdminCouponRecord | null;
  pageSize: number;
  total: number;
}

export interface AdminCouponFormValue extends CouponTargeting, CouponIssueSchedule {
  previousCode: string | null;
  code: string;
  name: string;
  benefitKind?: 'goods' | 'shipping'; stackable?: boolean;
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
  const from = customerServiceDate(values.from); const to = customerServiceDate(values.to);
  const invalidDate = (singleParam(values.from) && !from) || (singleParam(values.to) && !to) || (from && to && from > to);
  const phase = singleParam(values.phase); const discountType = singleParam(values.discountType); const segment = singleParam(values.segment);
  const dateField = singleParam(values.dateField); const sort = singleParam(values.sort); const pageSize = Number(singleParam(values.pageSize));

  return {
    ...(rawQuery.length > 100 ? { inputError: '검색어는 100자 이하로 입력해주세요.' } : {}),
    query: rawQuery.length <= 100 ? rawQuery : '',
    status: rawStatus === 'active' || rawStatus === 'archived' ? rawStatus : 'all',
    page: Number.isSafeInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 100000) : 1,
    selectedCode: CODE_PATTERN.test(rawSelectedCode) ? rawSelectedCode : null,
    ...(invalidDate ? { inputError: '조회 시작일과 종료일을 확인해주세요.' } : {}),
    ...(from ? { from } : {}), ...(to ? { to } : {}),
    ...(phase !== 'all' && COUPON_PHASES.some(option => option.value === phase) ? { phase } : {}),
    ...(['fixed', 'percent'].includes(discountType) ? { discountType } : {}),
    ...(['all', 'first_purchase', 'repeat_purchase', 'grade', 'targeted'].includes(segment) ? { segment } : {}),
    ...(dateField === 'starts' ? { dateField } : {}),
    ...(sort !== 'created_desc' && COUPON_SORTS.some(option => option.value === sort) ? { sort } : {}),
    ...([50, 100].includes(pageSize) ? { pageSize } : {}),
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
  for (const key of ['phase', 'discountType', 'segment', 'dateField', 'from', 'to', 'sort', 'pageSize'] as const) {
    if (next[key]) params.set(key, String(next[key]));
  }
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
  if (targeting.ok && targeting.value.issuanceMode === 'targeted' && rawGradeBenefit) errors.gradeBenefit = '고객 지정 쿠폰은 등급 자동 발급과 함께 설정할 수 없습니다.';
  const benefitKind = readString(formData, 'benefitKind') || 'goods';
  const stackableRaw = readString(formData, 'stackable') || 'false';
  if (!['goods', 'shipping'].includes(benefitKind)) errors.benefitKind = '할인 대상을 확인해주세요.';
  if (!['true', 'false'].includes(stackableRaw)) errors.stackable = '중복 사용 여부를 확인해주세요.';

  if (!CODE_PATTERN.test(code)) {
    errors.code = '코드는 대문자·숫자·하이픈 3~24자로 입력해주세요.';
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

  const relativeValidity = formData.get('validityMode') === 'relative';
  const startsAt = relativeValidity ? kstDateTimeToIso(formData, 'issueStartsAt', errors) : kstDateTimeToIso(formData, 'startsAt', errors);
  if (!relativeValidity && !startsAt && !errors.startsAt) {
    errors.startsAt = '사용 시작 시각을 선택해주세요.';
  }
  const endsAt = relativeValidity ? null : kstDateTimeToIso(formData, 'endsAt', errors);
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    errors.endsAt = '종료 시각은 시작 시각보다 뒤여야 합니다.';
  }
  const schedule = readCouponIssueSchedule(formData, startsAt, endsAt, errors);

  if (Object.keys(errors).length || !targeting.ok) return { ok: false, errors };

  return {
    ok: true,
    value: {
      ...targeting.value,
      ...schedule,
      benefitKind: benefitKind as 'goods' | 'shipping', stackable: stackableRaw === 'true',
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

export function couponConsoleFilters(filters: AdminCouponFilters) {
  return { phase: filters.phase ?? 'all', discountType: filters.discountType ?? 'all', segment: filters.segment ?? 'any', dateField: filters.dateField ?? 'created', from: filters.from ?? null, to: filters.to ?? null, sort: filters.sort ?? 'created_desc' };
}
export function couponPhase(coupon: AdminCouponRecord, now = new Date()) {
  if (coupon.status === 'archived') return 'stopped';
  const startsAt = coupon.issueStartsAt ?? coupon.startsAt;
  const endsAt = couponIssueEndsAt(coupon);
  if (Date.parse(startsAt) > now.getTime()) return 'scheduled';
  if (endsAt && Date.parse(endsAt) <= now.getTime()) return 'ended';
  return 'live';
}

export function couponIssueEndsAt(coupon: Pick<AdminCouponRecord, 'issueStartsAt' | 'issueEndsAt' | 'endsAt'>) {
  const issuanceEnd = coupon.issueStartsAt ? coupon.issueEndsAt : coupon.endsAt;
  const ends = [issuanceEnd, coupon.endsAt].filter((value): value is string => Boolean(value));
  return ends.length ? ends.reduce((a, b) => Date.parse(a) < Date.parse(b) ? a : b) : null;
}
