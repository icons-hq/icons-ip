import 'server-only';
import {parseShipmentProductionSummary} from '@/lib/order-production';
import {parseShipmentPackSummary} from './shipment-packs';
import {parseShipmentCollectSummaries} from './shipment-collect';
import {createClient} from '@/lib/supabase/server';
import {getShippingCarrierRegistry} from '@/lib/orders/shipment.server';
import {SHIPMENT_CONSOLE_PAGE_SIZE,type ShipmentConsoleData,type ShipmentConsoleFilters,type ShipmentConsoleSurface} from './shipment-dispatch';
import {deliveryObject,parseShipmentDeliverySummary} from '@/lib/shipment-delivery';
import {parseShipmentDelayNotice} from './shipment-delay-notice';
import {parseShipmentTrackingSummaries} from './shipment-tracking';
/** 화면 목록 수와 출력 페이지 크기를 같은 필터·정렬로 적용한다. RPC 상한은 1,000건이다. */
export async function getShipmentConsoleData(filters:ShipmentConsoleFilters,surface:ShipmentConsoleSurface,options:{pageSize?:number}={}):Promise<ShipmentConsoleData>{
 const client=await createClient();const pageSize=Math.min(Math.max(Math.trunc(options.pageSize??filters.pageSize??SHIPMENT_CONSOLE_PAGE_SIZE)||SHIPMENT_CONSOLE_PAGE_SIZE,1),1000);
 const [result,origins,carriers]=await Promise.all([
  client.rpc(surface==='dispatch'?'admin_search_shipments_notice_console':'admin_search_shipments_console',{p_tab:filters.tab,p_origin_id:filters.originId,p_query:filters.query||null,p_from:filters.from,p_to:filters.to,p_limit:pageSize,p_offset:(filters.page-1)*pageSize,
   p_field:filters.field??'all',p_date_field:filters.dateField??'ordered',p_method:filters.method??null,p_payment_method:filters.paymentMethod??null,p_sort:filters.sort??'oldest',...(surface==='dispatch'?{p_delay_notice_status:filters.delayNotice??null}:{})}),
  client.from('fulfillment_origins').select('id,name,export_template,is_active,default_carrier').order('code'),getShippingCarrierRegistry(),
 ]);
 if(result.error||origins.error||!result.data)throw new Error('배송 건 목록을 불러오지 못했습니다.');
 if(!deliveryObject(result.data)||!Array.isArray(result.data.rows))throw new Error('배송 건 목록을 불러오지 못했습니다.');
 if(surface==='dispatch'&&(typeof result.data.delayNoticeFingerprint!=='string'||!/^[a-f0-9]{64}$/.test(result.data.delayNoticeFingerprint)))throw new Error('지연 안내 상태를 확인하지 못했습니다. 목록을 새로고침해주세요.');
 const ids=result.data.rows.map((row:{id:string})=>row.id);
 /* 착불 요약(배송 건별 착불 배송비·수납 정보)은 출고 전용 운영자도 읽는다(2026-11-12 "착불 금액은 보이게"). 합포장 착불 합계는 합포장 요약에 있다. */
 const [packing,production,collecting]=ids.length?await Promise.all([client.rpc('admin_shipment_pack_summaries',{p_ids:ids}),client.rpc('admin_shipment_production_summaries',{p_ids:ids}),
  client.rpc('admin_shipment_collect_summaries',{p_ids:ids})]):[{data:{},error:null},{data:{},error:null},{data:{},error:null}];
 if(production.error||!deliveryObject(production.data))throw new Error('제작 현황을 확인하지 못했습니다.');
 if(packing.error||!deliveryObject(packing.data))throw new Error('합포장 정보를 확인하지 못했습니다.');
 const collect=collecting.error?null:parseShipmentCollectSummaries(collecting.data,ids);
 if(!collect)throw new Error('착불 정보를 확인하지 못했습니다.');
 // 배송현황만 추가 운송장·자동 배송완료 표시를 읽는다(발주·발송 목록은 발송 전 건이라 추가 운송장이 없다).
 const trackingResult=surface==='shipping'&&ids.length?await client.rpc('admin_shipment_tracking_summaries',{p_ids:ids}):null;
 const tracking=trackingResult?parseShipmentTrackingSummaries(trackingResult.data,ids):null;
 if(trackingResult&&(trackingResult.error||!tracking))throw new Error('운송장 정보를 확인하지 못했습니다. 목록을 새로고침해주세요.');
 const rows=result.data.rows.map((row:unknown)=>{
  if(!deliveryObject(row))throw new Error('배송 건 목록을 불러오지 못했습니다.');
  const rawPack=packing.data[row.id as string];const pack=rawPack===null?null:parseShipmentPackSummary(rawPack);
  if(rawPack!==null&&!pack)throw new Error('합포장 정보를 확인하지 못했습니다.');
  const productionSummary=parseShipmentProductionSummary(production.data[row.id as string]);
  if(!productionSummary)throw new Error('제작 현황을 확인하지 못했습니다.');
  const delivery=parseShipmentDeliverySummary(row.delivery);
  if(!delivery)throw new Error('배송 방식을 확인하지 못했습니다. 목록을 새로고침해주세요.');
  const collectSummary=collect.get(String(row.id).toLowerCase())??null;
  if(surface!=='dispatch')return {...row,delivery,pack,collect:collectSummary,production:productionSummary,...(tracking?{trackingSummary:tracking.shipments[row.id as string]}:{})};
  const delayNotice=parseShipmentDelayNotice(row.delayNotice);
  if(!delayNotice)throw new Error('지연 안내 상태를 확인하지 못했습니다. 목록을 새로고침해주세요.');
  return {...row,delivery,delayNotice,pack,collect:collectSummary,production:productionSummary};
 });
 const originRows=(origins.data??[]) as {id:string;name:string;export_template?:string;is_active?:boolean;default_carrier?:string|null}[];
 return {...result.data,rows,surface,filters,pageSize,carriers,...(tracking?{autoDelivery:tracking.autoDelivery}:{}),
  origins:originRows.map(origin=>({id:origin.id,name:origin.name,template:origin.export_template,active:origin.is_active,defaultCarrier:origin.default_carrier??null}))} as ShipmentConsoleData;
}
