import { notFound } from 'next/navigation';
import { OrderDetailScreen } from '@/components/admin/screens/OrderDetailScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { isOrderDetailId } from '@/lib/admin/order-detail';
import { getAdminOrderDetail } from '@/lib/admin/order-detail.server';

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  await requireAdminScreenAccess(`/admin/sales/orders/${orderId}`);
  if (!isOrderDetailId(orderId)) notFound();
  const detail = await getAdminOrderDetail(orderId);
  if (!detail) notFound();
  return <OrderDetailScreen detail={detail} noteOperationId={crypto.randomUUID()} />;
}
