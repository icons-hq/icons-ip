import { ShipmentConsoleScreen } from '@/components/admin/screens/ShipmentConsoleScreen';
import { normalizeShipmentFilters } from '@/lib/admin/shipment-dispatch';
import { getShipmentConsoleData } from '@/lib/admin/shipment-dispatch.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

export default async function AdminSalesShippingPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
  await requireAdminScreenAccess('/admin/sales/shipping');
  const params=await searchParams;
  const data=await getShipmentConsoleData(normalizeShipmentFilters(params,'shipping'),'shipping');
  const registered=params.registered;
  const registeredCount=typeof registered==='string'&&/^\d{1,4}$/.test(registered)&&Number(registered)>=1&&Number(registered)<=1000?Number(registered):null;
  return <ShipmentConsoleScreen data={data} registeredCount={registeredCount}/>;
}
