import { ShipmentConsoleScreen } from '@/components/admin/screens/ShipmentConsoleScreen';
import { OrderPreviewPopup } from '@/components/admin/screens/OrderPreviewPopup';
import { normalizeShipmentFilters, shipmentConsoleHref } from '@/lib/admin/shipment-dispatch';
import { getShipmentConsoleData } from '@/lib/admin/shipment-dispatch.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { adminOrderPreviewId } from '@/lib/admin/order-preview';
import { loadAdminOrderPreview } from '@/lib/admin/order-preview.server';
import { hasAdminCapability } from '@/lib/admin/access';

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
  const registered=params.registered;
  const registeredCount=typeof registered==='string'&&/^\d{1,4}$/.test(registered)&&Number(registered)>=1&&Number(registered)<=1000?Number(registered):null;
  return <>
    <ShipmentConsoleScreen data={data} registeredCount={registeredCount} canManageSales={canManageSales} canReadOrders={canReadOrders}/>
    {previewId&&preview?<OrderPreviewPopup key={previewId} actorId={auth.user.id} closeHref={shipmentConsoleHref('shipping',filters)} orderId={previewId} preview={preview} canManageSales={canManageSales} canReadOrders={canReadOrders}/>:null}
  </>;
}
