import { StatsRangeTabs } from '@/components/admin/StatsRangeTabs';
import { StatsClaimsScreen } from '@/components/admin/screens/StatsClaimsScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { adminStatsComparisonFilters, normalizeAdminStatsFilters } from '@/lib/admin/stats';
import { getAdminClaimsReport } from '@/lib/admin/stats.server';

export default async function AdminStatsClaimsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /* 게이트가 로더보다 먼저다 — layout redirect는 page 로더를 막지 못한다. */
  await requireAdminScreenAccess('/admin/stats/claims');
  const query = await searchParams;

  const filters = normalizeAdminStatsFilters(query);
  if (filters.rangeError) return <div className="flex min-w-0 flex-col gap-4"><StatsRangeTabs base="/admin/stats/claims" filters={filters} /><p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive" role="alert">{filters.rangeError}</p></div>;
  const now = new Date();
  const comparisonFilters = adminStatsComparisonFilters(filters, now);
  const [data, comparison] = await Promise.all([
    getAdminClaimsReport(filters, now),
    comparisonFilters ? getAdminClaimsReport(comparisonFilters, now) : null,
  ]);

  return <StatsClaimsScreen data={data} filters={filters} comparison={comparison} now={now} />;
}
