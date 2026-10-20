import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseAdminSalesHourlyReport, SalesHourlyReadError, type AdminSalesHourlyFilters } from './stats-hourly';

export async function getAdminSalesHourlyReport(filters: AdminSalesHourlyFilters) {
  if (filters.error) throw new SalesHourlyReadError('invalid_filters');
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_sales_hourly_report', {
    p_compare_date: filters.comparisonDate, p_ip_id: filters.ipId || null, p_cutoff: filters.cutoff,
  });
  if (error) throw new SalesHourlyReadError(error.code === '42501' ? 'forbidden' : error.code === '22023' ? 'invalid_filters' : 'read_failed');
  return parseAdminSalesHourlyReport(data, filters);
}
