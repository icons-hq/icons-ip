import { kstDay } from './kst';

export const ADMIN_SALES_HOURLY_PATH = '/admin/stats/sales/hourly';
export type AdminSalesHourlyFilters = { comparisonDate: string | null; ipId: string; cutoff: string | null; error?: string };
export type AdminSalesHourlyTotals = { orderCount: number; revenue: number };
export type AdminSalesHourlyRow = {
  hour: number;
  orderCount: number | null;
  revenue: number | null;
  comparisonOrderCount: number | null;
  comparisonRevenue: number | null;
  cumulativeOrderCount: number | null;
  cumulativeRevenue: number | null;
  comparisonCumulativeOrderCount: number | null;
  comparisonCumulativeRevenue: number | null;
};
export type AdminSalesHourlyGood = { rank: number; goodId: string; name: string; ipId: string; qty: number; revenue: number; comparisonQty: number; comparisonRevenue: number };
export type AdminSalesHourlyReport = {
  asOf: string; date: string; comparisonDate: string; cutoff: string; comparisonCutoff: string;
  completedHours: number; ipId: string; lastHourFrom: string; comparisonLastHourFrom: string;
  summary: { current: AdminSalesHourlyTotals | null; comparison: AdminSalesHourlyTotals | null };
  hours: AdminSalesHourlyRow[]; todayGoods: AdminSalesHourlyGood[]; lastHourGoods: AdminSalesHourlyGood[];
};
export class SalesHourlyReadError extends Error {
  constructor(readonly code: 'invalid_filters' | 'forbidden' | 'read_failed') {
    super(code === 'invalid_filters' ? '비교일과 집계 마감시각을 확인해주세요. 날짜가 바뀌었다면 최신 현황을 조회해주세요.'
      : code === 'forbidden' ? '시간대별 판매현황을 조회할 권한이 없습니다.' : '시간대별 판매현황을 불러오지 못했습니다. 다시 조회해주세요.');
  }
}
const date = (value: unknown): value is string => typeof value === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)
  && value.slice(0, 4) !== '0000' && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const timestamp = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, minimum = 0): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
const hourMs = 3600000;
const hourlyKeys = ['orderCount', 'revenue', 'comparisonOrderCount', 'comparisonRevenue', 'cumulativeOrderCount', 'cumulativeRevenue', 'comparisonCumulativeOrderCount', 'comparisonCumulativeRevenue'] as const;

export function normalizeAdminSalesHourlyFilters(params: Record<string, string | string[] | undefined>): AdminSalesHourlyFilters {
  const read = (key: string) => ((Array.isArray(params[key]) ? params[key][0] : params[key]) ?? '').trim();
  const comparisonDate = read('compareDate');
  const ipId = read('ip');
  const cutoff = read('cutoff');
  const validCutoff = !cutoff || /^\d{4}-\d{2}-\d{2}T\d{2}:00:00(?:\.000)?(?:Z|[+-]\d{2}:\d{2})$/.test(cutoff)
    && date(cutoff.slice(0, 10)) && timestamp(cutoff) && Date.parse(cutoff) % hourMs === 0;
  return { comparisonDate: comparisonDate || null, ipId: ipId.slice(0, 64), cutoff: validCutoff && cutoff ? new Date(cutoff).toISOString() : null,
    ...((comparisonDate && !date(comparisonDate)) || !validCutoff || ipId.length > 64 ? { error: '비교일과 조회조건을 확인해주세요.' } : {}),
  };
}
export function adminSalesHourlyHref(filters: Partial<AdminSalesHourlyFilters> = {}) {
  const params = new URLSearchParams();
  if (filters.comparisonDate) params.set('compareDate', filters.comparisonDate);
  if (filters.ipId) params.set('ip', filters.ipId);
  if (filters.cutoff) params.set('cutoff', filters.cutoff);
  return `${ADMIN_SALES_HOURLY_PATH}${params.size ? `?${params}` : ''}`;
}
export const adminSalesHourlyTime = (value: string) => new Date(Date.parse(value) + 9 * hourMs).toISOString().slice(0, 19).replace('T', ' ');
export const adminSalesHourRange = (hour: number) => `${String(hour).padStart(2, '0')}:00 ~ ${String(hour + 1).padStart(2, '0')}:00`;
export function adminSalesHourState(hour: number, report: Pick<AdminSalesHourlyReport, 'completedHours' | 'asOf'>) {
  if (hour < report.completedHours) return '집계 완료';
  const currentHour = new Date(Date.parse(report.asOf) + 9 * hourMs).getUTCHours();
  return hour < currentHour ? '마감 이후' : hour === currentHour ? '집계 대기' : '미도래';
}

/** Fail closed on partial or mismatched snapshots; never present absent hours as zero. */
export function parseAdminSalesHourlyReport(value: unknown, filters: AdminSalesHourlyFilters): AdminSalesHourlyReport {
  const invalid = () => new SalesHourlyReadError('read_failed');
  if (!object(value) || !timestamp(value.asOf) || !date(value.date) || !date(value.comparisonDate)
    || !timestamp(value.cutoff) || !timestamp(value.comparisonCutoff) || !timestamp(value.lastHourFrom) || !timestamp(value.comparisonLastHourFrom)
    || !integer(value.completedHours) || value.completedHours > 23 || value.ipId !== filters.ipId
    || !Array.isArray(value.hours) || value.hours.length !== 24 || !object(value.summary)) throw invalid();
  const asOf = Date.parse(value.asOf); const start = Date.parse(`${value.date}T00:00:00+09:00`);
  const cutoff = Date.parse(value.cutoff); const comparisonStart = Date.parse(`${value.comparisonDate}T00:00:00+09:00`);
  const expectedComparisonDate = filters.comparisonDate ?? kstDay(new Date(start - 7 * 86400000));
  if (kstDay(new Date(asOf)) !== value.date || value.comparisonDate !== expectedComparisonDate || value.comparisonDate >= value.date
    || cutoff !== start + value.completedHours * hourMs || cutoff > asOf
    || Date.parse(value.comparisonCutoff) !== comparisonStart + value.completedHours * hourMs
    || Date.parse(value.lastHourFrom) !== cutoff - hourMs || Date.parse(value.comparisonLastHourFrom) !== comparisonStart + (value.completedHours - 1) * hourMs
    || (filters.cutoff ? cutoff !== Date.parse(filters.cutoff) : cutoff !== Math.floor(asOf / hourMs) * hourMs)) throw invalid();
  const totals = [0, 0, 0, 0];
  const completedHours = value.completedHours;
  const hours = value.hours.map((row, index): AdminSalesHourlyRow => {
    if (!object(row) || row.hour !== index || hourlyKeys.some(key => index < completedHours ? !integer(row[key]) : row[key] !== null)) throw invalid();
    if (index < completedHours) {
      for (let i = 0; i < 4; i++) totals[i] += row[hourlyKeys[i]] as number;
      if (totals.some((total, i) => row[hourlyKeys[i + 4]] !== total)) throw invalid();
    }
    return { hour: index, ...Object.fromEntries(hourlyKeys.map(key => [key, row[key]])) } as AdminSalesHourlyRow;
  });
  const parseTotal = (raw: unknown, offset: number): AdminSalesHourlyTotals | null => {
    if (value.completedHours === 0) { if (raw !== null) throw invalid(); return null; }
    if (!object(raw) || raw.orderCount !== totals[offset] || raw.revenue !== totals[offset + 1]) throw invalid();
    return { orderCount: totals[offset], revenue: totals[offset + 1] };
  };
  const parseGoods = (raw: unknown): AdminSalesHourlyGood[] => {
    if (!Array.isArray(raw) || raw.length > 10) throw invalid();
    const ids = new Set<string>();
    return raw.map((row, i) => {
      if (!object(row) || row.rank !== i + 1 || typeof row.goodId !== 'string' || !row.goodId || ids.has(row.goodId)
        || typeof row.name !== 'string' || typeof row.ipId !== 'string' || filters.ipId && row.ipId !== filters.ipId
        || !integer(row.qty, 1) || !integer(row.revenue) || !integer(row.comparisonQty) || !integer(row.comparisonRevenue)) throw invalid();
      ids.add(row.goodId);
      return { rank: i + 1, goodId: row.goodId, name: row.name, ipId: row.ipId, qty: row.qty, revenue: row.revenue, comparisonQty: row.comparisonQty, comparisonRevenue: row.comparisonRevenue };
    });
  };
  const todayGoods = parseGoods(value.todayGoods);
  if (!value.completedHours && todayGoods.length) throw invalid();
  return { asOf: value.asOf, date: value.date, comparisonDate: value.comparisonDate, cutoff: value.cutoff, comparisonCutoff: value.comparisonCutoff,
    completedHours: value.completedHours, ipId: filters.ipId, lastHourFrom: value.lastHourFrom, comparisonLastHourFrom: value.comparisonLastHourFrom,
    summary: { current: parseTotal(value.summary.current, 0), comparison: parseTotal(value.summary.comparison, 2) },
    hours, todayGoods, lastHourGoods: parseGoods(value.lastHourGoods),
  };
}
