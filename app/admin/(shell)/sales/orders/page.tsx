import { OrdersSection } from '@/components/admin/sections/Orders';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeAdminOrderFilters } from '@/lib/admin/orders';
import { getAdminOrderRecords } from '@/lib/admin/orders.server';
import { getAdminOrderRecordPanel } from '@/lib/admin/order-records.server';

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

  /* 화면이 펼치는 주문은 하나다. 목록이 고른 그 한 건의 기록만 읽는다 —
     콘솔의 선택 규칙(`orderId` 없으면 첫 행)과 같은 규칙을 여기서도 쓴다. */
  const selectedId = orders.filters.orderId
    && orders.items.some((order) => order.id === orders.filters.orderId)
    ? orders.filters.orderId
    : orders.items[0]?.id ?? null;
  const record = selectedId ? await getAdminOrderRecordPanel(selectedId) : null;

  return <OrdersSection data={orders} record={record} />;
}
