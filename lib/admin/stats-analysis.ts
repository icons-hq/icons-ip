/*
 * 판매 분석 (D-6).
 *
 * 세 물음을 한 화면에서 본다 — **언제**(시계열) · **누가·어디서**(축별) · **무엇이**(상품).
 * 셋 다 같은 모집단(`private.stats_sales_scope`)을 쓰기 때문에, 축을 나눠도 합계가 안 어긋난다.
 *
 * 매출 시각은 **결제가 확정된 때**다. 다만 요일·시간대만은 **주문한 때**를 본다 —
 * 그건 매출이 아니라 고객 행동을 보는 축이라 기준이 다르다.
 */

export const STATS_UNITS = [
  { value: 'day', label: '일별' },
  { value: 'week', label: '주별' },
  { value: 'month', label: '월별' },
] as const;
export type StatsUnit = (typeof STATS_UNITS)[number]['value'];

export const STATS_COMPARES = [
  { value: 'none', label: '비교 없음' },
  { value: 'previous_period', label: '직전 기간' },
  { value: 'previous_year', label: '전년 동기' },
] as const;
export type StatsCompare = (typeof STATS_COMPARES)[number]['value'];

export const STATS_AXES = [
  { value: 'payment_method', label: '결제수단' },
  { value: 'region', label: '지역' },
  { value: 'remote_area', label: '도서산간' },
  { value: 'grade', label: '등급' },
  { value: 'age_band', label: '연령대' },
  { value: 'dow', label: '요일' },
  { value: 'hour', label: '시간대' },
  { value: 'buyer_type', label: '첫구매·재구매' },
] as const;
export type StatsAxis = (typeof STATS_AXES)[number]['value'];

export const STATS_RANKS = [
  { value: 'sales', label: '판매액' },
  { value: 'category', label: '분류별' },
  { value: 'ip', label: 'IP별' },
  { value: 'claims', label: '클레임 많은 순' },
] as const;
export type StatsRank = (typeof STATS_RANKS)[number]['value'];

export const STATS_ANALYSIS_RANGE_DAYS = [7, 30, 90, 365] as const;
export type StatsAnalysisRangeDays = (typeof STATS_ANALYSIS_RANGE_DAYS)[number];

export interface StatsAnalysisFilters {
  days: StatsAnalysisRangeDays;
  unit: StatsUnit;
  compare: StatsCompare;
  axis: StatsAxis;
  rank: StatsRank;
  ipId: string;
}

export interface StatsTimeseriesRow {
  bucket: string;
  gross: number;
  refunds: number;
  net: number;
  orderCount: number;
}

export interface StatsBreakdownRow {
  label: string;
  gross: number;
  orderCount: number;
}

export interface StatsProductRow {
  key: string;
  label: string;
  qty: number;
  revenue: number;
  claimCount: number;
}

export interface StatsAnalysisData {
  filters: StatsAnalysisFilters;
  rows: StatsTimeseriesRow[];
  compare: StatsTimeseriesRow[] | null;
  breakdown: StatsBreakdownRow[];
  products: StatsProductRow[];
  /** 응답이 스스로 말하는 기준 시각. 앱 캐시가 없다는 사실을 화면이 드러낸다. */
  refreshedAt: string;
  ipOptions: { id: string; title: string }[];
}

function readParam(params: Record<string, string | string[] | undefined>, key: string) {
  const value = params[key];
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function pick<T extends string>(value: string, allowed: readonly { value: T }[], fallback: T): T {
  return allowed.some((entry) => entry.value === value) ? (value as T) : fallback;
}

export function normalizeStatsAnalysisFilters(
  params: Record<string, string | string[] | undefined>,
): StatsAnalysisFilters {
  const parsedDays = Number.parseInt(readParam(params, 'days'), 10);
  return {
    days: (STATS_ANALYSIS_RANGE_DAYS as readonly number[]).includes(parsedDays)
      ? (parsedDays as StatsAnalysisRangeDays)
      : 30,
    unit: pick(readParam(params, 'unit'), STATS_UNITS, 'day'),
    compare: pick(readParam(params, 'compare'), STATS_COMPARES, 'none'),
    axis: pick(readParam(params, 'axis'), STATS_AXES, 'payment_method'),
    rank: pick(readParam(params, 'rank'), STATS_RANKS, 'sales'),
    ipId: readParam(params, 'ip').trim().slice(0, 64),
  };
}

export function statsAnalysisHref(
  filters: StatsAnalysisFilters,
  patch: Partial<StatsAnalysisFilters> = {},
): string {
  const next = { ...filters, ...patch };
  const params = new URLSearchParams();
  if (next.days !== 30) params.set('days', String(next.days));
  if (next.unit !== 'day') params.set('unit', next.unit);
  if (next.compare !== 'none') params.set('compare', next.compare);
  if (next.axis !== 'payment_method') params.set('axis', next.axis);
  if (next.rank !== 'sales') params.set('rank', next.rank);
  if (next.ipId) params.set('ip', next.ipId);
  const query = params.toString();
  return query ? `/admin/stats/analysis?${query}` : '/admin/stats/analysis';
}

/** 두 구간의 합계 변화. 비교가 없으면 null 이고, 기준이 0이면 비율을 지어내지 않는다. */
export function compareDelta(
  rows: readonly StatsTimeseriesRow[],
  compare: readonly StatsTimeseriesRow[] | null,
): { current: number; previous: number; ratio: number | null } | null {
  if (!compare) return null;
  const current = rows.reduce((sum, row) => sum + row.net, 0);
  const previous = compare.reduce((sum, row) => sum + row.net, 0);
  return { current, previous, ratio: previous === 0 ? null : (current - previous) / previous };
}
