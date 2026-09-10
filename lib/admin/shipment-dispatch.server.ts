import 'server-only';
import {createClient} from '@/lib/supabase/server';
import {getShippingCarrierRegistry} from '@/lib/orders/shipment.server';
import {SHIPMENT_CONSOLE_PAGE_SIZE,type ShipmentConsoleData,type ShipmentConsoleFilters,type ShipmentConsoleSurface} from './shipment-dispatch';
import {deliveryObject,parseShipmentDeliverySummary} from '@/lib/shipment-delivery';
export async function getShipmentConsoleData(filters:ShipmentConsoleFilters,surface:ShipmentConsoleSurface):Promise<ShipmentConsoleData>{
 const client=await createClient();const pageSize=SHIPMENT_CONSOLE_PAGE_SIZE;
 const [result,origins,carriers]=await Promise.all([
  client.rpc('admin_search_shipments',{p_tab:filters.tab,p_origin_id:filters.originId,p_query:filters.query||null,p_from:filters.from,p_to:filters.to,p_limit:pageSize,p_offset:(filters.page-1)*pageSize}),
  client.from('fulfillment_origins').select('id,name').order('code'),getShippingCarrierRegistry(),
 ]);
 if(result.error||origins.error||!result.data)throw new Error('배송 건 목록을 불러오지 못했습니다.');
 if(!deliveryObject(result.data)||!Array.isArray(result.data.rows))throw new Error('배송 건 목록을 불러오지 못했습니다.');
 const rows=result.data.rows.map((row:unknown)=>{
  if(!deliveryObject(row))throw new Error('배송 건 목록을 불러오지 못했습니다.');
  const delivery=parseShipmentDeliverySummary(row.delivery);
  if(!delivery)throw new Error('배송 방식을 확인하지 못했습니다. 목록을 새로고침해주세요.');
  return {...row,delivery};
 });
 return {...result.data,rows,surface,filters,pageSize,origins:origins.data??[],carriers} as ShipmentConsoleData;
}
