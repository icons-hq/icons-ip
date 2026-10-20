import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseDemographicReport, type DemographicFilters } from './customer-demographics';

export async function getCustomerDemographicReport(filters: DemographicFilters) {
  if (filters.error) throw new Error(filters.error);
  const { data, error } = await (await createClient()).rpc('admin_customer_demographic_report', {
    p_scope: filters.scope, p_grain: filters.scope === 'purchasers' ? filters.grain : null,
    p_from: filters.scope === 'purchasers' ? filters.from : null, p_to: filters.scope === 'purchasers' ? filters.to : null,
  });
  const result = error ? null : parseDemographicReport(data);
  if (!result || result.scope !== filters.scope || filters.scope === 'purchasers'
    && (result.from !== filters.from || result.to !== filters.to || result.grain !== filters.grain)) throw new Error('고객 성별·연령 통계를 확인하지 못했습니다.');
  return result;
}
