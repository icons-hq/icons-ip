import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { AutoOrderConfirmPanel } from '@/components/admin/screens/AutoOrderConfirmPanel';
import { ForcedDeliveryPanel } from '@/components/admin/screens/ForcedDeliveryPanel';
import { OrderPreviewPopup } from '@/components/admin/screens/OrderPreviewPopup';
import { ShipmentConsoleScreen } from '@/components/admin/screens/ShipmentConsoleScreen';
import { hasAdminCapability } from '@/lib/admin/access';
import { getAutoOrderConfirmation } from '@/lib/admin/auto-order-confirmation.server';
import { normalizeShipmentFilters, shipmentConsoleHref } from '@/lib/admin/shipment-dispatch';
import { adminOrderPreviewId } from '@/lib/admin/order-preview';
import { loadAdminOrderPreview } from '@/lib/admin/order-preview.server';
import { getShipmentConsoleData } from '@/lib/admin/shipment-dispatch.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

export default async function AdminSalesDispatchPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const auth=await requireAdminScreenAccess('/admin/sales/dispatch');
  const query=await searchParams;
  const filters=normalizeShipmentFilters(query,'dispatch');
  /* 화면은 출고 전용 권한(sales.dispatch, 1014-084)으로 열린다. 자동 발주확인 설정·강제 배송완료는 주문 관리 권한(sales.manage)의 일이고,
     주문 상세 팝업은 주문 조회 권한(sales.read)의 일이다. 출고 전용 운영자에게는 읽지도 보이지도 않는다. */
  const canManageSales=hasAdminCapability(auth,'sales.manage');
  const canReadOrders=hasAdminCapability(auth,'sales.read');
  /* S36-075: 주문번호를 누르면 `?orderId=`로 같은 목록 위에 주문 상세 팝업을 연다. 목록 조건은 필터 주소가 그대로 지킨다. */
  const previewId=canReadOrders?adminOrderPreviewId(query.orderId):null;
  const [data,autoConfirmation,preview]=await Promise.all([getShipmentConsoleData(filters,'dispatch'),canManageSales?getAutoOrderConfirmation():Promise.resolve(null),previewId?loadAdminOrderPreview(auth,previewId):Promise.resolve(null)]);
  /* 처리할 주문 표가 첫 화면에 오도록 설정 카드는 표 아래에 둔다. 켜짐·꺼짐은 건수 카드 옆 버튼에서 바로 읽고, 누르면 설정으로 내려간다. */
  const autoOff=autoConfirmation?!autoConfirmation.enabled:false;
  const autoStatus=<a className={`${buttonVariants({variant:'outline'})} shrink-0`} data-slot="button" href="#auto-order-confirm">자동 발주확인 <AdminStatusBadge tone={autoConfirmation?autoConfirmation.enabled?'success':'warning':'danger'}>{autoConfirmation?autoConfirmation.enabled?'켜짐':'꺼짐':'불러오지 못함'}</AdminStatusBadge>{autoOff?<span className="text-xs font-normal text-muted-foreground">신규주문은 직접 발주확인합니다</span>:null}</a>;
  return <section className="flex min-w-0 flex-col gap-6">
    <ShipmentConsoleScreen data={data} actorId={auth.user.id} summaryAside={canManageSales?autoStatus:undefined} canManageSales={canManageSales} canReadOrders={canReadOrders}/>
    {/* key를 두지 않는다 — 저장 뒤 다시 그릴 때 패널이 새로 마운트되면 저장 결과 문구와 포커스가 사라진다. 새 설정은 패널이 맞춘다. */}
    {canManageSales?<AutoOrderConfirmPanel initial={autoConfirmation} listHref={shipmentConsoleHref('dispatch',filters)}/>:null}
    {/* 1014-083: 운영에서도 배송 처리 권한자가 사유·확인창·감사 기록을 남기고 강제 배송완료한다(스테이징 전용 테스트 배송완료를 대체). */}
    {canManageSales?<ForcedDeliveryPanel/>:null}
    {previewId&&preview?<OrderPreviewPopup key={previewId} actorId={auth.user.id} closeHref={shipmentConsoleHref('dispatch',filters)} orderId={previewId} preview={preview} canManageSales={canManageSales} canReadOrders={canReadOrders}/>:null}
  </section>;
}
