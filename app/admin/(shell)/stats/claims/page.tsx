import { StatsClaimsScreen } from '@/components/admin/screens/StatsClaimsScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeAdminStatsFilters } from '@/lib/admin/stats';
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
  const data = await getAdminClaimsReport(filters);

  return <StatsClaimsScreen data={data} filters={filters} />;
}
