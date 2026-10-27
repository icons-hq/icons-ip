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
  return <section className="wc-admin-kit wc-admin-kit__screen">
    {/* key를 두지 않는다 — 저장 뒤 다시 그릴 때 패널이 새로 마운트되면 저장 결과 문구와 포커스가 사라진다. 새 설정은 패널이 맞춘다. */}
    <AutoOrderConfirmPanel initial={autoConfirmation}/>
    {stagingDelivery?<StagingTestDeliveryPanel/>:null}
    <ShipmentConsoleScreen data={data} actorId={auth.user.id}/>
  </section>;
}
