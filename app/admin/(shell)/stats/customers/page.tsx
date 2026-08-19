import { StatsCustomersScreen } from '@/components/admin/screens/StatsCustomersScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeAdminStatsFilters } from '@/lib/admin/stats';
import { getAdminCustomerReport } from '@/lib/admin/stats.server';

export default async function AdminStatsCustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /* 게이트가 로더보다 먼저다 — layout redirect는 page 로더를 막지 못한다. */
  await requireAdminScreenAccess('/admin/stats/customers');
  const query = await searchParams;

  const filters = normalizeAdminStatsFilters(query);
  const data = await getAdminCustomerReport(filters);

  return <StatsCustomersScreen data={data} filters={filters} />;
}
