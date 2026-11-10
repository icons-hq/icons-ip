import { normalizeAdminSalesGoodsPagination } from '@/lib/admin/stats-sales-goods';
import { getAdminSalesGoodsPage } from '@/lib/admin/stats-sales-goods.server';
import { StatsRangeTabs } from '@/components/admin/StatsRangeTabs';
import { StatsSalesScreen } from '@/components/admin/screens/StatsSalesScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { adminStatsComparisonFilters, normalizeAdminStatsFilters } from '@/lib/admin/stats';
import { getAdminSalesReport } from '@/lib/admin/stats.server';

export default async function AdminStatsSalesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /* 게이트가 로더보다 먼저다 — layout redirect는 page 로더를 막지 못한다. */
  await requireAdminScreenAccess('/admin/stats/sales');
  const query = await searchParams;

  const filters = normalizeAdminStatsFilters(query);
  if (filters.rangeError) return <div className="flex min-w-0 flex-col gap-4"><StatsRangeTabs base="/admin/stats/sales" filters={filters} /><p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive" role="alert">{filters.rangeError}</p></div>;
  const now = new Date();
  const comparisonFilters = adminStatsComparisonFilters(filters, now);
  const [data, comparison, goods, comparisonGoods] = await Promise.all([
    getAdminSalesReport(filters, now),
    comparisonFilters ? getAdminSalesReport(comparisonFilters, now) : null,
    getAdminSalesGoodsPage(filters, normalizeAdminSalesGoodsPagination(query), now),
    comparisonFilters ? getAdminSalesGoodsPage(comparisonFilters, { page: 1, pageSize: 20 }, now) : null,
  ]);

  return <StatsSalesScreen comparisonGoodsTotal={comparisonGoods?.totalCount} goods={goods} data={data} filters={filters} comparison={comparison} now={now} />;
}
