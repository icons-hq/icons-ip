import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { adminStatsFilterRange, type AdminStatsFilters } from './stats';
import { ADMIN_SALES_GOODS_EXPORT_FETCH, assertCompleteSalesGoodsExport, parseAdminSalesGoodsPage, type AdminSalesGoodsPagination } from './stats-sales-goods';

export async function getAdminSalesGoodsPage(filters: AdminStatsFilters, pagination: AdminSalesGoodsPagination, now = new Date()) {
  const range = adminStatsFilterRange(filters, now);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_sales_goods_page', {
    p_from: range.from, p_to: range.to, p_ip_id: filters.ipId || null,
    p_page: pagination.page, p_page_size: pagination.pageSize,
  });
  if (error) throw new Error(`Failed to load sales goods: ${error.message}`);
  return parseAdminSalesGoodsPage(data, pagination);
}

export async function getAdminSalesGoodsExport(filters: AdminStatsFilters, now = new Date()) {
  const report = await getAdminSalesGoodsPage(filters, { page: 1, pageSize: ADMIN_SALES_GOODS_EXPORT_FETCH }, now);
  assertCompleteSalesGoodsExport(report);
  return report;
}
