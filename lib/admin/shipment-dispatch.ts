import type {ShippingCarrierRegistry} from '@/lib/orders/shipment';
import type {ShipmentStatus} from '@/lib/orders/shipments';
import type {ShipmentExportColumn} from './shipment-workbook';
export type ShipmentConsoleTab='new'|'ready'|'delayed'|'transit'|'delivered';
export type ShipmentConsoleSurface='dispatch'|'shipping';
export const SHIPMENT_CONSOLE_PAGE_SIZE=100;
const MAX_SHIPMENT_PAGE=Math.floor(2147483647/SHIPMENT_CONSOLE_PAGE_SIZE)+1;
export const SHIPMENT_CONSOLE_TABS:Record<ShipmentConsoleSurface,readonly {id:ShipmentConsoleTab;label:string}[]>={
 dispatch:[{id:'new',label:'신규 주문'},{id:'ready',label:'발송 대기'},{id:'delayed',label:'발송 지연'}],
 shipping:[{id:'transit',label:'배송 중'},{id:'delivered',label:'배송완료'}],
};
export interface ShipmentConsoleFilters {tab:ShipmentConsoleTab;originId:string|null;query:string;from:string|null;to:string|null;page:number}
export interface ShipmentConsoleRow {
 id:string;orderId:string;originId:string;originName:string;status:ShipmentStatus;createdAt:string;confirmedAt:string|null;
 buyerName:string;recipientName:string|null;total:number;paymentMethod:string;shippingFee:number;carrier:string|null;trackingNumber:string|null;
 shippedAt:string|null;deliveredAt:string|null;exportedAt:string|null;updatedAt:string;delayReason:string|null;expectedShipDate:string|null;
 items:{id:string;name:string;variantName:string|null;qty:number}[];
}
export interface ShipmentConsoleData {
 surface:ShipmentConsoleSurface;filters:ShipmentConsoleFilters;rows:ShipmentConsoleRow[];total:number;pageSize:number;
 counts:Record<ShipmentConsoleTab,number>;carriers:ShippingCarrierRegistry;origins:{id:string;name:string}[];
}
export interface ShipmentExportData {shipments:{id:string;updatedAt:string;originId:string;originName:string;shippingFee:number;template:string;columns:ShipmentExportColumn[];lines:import('./shipment-workbook').ShipmentExportLine[]}[]}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const one=(value:string|string[]|undefined)=>typeof value==='string'?value.trim():'';
function date(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;const d=new Date(value+'T00:00:00Z');return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===value?value:null;}
export function normalizeShipmentFilters(params:Record<string,string|string[]|undefined>,surface:ShipmentConsoleSurface):ShipmentConsoleFilters{
 const tabs=SHIPMENT_CONSOLE_TABS[surface];const tab=one(params.tab);let from=date(one(params.from)),to=date(one(params.to));
 if(from&&to&&from>to){from=null;to=null;}const page=Number(one(params.page)),query=one(params.query),originId=one(params.originId);
 return {tab:tabs.some(t=>t.id===tab)?tab as ShipmentConsoleTab:tabs[0].id,originId:UUID.test(originId)?originId.toLowerCase():null,
 query:query.length<=100?query:'',from,to,page:Number.isSafeInteger(page)&&page>0&&page<=MAX_SHIPMENT_PAGE?page:1};
}
export function shipmentConsoleHref(surface:ShipmentConsoleSurface,filters:ShipmentConsoleFilters,overrides:Partial<ShipmentConsoleFilters>={}){
 const next={...filters,...overrides};const query=new URLSearchParams({tab:next.tab,page:String(next.page)});
 for(const key of ['originId','query','from','to'] as const)if(next[key])query.set(key,next[key]);
 return `/admin/sales/${surface}?${query}`;
}
export function shipmentMutationError(code:string):string{
 const warehouseErrors:Record<string,string>={
  warehouse_origin_required:'김포 회신을 등록할 출고지를 선택해주세요.',
  warehouse_origin_not_found:'선택한 출고지를 찾을 수 없습니다. 목록을 새로고침해주세요.',
  warehouse_origin_inactive:'현재 사용 중인 출고지를 선택해주세요.',
  warehouse_template_required:'선택한 출고지의 양식을 김포 WMS로 설정한 뒤 다시 올려주세요.',
  warehouse_carrier_required:'출고지 설정에서 기본 택배사를 먼저 선택해주세요.',
  invalid_tracking_batch:'운송장은 한 번에 1~1,000줄까지 등록할 수 있습니다.',
  invalid_tracking_row:'회신 행의 주문번호와 운송장번호를 확인해주세요.',
  invalid_warehouse_order_reference:'주문번호(쇼핑몰)에 ICONS 출고 파일의 전체 주문번호를 그대로 유지해주세요.',
  conflicting_shipment_tracking:'같은 주문에 서로 다른 운송장이 있습니다. 해당 주문의 모든 행을 함께 확인해주세요.',
 };
 if(warehouseErrors[code])return warehouseErrors[code];
 const known:Record<string,string>={shipment_reference_required:'배송 건이 여러 개이거나 번호가 겹칩니다. 전체 배송건번호로 등록해주세요.',shipment_not_found:'배송 건을 찾을 수 없습니다.',invalid_shipment_reference:'배송건번호 형식을 확인해주세요.',duplicate_shipment_reference:'앞선 행과 같은 배송 건입니다.',invalid_shipment_transition:'발주확인 또는 현재 배송 상태를 확인해주세요.',tracking_required:'택배사와 운송장번호가 필요합니다.',invalid_tracking_input:'운송장번호 형식을 확인해주세요.',inactive_shipping_carrier:'현재 사용 중인 택배사를 선택해주세요.',order_not_shipped:'발송된 배송 건만 운송장을 정정할 수 있습니다.','order cancellation in progress':'취소·반품·교환 처리가 진행 중입니다. 주문 상세를 확인해주세요.'};
 return known[code]??'처리하지 못했습니다. 최신 상태를 확인한 뒤 다시 시도해주세요.';
}
