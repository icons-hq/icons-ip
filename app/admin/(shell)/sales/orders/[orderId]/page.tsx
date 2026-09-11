import { notFound } from 'next/navigation';
import { OrderDetailScreen } from '@/components/admin/screens/OrderDetailScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { isOrderDetailId } from '@/lib/admin/order-detail';
import { getAdminOrderDetail } from '@/lib/admin/order-detail.server';
import { adminOrderBackHref } from '@/lib/admin/orders';

export default async function AdminOrderDetailPage({
  params,
  searchParams = Promise.resolve({}),
}: {
  params: Promise<{ orderId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { orderId } = await params;
  await requireAdminScreenAccess(`/admin/sales/orders/${orderId}`);
  if (!isOrderDetailId(orderId)) notFound();
  const detail = await getAdminOrderDetail(orderId);
  if (!detail) notFound();
  const query = await searchParams;
  const backHref = adminOrderBackHref(query.back);
  return (
    <OrderDetailScreen
      backHref={backHref}
      backLabel={backHref.startsWith('/admin/sales/settled') ? '거래확정 목록' : '주문 목록'}
      detail={detail}
      noteOperationId={crypto.randomUUID()}
    />
  );
}
