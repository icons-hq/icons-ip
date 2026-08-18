import { DispatchScreen } from '@/components/admin/screens/DispatchScreen';
import { normalizeAdminDispatchFilters } from '@/lib/admin/dispatch';
import { getAdminDispatchOrders } from '@/lib/admin/dispatch.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

export default async function AdminSalesDispatchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
   * 게이트를 로더보다 먼저 부른다. layout에도 같은 게이트가 있지만 Next.js는
   * layout과 page를 병렬로 렌더하므로 layout의 redirect가 여기 주문 조회를
   * 막지 못한다.
   */
  await requireAdminScreenAccess('/admin/sales/dispatch');
  const query = await searchParams;

  const data = await getAdminDispatchOrders(normalizeAdminDispatchFilters(query));

  return <DispatchScreen data={data} />;
}
