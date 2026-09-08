import { ShipmentConsoleScreen } from '@/components/admin/screens/ShipmentConsoleScreen';
import { normalizeShipmentFilters } from '@/lib/admin/shipment-dispatch';
import { getShipmentConsoleData } from '@/lib/admin/shipment-dispatch.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

export default async function AdminSalesDispatchPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  await requireAdminScreenAccess('/admin/sales/dispatch');
  const data=await getShipmentConsoleData(normalizeShipmentFilters(await searchParams,'dispatch'),'dispatch');
  return <ShipmentConsoleScreen data={data}/>;
}
