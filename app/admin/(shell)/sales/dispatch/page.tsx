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
    <AutoOrderConfirmPanel key={autoConfirmation?`${autoConfirmation.revision}:${autoConfirmation.lastRun?.finishedAt??autoConfirmation.lastRun?.startedAt??''}`:'unavailable'} initial={autoConfirmation}/>
    {stagingDelivery?<StagingTestDeliveryPanel/>:null}
    <ShipmentConsoleScreen data={data} actorId={auth.user.id}/>
  </section>;
}
