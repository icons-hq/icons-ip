export type CustomerPurchaseGrain = 'week' | 'month';
export type CustomerPurchaseGroup = 'all' | 'new' | 'repeat';
export type CustomerPurchaseMetric = 'customerCount' | 'orderCount' | 'productSalesAmount' | 'averagePerCustomer';
export type CustomerPurchaseRow = {
  group: CustomerPurchaseGroup;
  customerCount: number;
  orderCount: number;
  itemSubtotal: number | null;
  couponAmount: number | null;
  storeCreditAmount: number | null;
  productSalesAmount: number | null;
  cashProductAmount: number | null;
  averagePerCustomer: number | null;
  monetaryIssueOrderCount: number;
};
export type CustomerPurchasePeriod = { from: string; to: string; rows: CustomerPurchaseRow[]; unknownPaidAtCount: number };
export type CustomerPurchaseReport = {
  current: CustomerPurchasePeriod;
  comparison: CustomerPurchasePeriod | null;
  trend: CustomerPurchasePeriod[];
};
export type CustomerPurchaseFilters = {
  grain: CustomerPurchaseGrain;
  from: string;
  to: string;
  compare: boolean;
  compareFrom: string;
  compareTo: string;
  error?: string;
};

const DAY = 86_400_000;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;
const day = (value: Date) => value.toISOString().slice(0, 10);
function date(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && day(parsed) === value ? parsed : null;
}
function startOf(value: Date, grain: CustomerPurchaseGrain) {
  if (grain === 'month') return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
  return new Date(value.getTime() - ((value.getUTCDay() + 6) % 7) * DAY);
}
function shift(value: Date, units: number, grain: CustomerPurchaseGrain) {
  return grain === 'week' ? new Date(value.getTime() + units * 7 * DAY)
    : new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + units, 1));
}
export function customerPurchaseLatestPeriod(grain: CustomerPurchaseGrain, now = new Date()) {
  const currentStart = startOf(new Date(day(new Date(now.getTime() + 9 * 3_600_000))), grain);
  return { from: day(shift(currentStart, -1, grain)), to: day(new Date(currentStart.getTime() - DAY)) };
}
export function customerPurchasePreviousPeriod(from: string, to: string, grain: CustomerPurchaseGrain) {
  const start = date(from); const end = date(to);
  if (!start || !end) return { from: '', to: '' };
  const units = grain === 'week' ? Math.round((end.getTime() - start.getTime() + DAY) / (7 * DAY))
    : (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + end.getUTCMonth() - start.getUTCMonth() + 1;
  return { from: day(shift(start, -units, grain)), to: day(new Date(start.getTime() - DAY)) };
}
export function customerPurchaseRangeError(from: string, to: string, grain: CustomerPurchaseGrain, now = new Date()) {
  const start = date(from); const end = date(to);
  if (!start || !end || from < '2010-01-01' || start > end) return '시작일과 종료일을 올바르게 입력하세요. 2010년 이후 기간을 조회할 수 있습니다.';
  if (end.getTime() - start.getTime() + DAY > 366 * DAY) return '조회기간은 최대 366일입니다.';
  if (to > customerPurchaseLatestPeriod(grain, now).to) return '마감된 주간·월간만 조회할 수 있습니다.';
  const endExclusive = new Date(end.getTime() + DAY);
  if (day(startOf(start, grain)) !== from || day(startOf(endExclusive, grain)) !== day(endExclusive)) {
    return grain === 'week' ? '주간은 월요일부터 일요일까지 선택하세요.' : '월간은 월 첫날부터 마지막 날까지 선택하세요.';
  }
  return undefined;
}
export function normalizeCustomerPurchaseFilters(query: Record<string, string | string[] | undefined>, now = new Date()): CustomerPurchaseFilters {
  const rawGrain = first(query.grain);
  const grain = rawGrain === 'week' ? 'week' : 'month';
  const latest = customerPurchaseLatestPeriod(grain, now);
  const from = first(query.from) ?? latest.from; const to = first(query.to) ?? latest.to;
  const previous = customerPurchasePreviousPeriod(from, to, grain);
  const compare = first(query.compare) !== 'off';
  const compareFrom = first(query.compareFrom) ?? previous.from;
  const compareTo = first(query.compareTo) ?? previous.to;
  const error = rawGrain && rawGrain !== 'week' && rawGrain !== 'month' ? '지원하지 않는 집계 단위입니다.'
    : customerPurchaseRangeError(from, to, grain, now)
      ?? (compare ? customerPurchaseRangeError(compareFrom, compareTo, grain, now) : undefined);
  return { grain, from, to, compare, compareFrom, compareTo, ...(error ? { error } : {}) };
}
export function customerPurchaseHref(filters: CustomerPurchaseFilters, base = '/admin/stats/customers') {
  const query = new URLSearchParams({ view: 'purchase', grain: filters.grain, from: filters.from, to: filters.to,
    compare: filters.compare ? 'on' : 'off', ...(filters.compare ? { compareFrom: filters.compareFrom, compareTo: filters.compareTo } : {}) });
  return `${base}?${query}`;
}
export const CUSTOMER_PURCHASE_GROUP_LABEL: Record<CustomerPurchaseGroup, string> = { all: '전체', new: '신규', repeat: '재구매' };
export const CUSTOMER_PURCHASE_METRIC_LABEL: Record<CustomerPurchaseMetric, string> = {
  customerCount: '결제고객수', orderCount: '결제 주문수', productSalesAmount: '상품 판매금액', averagePerCustomer: '객단가',
};
export function customerPurchaseShare(value: number, total: number): number | null { return total ? value / total * 100 : null; }
export function customerPurchaseValue(value: number | null, digits = 0) {
  return value === null ? '—' : value.toLocaleString('ko-KR', { maximumFractionDigits: digits });
}
