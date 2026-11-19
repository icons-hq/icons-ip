import { loadAdminOrderProduction } from '@/lib/order-production.server';
import { loadAdminOrderDownloads } from '@/lib/admin/order-downloads.server';
import { loadAdminOrderAcknowledgement } from '@/lib/admin/order-acknowledgement.server';
import { hasAdminCapability } from '@/lib/admin/access';
import { notFound } from 'next/navigation';
import { OrderDetailScreen } from '@/components/admin/screens/OrderDetailScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { isOrderDetailId } from '@/lib/admin/order-detail';
import { getAdminOrderDetail } from '@/lib/admin/order-detail.server';
import { adminOrderBackHref } from '@/lib/admin/orders';
import { notePiiAccess } from '@/lib/admin/pii-access-log.server';

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
  const [detail, production, downloads, acknowledgement] = await Promise.all([getAdminOrderDetail(orderId, canManage), loadAdminOrderProduction(orderId), loadAdminOrderDownloads(orderId), loadAdminOrderAcknowledgement(orderId)]);
  if (!detail) notFound();
  /* 배송지·연락처·구매자를 보여 주는 화면 — 개인정보 접속기록(실패해도 화면은 연다). */
  await notePiiAccess({ actorId: auth.user.id, action: 'view', surface: 'order.detail', path: `/admin/sales/orders/${orderId}`,
    subjectKind: 'order', subjectIds: [orderId], detail: { via: 'page' } });
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
      acknowledgement={acknowledgement}
      actorId={auth.user?.id}
      canManage={canManage}
      canViewCustomer={hasAdminCapability(auth, 'platform.manage')}
      noteOperationId={crypto.randomUUID()}
    />
  );
}
