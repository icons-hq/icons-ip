import { COUPON_TARGET_KINDS } from '@/lib/admin/coupons';
import { kstDateToIso } from '@/lib/admin/kst';

/*
 * 쿠폰 조회의 순수 규칙 (현업 슬라이스 4 · 「쿠폰을 조건으로 찾을 수 없다」).
 *
 * 지금까지 쿠폰 화면은 **전체 목록 한 장**이었다. 쿠폰이 수백 장이 되면 「9월에 도는
 * 정률 쿠폰」을 눈으로 찾아야 하고, 그래서 같은 프로모션 쿠폰이 두 번 발행된다.
 *
 * 조회 조건은 여기서 정규화하고, 판정은 `admin_search_coupons` 가 한다 — 화면이
 * 페이지를 직접 계산해 넘기면 서버 상한과 어긋난 순간 조용히 빈 페이지가 나온다.
 */

export const COUPON_SEARCH_PAGE_SIZE = 20;

export const COUPON_STATUS_FILTERS = [
  { value: '', label: '전체 상태' },
  { value: 'active', label: '활성' },
  { value: 'archived', label: '보관' },
] as const;

export interface AdminCouponSearchForm {
  query: string;
  status: string;
  targetKind: string;
  /** KST 일자(`YYYY-MM-DD`). 비우면 기간 조건이 없다. */
  from: string;
  to: string;
  page: number;
}

export interface AdminCouponSearchArgs {
  p_query: string | null;
  p_status: string | null;
  p_target_kind: string | null;
  p_from: string | null;
  p_to: string | null;
  p_limit: number;
  p_offset: number;
}

export const EMPTY_COUPON_SEARCH: AdminCouponSearchForm = {
  query: '',
  status: '',
  targetKind: '',
  from: '',
  to: '',
  page: 1,
};

const STATUS_SET = new Set(COUPON_STATUS_FILTERS.map((entry) => entry.value).filter(Boolean));
const TARGET_SET = new Set<string>(COUPON_TARGET_KINDS.map((entry) => entry.value));

/** 모르는 값은 조건 없음으로 접는다 — 손으로 고친 값 때문에 조회가 실패하면 안 된다. */
function pick(value: string, allowed: Set<string>): string | null {
  const trimmed = value.trim();
  return trimmed && allowed.has(trimmed) ? trimmed : null;
}

export function couponSearchArgs(form: AdminCouponSearchForm): AdminCouponSearchArgs {
  const page = Number.isFinite(form.page) && form.page >= 1 ? Math.floor(form.page) : 1;
  return {
    p_query: form.query.trim() || null,
    p_status: pick(form.status, STATUS_SET),
    p_target_kind: pick(form.targetKind, TARGET_SET),
    p_from: form.from.trim() ? kstDateToIso(form.from, 'start') : null,
    p_to: form.to.trim() ? kstDateToIso(form.to, 'end') : null,
    p_limit: COUPON_SEARCH_PAGE_SIZE,
    p_offset: (page - 1) * COUPON_SEARCH_PAGE_SIZE,
  };
}

export function couponSearchPageCount(total: number): number {
  return Math.max(1, Math.ceil(total / COUPON_SEARCH_PAGE_SIZE));
}

/** 조회 조건이 하나라도 걸려 있는가. 「전체를 본다」와 「걸러서 본다」는 안내 문구가 다르다. */
export function hasCouponSearchFilter(form: AdminCouponSearchForm): boolean {
  return Boolean(form.query.trim() || form.status || form.targetKind || form.from || form.to);
}

function readParam(query: Record<string, string | string[] | undefined>, key: string): string {
  const value = query[key];
  if (Array.isArray(value)) return (value[0] ?? '').trim();
  return typeof value === 'string' ? value.trim() : '';
}

/** URL 질의를 조회 조건으로. 모르는 값·깨진 페이지는 조용히 기본값으로 접는다. */
export function normalizeCouponSearch(
  query: Record<string, string | string[] | undefined>,
): AdminCouponSearchForm {
  const page = Number.parseInt(readParam(query, 'page'), 10);
  return {
    query: readParam(query, 'query').slice(0, 80),
    status: pick(readParam(query, 'status'), STATUS_SET) ?? '',
    targetKind: pick(readParam(query, 'targetKind'), TARGET_SET) ?? '',
    from: kstDateToIso(readParam(query, 'from')) ? readParam(query, 'from') : '',
    to: kstDateToIso(readParam(query, 'to')) ? readParam(query, 'to') : '',
    page: Number.isFinite(page) && page >= 1 ? page : 1,
  };
}

/** 조건은 그대로 두고 페이지만 바꾼 링크. 페이지를 넘길 때 필터가 풀리면 조회가 무의미해진다. */
export function adminCouponHref(
  form: AdminCouponSearchForm,
  overrides: Partial<AdminCouponSearchForm> = {},
): string {
  const next = { ...form, ...overrides };
  const params = new URLSearchParams();
  if (next.query.trim()) params.set('query', next.query.trim());
  if (next.status) params.set('status', next.status);
  if (next.targetKind) params.set('targetKind', next.targetKind);
  if (next.from) params.set('from', next.from);
  if (next.to) params.set('to', next.to);
  if (next.page > 1) params.set('page', String(next.page));
  const qs = params.toString();
  return qs ? `/admin/sales/coupons?${qs}` : '/admin/sales/coupons';
}
