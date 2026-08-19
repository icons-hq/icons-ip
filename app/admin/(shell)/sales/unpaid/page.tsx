import { UnpaidScreen } from '@/components/admin/screens/UnpaidScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeAdminUnpaidFilters } from '@/lib/admin/unpaid';
import { getAdminUnpaidOrders } from '@/lib/admin/unpaid.server';

export default async function AdminSalesUnpaidPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /* 게이트가 로더보다 먼저다 — layout redirect는 page 로더를 막지 못한다. */
  await requireAdminScreenAccess('/admin/sales/unpaid');
  const query = await searchParams;

  const data = await getAdminUnpaidOrders(normalizeAdminUnpaidFilters(query));

  return <UnpaidScreen data={data} />;
}
