import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { adminStatsFilterRange } from './stats';
import { BenefitIssuanceError, type BenefitIssuances, type BenefitIssuanceRow, type BenefitReport, type BenefitReportFilters } from './benefit-report';

export async function getBenefitReport(filters: BenefitReportFilters, now = new Date(), exportAll = false): Promise<BenefitReport> {
  const range = adminStatsFilterRange(filters, now);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_benefit_report', {
    p_from: range.from, p_to: range.to, p_query: filters.query,
    p_discount: filters.discount, p_segment: filters.segment, p_code: filters.code,
    p_limit: exportAll ? 10000 : 50, p_offset: exportAll ? 0 : (filters.page - 1) * 50,
  });
  if (error || !data) throw new Error(`혜택 리포트를 불러오지 못했습니다: ${error?.message ?? 'empty_report'}`);
  const report = data as BenefitReport;
  if (exportAll && (report.couponCount > 10000 || (filters.code && report.useCount > 10000))) throw new Error('benefit_export_limit');
  return report;
}

/** A single RPC supplies the matching population, page and observation time. */
export async function getBenefitIssuances(filters: BenefitReportFilters, now = new Date(), exportAll = false): Promise<BenefitIssuances> {
  if (filters.rangeError || !filters.code) throw new BenefitIssuanceError('benefit_issuance_invalid_filters');
  const range = adminStatsFilterRange(filters, now);
  const limit = exportAll ? 10001 : 50;
  const offset = exportAll ? 0 : (filters.page - 1) * 50;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_benefit_issuances', {
    p_from: range.from, p_to: range.to, p_query: filters.query,
    p_discount: filters.discount, p_segment: filters.segment, p_code: filters.code,
    p_limit: limit, p_offset: offset,
  });
  if (error) throw new BenefitIssuanceError(error.code === '42501' ? 'benefit_issuance_forbidden' : error.code === '22023' ? 'benefit_issuance_invalid_filters' : 'benefit_issuance_read_failed');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new BenefitIssuanceError('benefit_issuance_read_failed');
  const report = data as Record<string, unknown>;
  const { rows, totalCount, paidUseCount, asOf } = report;
  if (!Array.isArray(rows) || typeof totalCount !== 'number' || !Number.isSafeInteger(totalCount) || totalCount < 0
    || typeof paidUseCount !== 'number' || !Number.isSafeInteger(paidUseCount) || paidUseCount < 0 || paidUseCount > totalCount
    || typeof asOf !== 'string' || !Number.isFinite(Date.parse(asOf))) throw new BenefitIssuanceError('benefit_issuance_read_failed');
  if (exportAll && (totalCount > 10000 || rows.length > 10000)) throw new BenefitIssuanceError('benefit_issuance_export_limit');
  if (rows.length !== Math.min(limit, Math.max(0, totalCount - offset))) throw new BenefitIssuanceError('benefit_issuance_read_failed');
  const ids = new Set<string>();
  const safeRows: BenefitIssuanceRow[] = rows.map((row: unknown) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new BenefitIssuanceError('benefit_issuance_read_failed');
    const value = row as Record<string, unknown>;
    if (typeof value.id !== 'string' || !value.id || ids.has(value.id) || value.couponCode !== filters.code
      || typeof value.issuedAt !== 'string' || !Number.isFinite(Date.parse(value.issuedAt)) || typeof value.isPaidUse !== 'boolean') throw new BenefitIssuanceError('benefit_issuance_read_failed');
    ids.add(value.id);
    return { id: value.id, couponCode: filters.code, issuedAt: value.issuedAt, isPaidUse: value.isPaidUse };
  });
  if (exportAll && safeRows.filter(row => row.isPaidUse).length !== paidUseCount) throw new BenefitIssuanceError('benefit_issuance_read_failed');
  return { rows: safeRows, totalCount, paidUseCount, asOf };
}
