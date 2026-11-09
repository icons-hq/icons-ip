import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { AutoOrderConfirmPanel } from '@/components/admin/screens/AutoOrderConfirmPanel';
import { ShipmentConsoleScreen } from '@/components/admin/screens/ShipmentConsoleScreen';
import { StagingTestDeliveryPanel } from '@/components/admin/screens/StagingTestDeliveryPanel';
import { getAutoOrderConfirmation } from '@/lib/admin/auto-order-confirmation.server';
import { normalizeShipmentFilters } from '@/lib/admin/shipment-dispatch';
import { getShipmentConsoleData } from '@/lib/admin/shipment-dispatch.server';
import { stagingTestDeliveryAvailable } from '@/lib/admin/staging-test-tools.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

export default async function AdminSalesDispatchPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const auth=await requireAdminScreenAccess('/admin/sales/dispatch');
  const filters=normalizeShipmentFilters(await searchParams,'dispatch');
  const [data,autoConfirmation,stagingDelivery]=await Promise.all([getShipmentConsoleData(filters,'dispatch'),getAutoOrderConfirmation(),stagingTestDeliveryAvailable()]);
  /* 처리할 주문 표가 첫 화면에 오도록 설정 카드는 표 아래에 둔다. 켜짐·꺼짐은 단계 이름 줄에서 바로 읽고, 누르면 설정으로 내려간다. */
  const autoStatus=<a className="inline-flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground hover:text-foreground" href="#auto-order-confirm">자동 발주확인 <AdminStatusBadge tone={autoConfirmation?autoConfirmation.enabled?'success':'warning':'danger'}>{autoConfirmation?autoConfirmation.enabled?'켜짐':'꺼짐':'불러오지 못함'}</AdminStatusBadge></a>;
  return <section className="flex min-w-0 flex-col gap-6">
    <ShipmentConsoleScreen data={data} actorId={auth.user.id} summaryAside={autoStatus}/>
    {/* key를 두지 않는다 — 저장 뒤 다시 그릴 때 패널이 새로 마운트되면 저장 결과 문구와 포커스가 사라진다. 새 설정은 패널이 맞춘다. */}
    <AutoOrderConfirmPanel initial={autoConfirmation}/>
    {stagingDelivery?<StagingTestDeliveryPanel/>:null}
  </section>;
}
