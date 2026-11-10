import { loadAdminOrderProduction } from '@/lib/order-production.server';
import { loadAdminOrderDownloads } from '@/lib/admin/order-downloads.server';
import { hasAdminCapability } from '@/lib/admin/access';
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
  const auth = await requireAdminScreenAccess(`/admin/sales/orders/${orderId}`);
  const canManage = hasAdminCapability(auth, 'sales.manage');
  if (!isOrderDetailId(orderId)) notFound();
  const [detail, production, downloads] = await Promise.all([getAdminOrderDetail(orderId, canManage), loadAdminOrderProduction(orderId), loadAdminOrderDownloads(orderId)]);
  if (!detail) notFound();
  const query = await searchParams;
  const requestedBack = adminOrderBackHref(query.back);
  const backHref = canManage || requestedBack.startsWith('/admin/sales/orders?') ? requestedBack : '/admin/sales/orders';
  return (
    <OrderDetailScreen
      backHref={backHref}
      backLabel={backHref.startsWith('/admin/sales/settled') ? '거래확정 목록' : '주문 목록'}
      detail={detail}
      production={production}
      downloads={downloads}
      actorId={auth.user?.id}
      canManage={canManage}
      canViewCustomer={hasAdminCapability(auth, 'platform.manage')}
      noteOperationId={crypto.randomUUID()}
    />
  );
}
