import { DEMOGRAPHIC_GENDER_LABELS } from '@/lib/customer-demographics';
import { transactionExactKeys, transactionInstant, transactionInteger, transactionRecord } from '@/lib/goods-transaction-values';
import { normalizeCustomerPurchaseFilters, type CustomerPurchaseFilters } from './customer-purchase-report';

export const DEMOGRAPHIC_AGE_LABELS = {
  '14_19': '14–19세', '20_24': '20대 초반', '25_29': '20대 후반', '30_34': '30대 초반', '35_39': '30대 후반',
  '40_44': '40대 초반', '45_49': '40대 후반', '50_54': '50대 초반', '55_59': '50대 후반', '60_plus': '60세 이상',
} as const;
export type DemographicAgeBand = keyof typeof DEMOGRAPHIC_AGE_LABELS;
export type DemographicReportGender = keyof typeof DEMOGRAPHIC_GENDER_LABELS;
export type DemographicScope = 'members' | 'purchasers';
export type DemographicFilters = CustomerPurchaseFilters & { scope: DemographicScope };
export interface DemographicCell { ageBand: DemographicAgeBand; gender: DemographicReportGender; count: number | null }
export interface DemographicReport {
  scope: DemographicScope; grain: 'week' | 'month' | null; from: string | null; to: string | null;
  ageAsOf: string; minimumCount: 10; asOf: string; cells: DemographicCell[];
}
export function normalizeDemographicFilters(query: Record<string, string | string[] | undefined>, now = new Date()): DemographicFilters {
  const rawScope = Array.isArray(query.scope) ? query.scope[0] : query.scope;
  const scope = rawScope === 'purchasers' ? 'purchasers' : 'members';
  const filters = normalizeCustomerPurchaseFilters(scope === 'members' ? { compare: 'off' } : { ...query, compare: 'off' }, now);
  return { ...filters, scope, ...(rawScope && rawScope !== scope ? { error: '지원하지 않는 고객 범위입니다.' } : {}) };
}
export function demographicHref(filters: DemographicFilters, base = '/admin/stats/customers') {
  return `${base}?${new URLSearchParams({ view: 'demographics', scope: filters.scope,
    ...(filters.scope === 'purchasers' ? { grain: filters.grain, from: filters.from, to: filters.to } : {}) })}`;
}
export function parseDemographicReport(value: unknown): DemographicReport | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['scope', 'grain', 'from', 'to', 'ageAsOf', 'minimumCount', 'asOf', 'cells'])
    || !['members', 'purchasers'].includes(String(value.scope)) || value.minimumCount !== 10 || !transactionInstant(value.asOf)
    || typeof value.ageAsOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.ageAsOf)
    || (value.scope === 'members' ? value.grain !== null || value.from !== null || value.to !== null
      : !['week', 'month'].includes(String(value.grain)) || typeof value.from !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.from)
        || typeof value.to !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.to) || value.ageAsOf !== value.to)
    || !Array.isArray(value.cells) || value.cells.length !== 40) return null;
  const seen = new Set<string>(); let hidden = 0;
  for (const cell of value.cells) {
    if (!transactionRecord(cell) || !transactionExactKeys(cell, ['ageBand', 'gender', 'count'])
      || typeof cell.ageBand !== 'string' || !Object.hasOwn(DEMOGRAPHIC_AGE_LABELS, cell.ageBand)
      || typeof cell.gender !== 'string' || !Object.hasOwn(DEMOGRAPHIC_GENDER_LABELS, cell.gender)
      || cell.count !== null && !transactionInteger(cell.count, 10)) return null;
    const key = `${cell.ageBand}:${cell.gender}`; if (seen.has(key)) return null; seen.add(key);
    if (cell.count === null) hidden += 1;
  }
  if (hidden === 1) return null;
  return value as unknown as DemographicReport;
}
export const demographicCount = (value: number | null) => value === null ? '비공개' : `${value.toLocaleString('ko-KR')}명`;
export const DEMOGRAPHIC_REPORT_NOTICE = '10명 미만인 항목은 0명도 포함하여 비공개로 표시합니다. 숨긴 값의 역산을 막기 위해 필요한 경우 추가 항목도 숨깁니다. 합계·비율·개인별 명단은 제공하지 않으며, 화면과 엑셀에 같은 기준을 적용합니다.';
