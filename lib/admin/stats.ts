import { kstDay } from '@/lib/admin/kst';

/**
 * 통계 리포트 (#258) — 조회 전용.
 *
 * 집계는 DB RPC가 끝낸다(`admin_sales_report`·`admin_claims_report`·
 * `admin_customer_report`). 이 모듈은 기간 파라미터를 다듬고, 화면이 그대로 그릴
 * 수 있게 파생값(비율·합계)만 만든다 — 앱에서 다시 합산하면 PostgREST 1000행
 * 절단과 KST 경계 차이로 대시보드와 다른 숫자가 나온다.
 */

export const ADMIN_STATS_RANGE_DAYS = [7, 30, 90] as const;
export type AdminStatsRangeDays = (typeof ADMIN_STATS_RANGE_DAYS)[number];

export const ADMIN_STATS_DEFAULT_RANGE: AdminStatsRangeDays = 30;
export type AdminStatsComparisonMode = 'none' | 'previous' | 'year';
export const ADMIN_STATS_YEAR_COMPARISON_NOTE = '전년 비교는 시작일과 종료일을 각각 1년 전으로 옮깁니다. 2월 29일은 2월 28일로 보정하며, 윤년에 따라 조회기간과 비교기간의 일수가 달라질 수 있습니다.';

export interface AdminStatsFilters {
  /** 날짜 직접 지정이 없을 때 적용할 조회 기간. */
  days: AdminStatsRangeDays;
  /** 판매분석 전용 IP 필터. 다른 화면에서는 무시한다. */
  ipId: string;
  from?: string | null;
  to?: string | null;
  rangeError?: string;
  /** 기존 boolean 필터는 true일 때 직전 동일 기간을 뜻한다. */
  compare?: boolean;
  comparisonMode?: AdminStatsComparisonMode;
  bucket?: 'day' | 'week' | 'month';
}

export interface AdminStatsRange {
  from: string;
  to: string;
}

function readParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
) {
  const value = params[key];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

export function normalizeAdminStatsFilters(
  params: Record<string, string | string[] | undefined>,
): AdminStatsFilters {
  const parsed = Number.parseInt(readParam(params, 'days'), 10);
  const days = (ADMIN_STATS_RANGE_DAYS as readonly number[]).includes(parsed)
    ? (parsed as AdminStatsRangeDays)
    : ADMIN_STATS_DEFAULT_RANGE;
  const from = statsDate(readParam(params, 'from'));
  const to = statsDate(readParam(params, 'to'));
  const requestedRange = Boolean(readParam(params, 'from') || readParam(params, 'to'));
  const validRange = Boolean(from && to && from <= to && Date.parse(to) - Date.parse(from) < 366 * 86400000);
  const bucket = readParam(params, 'bucket');
  const comparison = readParam(params, 'compare');
  const comparisonMode: AdminStatsComparisonMode = comparison === 'year' ? 'year'
    : comparison === 'previous' || comparison === 'true' ? 'previous' : 'none';
  return { days, ipId: readParam(params, 'ip').trim().slice(0, 64),
    from: validRange ? from : null, to: validRange ? to : null,
    ...(requestedRange && !validRange ? { rangeError: '시작일과 종료일을 확인하세요. 최대 366일까지 조회할 수 있습니다.' } : {}),
    compare: comparisonMode !== 'none', comparisonMode,
    bucket: bucket === 'week' || bucket === 'month' ? bucket : 'day',
  };
}

/**
 * 기간 경계. 끝을 "지금"이 아니라 다음 KST 자정으로 잡는 이유는, DB 버킷이 KST
 * 일자이기 때문이다 — 오늘 오후에 열면 오늘 버킷이 반쯤 잘린 채로 보인다.
 */
export function adminStatsRange(
  days: AdminStatsRangeDays,
  now: Date = new Date(),
): AdminStatsRange {
  const dayMs = 24 * 60 * 60 * 1000;
  const todayKst = kstDay(now);
  const startKst = kstDay(new Date(now.getTime() - (days - 1) * dayMs));
  return {
    from: new Date(`${startKst}T00:00:00+09:00`).toISOString(),
    to: new Date(Date.parse(`${todayKst}T00:00:00+09:00`) + dayMs).toISOString(),
  };
}

export function adminStatsHref(base: string, filters: Partial<AdminStatsFilters>) {
  const params = new URLSearchParams();
  if (filters.days && filters.days !== ADMIN_STATS_DEFAULT_RANGE) {
    params.set('days', String(filters.days));
  }
  if (filters.ipId) params.set('ip', filters.ipId);
  if (filters.from && filters.to) { params.delete('days'); params.set('from', filters.from); params.set('to', filters.to); }
  const comparisonMode = adminStatsComparisonMode(filters);
  if (comparisonMode !== 'none') params.set('compare', comparisonMode);
  if (filters.bucket && filters.bucket !== 'day') params.set('bucket', filters.bucket);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

function statsDate(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}

export function adminStatsFilterRange(filters: AdminStatsFilters, now = new Date()): AdminStatsRange {
  if (filters.rangeError) throw new Error(filters.rangeError);
  if (filters.from && filters.to) return {
    from: new Date(`${filters.from}T00:00:00+09:00`).toISOString(),
    to: new Date(Date.parse(`${filters.to}T00:00:00+09:00`) + 86400000).toISOString(),
  };
  return adminStatsRange(filters.days, now);
}

export function adminStatsDateInputs(filters: AdminStatsFilters, now = new Date()) {
  const range = filters.rangeError ? adminStatsRange(filters.days, now) : adminStatsFilterRange(filters, now);
  return { from: kstDay(new Date(range.from)), to: kstDay(new Date(Date.parse(range.to) - 1)) };
}

export function adminStatsPreviousFilters(filters: AdminStatsFilters, now = new Date()): AdminStatsFilters {
  const range = adminStatsFilterRange(filters, now);
  const duration = Date.parse(range.to) - Date.parse(range.from);
  return { ...filters, from: kstDay(new Date(Date.parse(range.from) - duration)), to: kstDay(new Date(Date.parse(range.from) - 1)), compare: false, comparisonMode: 'none' };
}

export function adminStatsComparisonMode(filters: Partial<AdminStatsFilters>): AdminStatsComparisonMode {
  if (!filters.compare) return 'none';
  return filters.comparisonMode === 'year' ? 'year' : 'previous';
}

export function adminStatsComparisonLabel(filters: Partial<AdminStatsFilters>) {
  const mode = adminStatsComparisonMode(filters);
  return mode === 'year' ? '전년 동일 날짜 비교' : mode === 'previous' ? '직전 동일 기간 비교' : '비교 없음';
}

/** 조회기간의 양끝 KST 날짜를 옮긴다. 윤년의 비교기간은 같은 일수가 아닐 수 있다. */
export function adminStatsComparisonFilters(filters: AdminStatsFilters, now = new Date()): AdminStatsFilters | null {
  const mode = adminStatsComparisonMode(filters);
  if (mode === 'none') return null;
  if (mode === 'previous') return adminStatsPreviousFilters(filters, now);
  const range = adminStatsFilterRange(filters, now);
  const previousYear = (value: string) => {
    const date = new Date(`${value}T00:00:00Z`);
    const day = date.getUTCDate();
    date.setUTCFullYear(date.getUTCFullYear() - 1);
    if (date.getUTCDate() !== day) date.setUTCDate(0);
    return date.toISOString().slice(0, 10);
  };
  return { ...filters,
    from: previousYear(kstDay(new Date(range.from))),
    to: previousYear(kstDay(new Date(Date.parse(range.to) - 1))),
    compare: false, comparisonMode: 'none',
  };
}

export function adminStatsChange(current: number, previous: number): string {
  if (!previous) return current ? '비교기간 실적 없음' : '변동 없음';
  const percent = Math.round((current - previous) / previous * 1000) / 10;
  return `${percent > 0 ? '+' : ''}${percent.toFixed(1)}%`;
}

export function adminSalesTrend(rows: AdminSalesDailyRow[], filters: AdminStatsFilters, now = new Date()) {
  const range = adminStatsFilterRange(filters, now);
  const daily = new Map(rows.map(row => [row.date, row]));
  const buckets = new Map<string, AdminSalesDailyRow>();
  for (let cursor = Date.parse(range.from); cursor < Date.parse(range.to); cursor += 86400000) {
    const date = kstDay(new Date(cursor));
    const row = daily.get(date);
    let key = date;
    if (filters.bucket === 'month') key = date.slice(0, 7);
    if (filters.bucket === 'week') {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      key = new Date(Date.parse(`${date}T00:00:00Z`) - ((weekday + 6) % 7) * 86400000).toISOString().slice(0, 10);
    }
    const total = buckets.get(key) ?? { date: key, orderCount: 0, revenue: 0, averageOrderValue: 0 };
    total.orderCount += row?.orderCount ?? 0;
    total.revenue += row?.revenue ?? 0;
    total.averageOrderValue = total.orderCount ? Math.floor(total.revenue / total.orderCount) : 0;
    buckets.set(key, total);
  }
  return Array.from(buckets.values());
}

export interface AdminSalesDailyRow {
  date: string;
  orderCount: number;
  revenue: number;
  averageOrderValue: number;
}

export interface AdminSalesMethodRow {
  method: string;
  orderCount: number;
  revenue: number;
}

export interface AdminSalesGoodRow {
  goodId: string;
  name: string;
  ipId: string;
  qty: number;
  revenue: number;
}

export interface AdminSalesTicketRow {
  eventId: string;
  eventTitle: string;
  orderCount: number;
  ticketCount: number;
  revenue: number;
}

export interface AdminSalesOccurrenceRow {
  ticketTypeId: string;
  occurrenceName: string;
  eventTitle: string;
  ticketCount: number;
  revenue: number;
}

export interface AdminSalesReport {
  daily: AdminSalesDailyRow[];
  paymentMethods: AdminSalesMethodRow[];
  goods: AdminSalesGoodRow[];
  tickets: AdminSalesTicketRow[];
  ticketOccurrences: AdminSalesOccurrenceRow[];
}

export interface AdminClaimTypeRow {
  claimType: string;
  total: number;
  completed: number;
  rejected: number;
  withdrawn: number;
  open: number;
  /** 주문 1000건당 클레임 수. 판매가 없던 기간에는 null이다. */
  ratePerMille: number | null;
}

export interface AdminClaimReasonRow {
  claimType: string;
  reasonType: string;
  total: number;
}

export interface AdminClaimsReport {
  orderCount: number;
  claimCount: number;
  byType: AdminClaimTypeRow[];
  byReason: AdminClaimReasonRow[];
  refunds: {
    completedCount: number;
    averageHours: number | null;
    within72h: number;
  };
}

export interface AdminCustomerReport {
  signups: { date: string; total: number }[];
  signupTotal: number;
  buyerCount: number;
  repeatBuyerCount: number;
  inquiries: {
    total: number;
    unanswered: number;
    averageFirstResponseHours: number | null;
  };
  reviews: {
    total: number;
    /** 운영자 답글이 아직 없는 리뷰. */
    unanswered: number;
    /** 리뷰가 없으면 null — 0점은 존재할 수 없는 평점이다. */
    averageRating: number | null;
    /** 1점부터 5점까지 순서대로. */
    distribution: number[];
  };
}

export const ADMIN_PAYMENT_METHOD_LABELS: Record<string, string> = {
  card: '신용·체크카드',
  bank_transfer: '무통장 입금',
};

export function adminPaymentMethodLabel(method: string) {
  return ADMIN_PAYMENT_METHOD_LABELS[method] ?? method;
}

export const ADMIN_CLAIM_TYPE_LABELS: Record<string, string> = {
  cancel: '취소',
  return: '반품',
  exchange: '교환',
};

export function adminClaimTypeLabel(claimType: string) {
  return ADMIN_CLAIM_TYPE_LABELS[claimType] ?? claimType;
}

export const ADMIN_CLAIM_REASON_LABELS: Record<string, string> = {
  change_of_mind: '단순 변심',
  defect: '하자·오배송',
};

export function adminClaimReasonLabel(reasonType: string) {
  return ADMIN_CLAIM_REASON_LABELS[reasonType] ?? reasonType;
}

/**
 * 구성비. 분모가 0이면 0%가 아니라 null이다 — "무통장이 0%"와 "판매가 없었다"는
 * 다른 사실이고, 0%로 적으면 운영자가 결제수단을 껐다고 읽는다.
 */
export function adminShareOfTotal(value: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.round((value / total) * 1000) / 10;
}

export function adminPercentLabel(value: number | null) {
  return value === null ? '—' : `${value.toFixed(1)}%`;
}

/** 평점 분포 한 칸의 구성비. 리뷰가 없으면 막대도 없다. */
export function adminRatingShare(count: number, total: number) {
  return adminShareOfTotal(count, total);
}

/** 기간 내 재구매율. 구매자가 없으면 비율이 없다. */
export function adminRepeatRate(repeatBuyers: number, buyers: number) {
  return adminShareOfTotal(repeatBuyers, buyers);
}
