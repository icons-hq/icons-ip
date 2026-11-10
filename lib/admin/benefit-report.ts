import { adminStatsFilterRange, adminStatsHref, normalizeAdminStatsFilters, type AdminStatsFilters } from './stats';

export const BENEFIT_REPORT_PATH = '/admin/sales/benefit-report';
export interface BenefitReportFilters extends AdminStatsFilters {
  query: string;
  discount: 'all' | 'fixed' | 'percent';
  segment: 'all' | 'first_purchase' | 'repeat_purchase' | 'targeted';
  code: string;
  detail: 'uses' | 'issuances';
  page: number;
}
export interface BenefitMetrics {
  issued: number;
  paidUses: number;
  discountAmount: number;
  orderAmount: number;
  released: number;
  cohortPaidUses: number;
}
export interface BenefitCouponRow extends BenefitMetrics { code: string; name: string }
export interface BenefitDailyRow extends BenefitMetrics { date: string }
export interface BenefitUseRow { id: string; orderId: string; appliedAt: string; releasedAt: string | null; status: 'paid' | 'pending' | 'released' | 'other'; discountAmount: number; orderAmount: number }
export interface BenefitReport {
  summary: BenefitMetrics;
  daily: BenefitDailyRow[];
  coupons: BenefitCouponRow[];
  couponCount: number;
  uses: BenefitUseRow[];
  useCount: number;
}
export interface BenefitIssuanceRow {
  id: string;
  couponCode: string;
  issuedAt: string;
  isPaidUse: boolean;
}
export interface BenefitIssuances {
  rows: BenefitIssuanceRow[];
  totalCount: number;
  paidUseCount: number;
  asOf: string;
}
export type BenefitIssuanceErrorCode = 'benefit_issuance_invalid_filters' | 'benefit_issuance_forbidden' | 'benefit_issuance_export_limit' | 'benefit_issuance_read_failed';
export class BenefitIssuanceError extends Error {
  constructor(readonly code: BenefitIssuanceErrorCode) { super(code); }
}
export function normalizeBenefitReportFilters(params: Record<string, string | string[] | undefined>): BenefitReportFilters {
  const read = (key: string) => (Array.isArray(params[key]) ? params[key][0] : params[key]) ?? '';
  const discount = read('discount');
  const segment = read('segment');
  const page = Number(read('page'));
  const code = read('code').trim().toUpperCase().slice(0, 24);
  // 혜택 리포트는 기존 직전 비교 계약을 유지한다. 통계 전년 모드를 전파하지 않는다.
  return { ...normalizeAdminStatsFilters({ ...params, compare: read('compare') === 'previous' ? 'previous' : 'none' }), ipId: '', query: read('q').trim().slice(0, 100),
    discount: discount === 'fixed' || discount === 'percent' ? discount : 'all',
    segment: segment === 'first_purchase' || segment === 'repeat_purchase' || segment === 'targeted' ? segment : 'all',
    code,
    detail: code && read('detail') === 'issuances' ? 'issuances' : 'uses',
    page: Number.isSafeInteger(page) && page >= 1 ? Math.min(page, 100000) : 1,
  };
}
export function benefitReportHref(filters: BenefitReportFilters, base = BENEFIT_REPORT_PATH) {
  const stats = adminStatsHref(base, filters);
  const [path, query = ''] = stats.split('?');
  const params = new URLSearchParams(query);
  if (filters.query) params.set('q', filters.query);
  if (filters.discount !== 'all') params.set('discount', filters.discount);
  if (filters.segment !== 'all') params.set('segment', filters.segment);
  if (filters.code) params.set('code', filters.code);
  if (filters.code && filters.detail === 'issuances') params.set('detail', filters.detail);
  if (filters.page > 1) params.set('page', String(filters.page));
  return params.size ? `${path}?${params}` : path;
}
export function benefitCohortRate(metrics: BenefitMetrics) {
  return metrics.issued ? `${(metrics.cohortPaidUses / metrics.issued * 100).toFixed(1)}%` : '—';
}
export function benefitTrend(rows: BenefitDailyRow[], filters: BenefitReportFilters, now = new Date()): BenefitDailyRow[] {
  const range = adminStatsFilterRange(filters, now);
  const daily = new Map(rows.map(row => [row.date, row]));
  const buckets = new Map<string, BenefitDailyRow>();
  for (let cursor = Date.parse(range.from); cursor < Date.parse(range.to); cursor += 86400000) {
    const date = new Date(cursor + 9 * 3600000).toISOString().slice(0, 10);
    let key = date;
    if (filters.bucket === 'month') key = date.slice(0, 7);
    if (filters.bucket === 'week') {
      const day = new Date(`${date}T00:00:00Z`);
      day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
      key = day.toISOString().slice(0, 10);
    }
    const bucket = buckets.get(key) ?? { date: key, issued: 0, paidUses: 0, discountAmount: 0, orderAmount: 0, released: 0, cohortPaidUses: 0 };
    const row = daily.get(date);
    if (row) for (const metric of ['issued', 'paidUses', 'discountAmount', 'orderAmount', 'released', 'cohortPaidUses'] as const) bucket[metric] += row[metric];
    buckets.set(key, bucket);
  }
  return [...buckets.values()];
}
