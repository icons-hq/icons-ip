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
import { PII_ORDER_SEARCH_FIELDS } from '@/lib/admin/pii-access-log';
import { notePiiAccess } from '@/lib/admin/pii-access-log.server';

/*
 * 이름·이메일·수령인·연락처(또는 전체)로 검색한 결과는 개인정보 접속기록에 남긴다 — 검색어 원문은 남기지 않고 검색 유형·쪽과
 * 이 쪽에 보인 주문, 전체 결과 수만 남긴다. 주문번호·운송장·상품 검색과 검색어 없는 목록은 남기지 않는다(실패해도 목록은 연다).
 */
async function noteOrderSearch(actorId: string, filters: { field: string; query: string; page: number }, view: 'orders' | 'items', orderIds: string[], total: number) {
  if (!filters.query || !PII_ORDER_SEARCH_FIELDS.has(filters.field)) return;
  await notePiiAccess({ actorId, action: 'search', surface: 'order.search', path: '/admin/sales/orders', subjectKind: 'order',
    subjectIds: orderIds, subjectCount: total, detail: { field: filters.field, view, page: filters.page } });
}

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
    await noteOrderSearch(auth.user.id, itemFilters, 'items', data.rows.map(row => row.orderId), data.orderCount);
    return <>
      <OrderItemsScreen data={data} canManage={hasAdminCapability(auth, 'sales.manage')} />
      {previewId && loaded ? <OrderPreviewPopup key={previewId} actorId={auth.user.id} closeHref={adminOrderItemsHref(itemFilters)} orderId={previewId} preview={loaded} /> : null}
    </>;
  }

  /* Korpay 원장 대조가 필요한 수동 복구 요약은 admin 역할에게만 싣는다. */
  const filters = normalizeAdminOrderFilters(query);
  const [orders, loaded] = await Promise.all([getAdminOrderRecords(
    filters,
    canAccessAdminScreen(auth, null, { capability: 'sales.manage', adminOnly: true }),
    { canManage: hasAdminCapability(auth, 'sales.manage') },
  ), preview]);
  await noteOrderSearch(auth.user.id, filters, 'orders', orders.items.map(order => order.id), orders.total);

  return <>
    <OrdersSection data={orders} canManage={hasAdminCapability(auth, 'sales.manage')} />
    {previewId && loaded ? <OrderPreviewPopup key={previewId} actorId={auth.user.id} closeHref={adminOrdersHref(filters)} orderId={previewId} preview={loaded} /> : null}
  </>;
}
