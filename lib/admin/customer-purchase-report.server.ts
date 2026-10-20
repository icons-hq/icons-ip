import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { type CustomerPurchaseFilters, type CustomerPurchasePeriod, type CustomerPurchaseReport } from './customer-purchase-report';

function validPeriod(value: unknown): value is CustomerPurchasePeriod {
  if (!value || typeof value !== 'object') return false;
  const p = value as CustomerPurchasePeriod;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.from) || !/^\d{4}-\d{2}-\d{2}$/.test(p.to) || !Array.isArray(p.rows) || p.rows.length !== 3) return false;
  return Number.isSafeInteger(p.unknownPaidAtCount) && p.unknownPaidAtCount >= 0 && p.rows.every(row => row && typeof row === 'object')
    && ['all', 'new', 'repeat'].every(group => p.rows.filter(row => row.group === group).length === 1)
    && p.rows.every(row => ['customerCount', 'orderCount', 'monetaryIssueOrderCount'].every(key => {
      const amount = row[key as keyof typeof row]; return typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0;
    }) && ['itemSubtotal', 'couponAmount', 'storeCreditAmount', 'productSalesAmount', 'cashProductAmount'].every(key => {
      const amount = row[key as keyof typeof row];
      return row.monetaryIssueOrderCount > 0 ? amount === null : typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0;
    }) && (row.monetaryIssueOrderCount > 0 || row.customerCount === 0 ? row.averagePerCustomer === null
      : typeof row.averagePerCustomer === 'number' && Number.isFinite(row.averagePerCustomer) && row.averagePerCustomer >= 0 && row.averagePerCustomer <= Number.MAX_SAFE_INTEGER));
}
export async function getCustomerPurchaseReport(filters: CustomerPurchaseFilters): Promise<CustomerPurchaseReport> {
  if (filters.error) throw new Error(filters.error);
  const client = await createClient();
  const { data, error } = await client.rpc('admin_customer_purchase_report', {
    p_grain: filters.grain, p_from: filters.from, p_to: filters.to,
    p_compare_from: filters.compare ? filters.compareFrom : null, p_compare_to: filters.compare ? filters.compareTo : null,
  });
  if (error) throw new Error(`고객 구매 분석을 조회하지 못했습니다: ${error.message}`);
  if (!data || !validPeriod(data.current) || !(data.comparison === null || validPeriod(data.comparison))
    || !Array.isArray(data.trend) || data.trend.length !== 13 || !data.trend.every(validPeriod)
    || data.current.from !== filters.from || data.current.to !== filters.to
    || (filters.compare ? data.comparison?.from !== filters.compareFrom || data.comparison?.to !== filters.compareTo : data.comparison !== null)) throw new Error('고객 구매 분석 응답이 올바르지 않습니다.');
  return data as CustomerPurchaseReport;
}
