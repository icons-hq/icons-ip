import { ShippingScreen } from '@/components/admin/screens/ShippingScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeAdminShippingFilters } from '@/lib/admin/shipping';
import { getAdminShippingOrders } from '@/lib/admin/shipping.server';

export default async function AdminSalesShippingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
   * 게이트를 로더보다 먼저 부른다. layout에도 같은 게이트가 있지만 Next.js는
   * layout과 page를 병렬로 렌더하므로 layout의 redirect가 여기 주문 조회를
   * 막지 못한다.
   */
  await requireAdminScreenAccess('/admin/sales/shipping');
  const query = await searchParams;

  const data = await getAdminShippingOrders(normalizeAdminShippingFilters(query));

  return <ShippingScreen data={data} />;
}
