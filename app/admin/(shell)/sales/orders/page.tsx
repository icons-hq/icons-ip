import { OrdersSection } from '@/components/admin/sections/Orders';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeAdminOrderFilters } from '@/lib/admin/orders';
import { getAdminOrderRecords } from '@/lib/admin/orders.server';

export default async function AdminSalesOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
   * 게이트를 로더보다 먼저 부른다. layout에도 같은 게이트가 있지만 Next.js는
   * layout과 page를 병렬로 렌더하므로 layout의 redirect가 여기 주문 조회를
   * 막지 못한다.
   */
  const auth = await requireAdminScreenAccess('/admin/sales/orders');
  const query = await searchParams;

  /* Korpay 원장 대조가 필요한 수동 복구 요약은 admin 역할에게만 싣는다. */
  const orders = await getAdminOrderRecords(
    normalizeAdminOrderFilters(query),
    auth.role === 'admin',
  );

  return <OrdersSection data={orders} />;
}
