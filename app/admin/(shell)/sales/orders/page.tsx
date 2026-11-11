import { canAccessAdminScreen, hasAdminCapability } from '@/lib/admin/access';
import { OrdersSection } from '@/components/admin/sections/Orders';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { adminOrdersHref, normalizeAdminOrderFilters } from '@/lib/admin/orders';
import { getAdminOrderRecords } from '@/lib/admin/orders.server';
import { OrderItemsScreen } from '@/components/admin/screens/OrderItemsScreen';
import { OrderPreviewPopup } from '@/components/admin/screens/OrderPreviewPopup';
import { adminOrderItemsHref, normalizeAdminOrderItemFilters } from '@/lib/admin/order-items';
import { getAdminOrderItemData } from '@/lib/admin/order-items.server';
import { adminOrderPreviewId } from '@/lib/admin/order-preview';
import { loadAdminOrderPreview } from '@/lib/admin/order-preview.server';

/* 이 화면의 서버 액션은 결제사 취소를 바로 발행하고 결과를 조회로 확인한다
   (사전 조회·취소·사후 조회 각 8초 + DB). 페이지 단위 maxDuration이 액션 예산이다. */
export const maxDuration = 60;

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
  /* S36-075: 주문번호를 누르면 `?orderId=`로 같은 목록 위에 주문 상세 팝업을 연다. 목록과 팝업의 자리는 늘 같아
     팝업을 열고 닫아도 목록(선택·입력)이 다시 마운트되지 않는다. */
  const previewId = adminOrderPreviewId(query.orderId);
  const preview = previewId ? loadAdminOrderPreview(auth, previewId) : Promise.resolve(null);
  if (query.view === 'items') {
    const itemFilters = normalizeAdminOrderItemFilters(query);
    const [data, loaded] = await Promise.all([getAdminOrderItemData(itemFilters), preview]);
    return <>
      <OrderItemsScreen data={data} canManage={hasAdminCapability(auth, 'sales.manage')} />
      {previewId && loaded ? <OrderPreviewPopup key={previewId} actorId={auth.user.id} backLabel="상품주문 목록" closeHref={adminOrderItemsHref(itemFilters)} orderId={previewId} preview={loaded} /> : null}
    </>;
  }

  /* Korpay 원장 대조가 필요한 수동 복구 요약은 admin 역할에게만 싣는다. */
  const filters = normalizeAdminOrderFilters(query);
  const [orders, loaded] = await Promise.all([getAdminOrderRecords(
    filters,
    canAccessAdminScreen(auth, null, { capability: 'sales.manage', adminOnly: true }),
    { canManage: hasAdminCapability(auth, 'sales.manage') },
  ), preview]);

  return <>
    <OrdersSection data={orders} canManage={hasAdminCapability(auth, 'sales.manage')} />
    {previewId && loaded ? <OrderPreviewPopup key={previewId} actorId={auth.user.id} backLabel="주문 목록" closeHref={adminOrdersHref(filters)} orderId={previewId} preview={loaded} /> : null}
  </>;
}
