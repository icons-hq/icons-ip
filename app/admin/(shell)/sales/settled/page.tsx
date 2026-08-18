import { SettledScreen } from '@/components/admin/screens/SettledScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeAdminSettledFilters } from '@/lib/admin/settled';
import { getAdminSettledOrders } from '@/lib/admin/settled.server';

export default async function AdminSalesSettledPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /* 게이트가 로더보다 먼저다 — layout redirect는 page 로더를 막지 못한다. */
  await requireAdminScreenAccess('/admin/sales/settled');
  const query = await searchParams;

  const data = await getAdminSettledOrders(normalizeAdminSettledFilters(query));

  return <SettledScreen data={data} />;
}
