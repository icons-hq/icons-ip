import { ShipmentConsoleScreen } from '@/components/admin/screens/ShipmentConsoleScreen';
import { OrderPreviewPopup } from '@/components/admin/screens/OrderPreviewPopup';
import { normalizeShipmentFilters, shipmentConsoleHref } from '@/lib/admin/shipment-dispatch';
import { getShipmentConsoleData } from '@/lib/admin/shipment-dispatch.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { adminOrderPreviewId } from '@/lib/admin/order-preview';
import { loadAdminOrderPreview } from '@/lib/admin/order-preview.server';
import { hasAdminCapability } from '@/lib/admin/access';
import { piiSearchRecord } from '@/lib/admin/pii-access-log';
import { notePiiAccess } from '@/lib/admin/pii-access-log.server';

export default async function AdminSalesShippingPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const auth=await requireAdminScreenAccess('/admin/sales/shipping');
  const params=await searchParams;
  const filters=normalizeShipmentFilters(params,'shipping');
  /* 화면은 출고 전용 권한(sales.dispatch, 1014-084)으로 열린다. 목록 엑셀은 주문 관리 권한(sales.manage), 주문 상세 팝업은 주문 조회 권한(sales.read)이 있을 때만 둔다. */
  const canManageSales=hasAdminCapability(auth,'sales.manage');
  const canReadOrders=hasAdminCapability(auth,'sales.read');
  /* S36-075: 주문번호를 누르면 `?orderId=`로 같은 목록 위에 주문 상세 팝업을 연다. */
  const previewId=canReadOrders?adminOrderPreviewId(params.orderId):null;
  const [data,preview]=await Promise.all([getShipmentConsoleData(filters,'shipping'),previewId?loadAdminOrderPreview(auth,previewId):Promise.resolve(null)]);
  /* 구매자명·수령인명(또는 전체)으로 검색한 결과는 주문 검색과 같은 방식으로 접속기록에 남긴다(원문 없이, 실패해도 연다). */
  const search=piiSearchRecord({actorId:auth.user.id,surface:'shipment.search',path:'/admin/sales/shipping',subjectKind:'shipment',
    subjectIds:data.rows.map(row=>row.id),total:data.total,field:filters.field,query:filters.query,page:filters.page,view:filters.tab});
  if(search)await notePiiAccess(search);
  const registered=params.registered;
  const extra=params.extra;
  const registeredExtraCount=typeof extra==='string'&&/^\d{1,4}$/.test(extra)&&Number(extra)>=1&&Number(extra)<=1000?Number(extra):null;
  const registeredCount=typeof registered==='string'&&/^\d{1,4}$/.test(registered)&&Number(registered)>=1&&Number(registered)<=1000?Number(registered):null;
  return <>
    <ShipmentConsoleScreen data={data} registeredCount={registeredCount} registeredExtraCount={registeredExtraCount} canManageSales={canManageSales} canReadOrders={canReadOrders}/>
    {previewId&&preview?<OrderPreviewPopup key={previewId} actorId={auth.user.id} closeHref={shipmentConsoleHref('shipping',filters)} orderId={previewId} preview={preview} canManageSales={canManageSales} canReadOrders={canReadOrders}/>:null}
  </>;
}
