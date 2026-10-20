import { StatsRangeTabs } from '@/components/admin/StatsRangeTabs';
import { StatsCustomersScreen } from '@/components/admin/screens/StatsCustomersScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { adminStatsComparisonFilters, normalizeAdminStatsFilters } from '@/lib/admin/stats';
import { getAdminCustomerReport } from '@/lib/admin/stats.server';
import { CustomerStatsViews } from '@/components/admin/CustomerStatsViews';
import { CustomerPurchaseReportScreen } from '@/components/admin/screens/CustomerPurchaseReportScreen';
import { normalizeCustomerPurchaseFilters } from '@/lib/admin/customer-purchase-report';
import { getCustomerPurchaseReport } from '@/lib/admin/customer-purchase-report.server';
import { CustomerDemographicsScreen } from '@/components/admin/screens/CustomerDemographicsScreen';
import { normalizeDemographicFilters } from '@/lib/admin/customer-demographics';
import { getCustomerDemographicReport } from '@/lib/admin/customer-demographics.server';

export default async function AdminStatsCustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /* 게이트가 로더보다 먼저다 — layout redirect는 page 로더를 막지 못한다. */
  await requireAdminScreenAccess('/admin/stats/customers');
  const query = await searchParams;
  const now = new Date();
  if (query.view === 'demographics') {
    const filters = normalizeDemographicFilters(query, now);
    const data = filters.error ? null : await getCustomerDemographicReport(filters);
    return <><CustomerStatsViews view="demographics" /><CustomerDemographicsScreen filters={filters} data={data} /></>;
  }
  if (query.view === 'purchase') {
    const filters = normalizeCustomerPurchaseFilters(query, now);
    const data = filters.error ? null : await getCustomerPurchaseReport(filters);
    return <><CustomerStatsViews view="purchase" /><CustomerPurchaseReportScreen filters={filters} data={data} now={now} /></>;
  }

  const filters = normalizeAdminStatsFilters(query);
  if (filters.rangeError) return <><CustomerStatsViews view="status" /><section className="admin-stats wc-admin-kit"><StatsRangeTabs base="/admin/stats/customers" filters={filters} /><p role="alert">{filters.rangeError}</p></section></>;
  const comparisonFilters = adminStatsComparisonFilters(filters, now);
  const [data, comparison] = await Promise.all([
    getAdminCustomerReport(filters, now),
    comparisonFilters ? getAdminCustomerReport(comparisonFilters, now) : null,
  ]);

  return <><CustomerStatsViews view="status" /><StatsCustomersScreen data={data} filters={filters} comparison={comparison} now={now} /></>;
}
