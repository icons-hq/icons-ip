import {productionError} from '@/lib/order-production';
import {FULFILLMENT_METHODS,type FulfillmentMethod} from '@/lib/goods-fulfillment';
import {shipmentPackError} from './shipment-packs';
import type {ShippingCarrierRegistry} from '@/lib/orders/shipment';
import type {ShipmentStatus} from '@/lib/orders/shipments';
import type {ShipmentExportColumn} from './shipment-workbook';
import type {ShipmentDeliverySummary} from '@/lib/shipment-delivery';
import {SHIPMENT_DELAY_NOTICE_OPTIONS,type ShipmentDelayNoticeStatus,type ShipmentDelayNoticeSummary} from './shipment-delay-notice';
import {appendSalesListOptions,normalizeSalesListOptions,salesDateField,salesPage,salesParam,SHIPMENT_PAGE_SIZES,type SalesDateField,type SalesListOptions} from './sales-list';
export type ShipmentConsoleTab='new'|'ready'|'delayed'|'transit'|'delivered';
export type ShipmentConsoleSurface='dispatch'|'shipping';
export const SHIPMENT_CONSOLE_PAGE_SIZE=100;
export const SHIPMENT_CONSOLE_TABS:Record<ShipmentConsoleSurface,readonly {id:ShipmentConsoleTab;label:string}[]>={
 dispatch:[{id:'new',label:'신규주문'},{id:'ready',label:'발송 대기'},{id:'delayed',label:'발송 지연'}],
 shipping:[{id:'transit',label:'배송중'},{id:'delivered',label:'배송완료'}],
};
export const SHIPMENT_SEARCH_FIELDS = [
 {value:'all',label:'전체'},{value:'order',label:'주문번호'},{value:'shipment',label:'배송건번호'},
 {value:'buyer',label:'구매자명'},{value:'recipient',label:'수취인명'},{value:'tracking',label:'운송장번호'},{value:'product',label:'상품명 · 옵션'},
] as const;
export interface ShipmentConsoleFilters extends SalesListOptions {
 tab:ShipmentConsoleTab;originId:string|null;query:string;from:string|null;to:string|null;page:number;
 field?:Exclude<(typeof SHIPMENT_SEARCH_FIELDS)[number]['value'],'all'>;dateField?:SalesDateField;
 method?:FulfillmentMethod;paymentMethod?:'card'|'bank_transfer';
 delayNotice?:ShipmentDelayNoticeStatus;
}
export interface ShipmentConsoleRow {
 orderNumber?:string;shipmentNumber?:string;
 id:string;orderId:string;originId:string;originName:string;status:ShipmentStatus;createdAt:string;confirmedAt:string|null;
 buyerName:string;recipientName:string|null;total:number;paymentMethod:string;shippingFee:number;carrier:string|null;trackingNumber:string|null;
 shippedAt:string|null;deliveredAt:string|null;exportedAt:string|null;updatedAt:string;delayReason:string|null;expectedShipDate:string|null;
 items:{id:string;productOrderNumber?:string;name:string;variantName:string|null;customInputs?:import('@/lib/goods-custom-inputs').GoodsCustomInputSelection|null;qty:number}[];
 originalExpectedShipDate?:string|null;preorderReady?:boolean;delivery?:ShipmentDeliverySummary|null;
 delayNotice?:ShipmentDelayNoticeSummary;
 pack?:import('./shipment-packs').ShipmentPackSummary|null;
 production?:import('@/lib/order-production').ShipmentProductionSummary;
}
export interface ShipmentConsoleData {
 surface:ShipmentConsoleSurface;filters:ShipmentConsoleFilters;rows:ShipmentConsoleRow[];total:number;pageSize:number;
 counts:Record<ShipmentConsoleTab,number>;carriers:ShippingCarrierRegistry;origins:ShipmentConsoleOrigin[];
 delayNoticeFingerprint?:string;
}
export interface ShipmentExportData {shipments:{id:string;shipmentNumber?:string|null;orderNumber?:string|null;updatedAt:string;originId:string;originName:string;shippingFee:number;shippingCollectFee?:number;pack?:import('./shipment-packs').ShipmentPackSummary|null;isGift?:boolean;collector?:import('@/lib/goods-transaction').GoodsTransactionCollector|null;template:string;columns:ShipmentExportColumn[];lines:import('./shipment-workbook').ShipmentExportLine[]}[]}
/** 양식·사용 여부는 출고지별 내려받기 버튼의 표시 기준입니다. */
export interface ShipmentConsoleOrigin {id:string;name:string;template?:string;active?:boolean}
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const one=(value:string|string[]|undefined)=>typeof value==='string'?value.trim():'';
function date(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;const d=new Date(value+'T00:00:00Z');return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===value?value:null;}
export function normalizeShipmentFilters(params:Record<string,string|string[]|undefined>,surface:ShipmentConsoleSurface):ShipmentConsoleFilters{
 const tabs=SHIPMENT_CONSOLE_TABS[surface];const tab=one(params.tab);let from=date(one(params.from)),to=date(one(params.to));
 if(from&&to&&from>to){from=null;to=null;}const query=one(params.query),originId=one(params.originId);
 const listOptions=normalizeSalesListOptions(params,SHIPMENT_CONSOLE_PAGE_SIZE,'oldest',SHIPMENT_PAGE_SIZES);
 const field=salesParam(params,'field'),method=salesParam(params,'method'),paymentMethod=salesParam(params,'paymentMethod');
 const delayNotice=salesParam(params,'delayNotice');
 return {...listOptions,
 ...(surface==='dispatch'&&delayNotice&&SHIPMENT_DELAY_NOTICE_OPTIONS.some(option=>option.value===delayNotice)?{delayNotice:delayNotice as ShipmentDelayNoticeStatus}:{}),
 ...(salesDateField(params)&&salesDateField(params)!=='settled'?{dateField:salesDateField(params)}:{}),
 ...(field!=='all'&&SHIPMENT_SEARCH_FIELDS.some(item=>item.value===field)?{field:field as ShipmentConsoleFilters['field']}:{}),
 ...(FULFILLMENT_METHODS.includes(method as FulfillmentMethod)?{method:method as FulfillmentMethod}:{}),
 ...(['card','bank_transfer'].includes(paymentMethod)?{paymentMethod:paymentMethod as ShipmentConsoleFilters['paymentMethod']}:{}),
 tab:tabs.some(t=>t.id===tab)?tab as ShipmentConsoleTab:tabs[0].id,originId:UUID.test(originId)?originId.toLowerCase():null,
 query:query.length<=100?query:'',from,to,page:salesPage(params.page,listOptions.pageSize??SHIPMENT_CONSOLE_PAGE_SIZE)};
}
export function shipmentConsoleHref(surface:ShipmentConsoleSurface,filters:ShipmentConsoleFilters,overrides:Partial<ShipmentConsoleFilters>={}){
 const next={...filters,...overrides};const query=new URLSearchParams({tab:next.tab,page:String(next.page)});
 appendSalesListOptions(query,next);
 for(const key of ['originId','query','from','to','field','dateField','method','paymentMethod'] as const)if(next[key])query.set(key,next[key]);
 if(surface==='dispatch'&&next.delayNotice)query.set('delayNotice',next.delayNotice);
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
  invalid_item_order_reference:'상품주문번호에 ICONS 출고 파일의 전체 상품주문번호를 유지해주세요.',
  shipment_item_not_found:'상품주문번호에 연결된 배송 건을 찾을 수 없습니다.',
  item_tracking_identity_unresolved:'상품주문번호를 확인할 수 없는 행이 있습니다. 파일의 모든 상품주문번호를 고친 뒤 다시 등록해주세요.',
  shipment_item_export_mismatch:'상품주문과 배송 품목이 일치하지 않습니다. 목록을 새로고침해주세요.',
  shipment_price_allocation_missing:'주문 당시 금액 배분 기록을 확인하지 못했습니다. 주문 상세를 확인해주세요.',
  conflicting_shipment_tracking:'같은 주문에 서로 다른 운송장이 있습니다. 해당 주문의 모든 행을 함께 확인해주세요.',
  shipment_tracking_conflict:'이미 다른 운송장으로 발송된 배송 건입니다. 회신 파일로 덮어쓰지 않습니다. 정정은 주문 통합검색의 운송장 수정에서 해주세요.',
 };
 if(warehouseErrors[code])return warehouseErrors[code];
 if(code.startsWith('production_'))return productionError(undefined,code);
 if(code.startsWith('shipment_pack_'))return shipmentPackError(code);
 const known:Record<string,string>={shipment_reference_required:'배송 건이 여러 개이거나 번호가 겹칩니다. 전체 배송건번호로 등록해주세요.',shipment_not_found:'배송 건을 찾을 수 없습니다.',invalid_shipment_reference:'배송건번호 형식을 확인해주세요.',duplicate_shipment_reference:'앞선 행과 같은 배송 건입니다.',invalid_shipment_transition:'발주확인 또는 현재 배송 상태를 확인해주세요.',tracking_required:'택배사와 운송장번호가 필요합니다.',invalid_tracking_input:'운송장번호 형식을 확인해주세요.',inactive_shipping_carrier:'현재 사용 중인 택배사를 선택해주세요.',order_not_shipped:'발송된 배송 건만 운송장을 정정할 수 있습니다.','order cancellation in progress':'취소·반품·교환 처리가 진행 중입니다. 주문 상세를 확인해주세요.',delivery_method_evidence_required:'퀵·방문수령은 주문 상세의 인계·수령 확인에서 처리해주세요.',preorder_allocation_required:'예약 품목에 실제 입고 물량을 먼저 할당해주세요.'};
 return known[code]??'처리하지 못했습니다. 최신 상태를 확인한 뒤 다시 시도해주세요.';
}
/** Older in-process projections may omit delivery; a present invalid value fails closed. */
export function isParcelShipment(row:Pick<ShipmentConsoleRow,'delivery'>):boolean{return row.delivery===undefined||row.delivery?.method==='parcel';}
export function shipmentConsoleSelectable(row:ShipmentConsoleRow,tab:ShipmentConsoleTab):boolean{
 if(tab==='new')return true; // Order confirmation remains shared by every fulfillment method.
 if(tab==='delivered'||!isParcelShipment(row))return false;
 return tab==='transit'||row.preorderReady!==false&&row.production?.ready!==false;
}
