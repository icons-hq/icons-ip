'use server';
import { isUuid } from '@/lib/uuid';
import {canAccessAdminScreen,hasAdminCapability} from '@/lib/admin/access';
import {revalidatePath} from 'next/cache';
import {requireAdminActionAccess} from '@/lib/admin/action-access.server';
import {createClient} from '@/lib/supabase/server';
import {buildShipmentExport} from '@/lib/admin/shipment-workbook.server';
import {withSmartStoreLegacyAllocations} from '@/lib/admin/item-allocation.server';
import {recipientOnlyShipmentExport} from '@/lib/admin/shipment-export-recipient-only';
import {seowonExportLabels} from '@/lib/admin/seowon-exchange';
import {randomUUID} from 'node:crypto';
import {shipmentMutationError,type ShipmentExportData} from '@/lib/admin/shipment-dispatch';
import {parseShipmentExportColumns,shipmentBarcodeGapWarning,type ShipmentExportLayout} from '@/lib/admin/shipment-workbook';
import {exportPasswordError} from '@/lib/admin/export-password';
import {encryptAdminWorkbook} from '@/lib/admin/encrypted-workbook.server';
import {unstable_rethrow} from 'next/navigation';
import {findShippingCarrier,isTrackingNumber,normalizeTrackingNumber} from '@/lib/orders/shipment';
import {getShippingCarrierRegistry} from '@/lib/orders/shipment.server';
import {enqueueOrderShippedEmails} from '@/lib/email/order-shipment-jobs.server';
import {DISPATCH_HANDOFF_METHODS,DISPATCH_METHODS,DISPATCH_REASON_MAX_LENGTH,DISPATCH_TARGET_LIMIT,dispatchDeliveryError,parseDispatchDeliveryOptions,parseDispatchDeliveryReceipt,
 type DispatchDeliveryOptions,type DispatchDeliveryReceipt,type DispatchHandoffInput,type DispatchMethod} from '@/lib/admin/dispatch-delivery';
const INSTANT=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
function selection(value:unknown):string[]|null {if(!Array.isArray(value)||!value.length||value.length>1000||!value.every(id=>typeof id==='string'&&isUuid(id)))return null;return [...new Set((value as string[]).map(id=>id.toLowerCase()))];}
/** 출고지시·배송완료는 출고 전용 권한(sales.dispatch, 1014-084)으로 한다. sales.manage도 이 권한을 포함한다. */
const SHIPMENT_PATH='/admin/sales/dispatch';
async function staff(){return requireAdminActionAccess(SHIPMENT_PATH,{capability:'sales.dispatch'});}
/** 화면이 백그라운드로 부르는 읽기 전용 경고용. 세션이 끝나도 로그인으로 옮기지 않고 거절(null)만 돌려준다. */
async function backgroundStaff(){return requireAdminActionAccess(SHIPMENT_PATH,{capability:'sales.dispatch',onUnauthenticated:'error'});}
/**
 * 발송처리 화면의 행 운송장·배송 방법·택배 외 일괄 인계(S36-072·S36-X04) 액션이 요구하는 능력. 물류 출고 권한(sales.dispatch, 1014-084)이고
 * sales.manage도 이 권한을 포함한다. DB는 private.dispatch_console_capability()가 같은 값을 둔다(통합 migration 20261112200000).
 * 운영 강제 배송완료는 sales.manage 그대로다.
 */
const DISPATCH_CONSOLE_CAPABILITY='sales.dispatch' as const;
async function dispatchStaff(){return requireAdminActionAccess(SHIPMENT_PATH,{capability:DISPATCH_CONSOLE_CAPABILITY});}
function refresh(){revalidatePath('/admin/sales/dispatch');revalidatePath('/admin/sales/shipping');revalidatePath('/admin/sales/orders');revalidatePath('/orders');}
/** 발송·인계 기록은 고객 주문 화면과 주문 상세(팝업 포함)에도 바로 보여야 한다. */
function refreshDispatched(){refresh();revalidatePath('/orders/[orderId]','page');revalidatePath('/admin/sales/orders/[orderId]','page');}
type Client=Awaited<ReturnType<typeof createClient>>;
type ExportCredentials={password:string;passwordConfirmation:string};
type ExportResult={error:string;file?:undefined;message?:undefined}|{file:{base64:string;mime:string;name:string;encryption?:'ECMA-376-Agile';sha256?:string};message:string;error?:undefined};
function exportInputError(format:unknown,layout:unknown,credentials?:ExportCredentials){
 if(!['xlsx','csv'].includes(String(format))||!['smartstore','warehouse'].includes(String(layout)))return '파일 형식과 양식을 확인해주세요.';
 return layout==='smartstore'&&format==='xlsx'?exportPasswordError(credentials?.password,credentials?.passwordConfirmation):null;
}
/** Build and encrypt successfully before recording a warehouse handover. */
async function exportShipments(client:Client,keys:string[],format:'xlsx'|'csv',layout:ShipmentExportLayout,credentials?:ExportCredentials,note='',readsOrderAmounts=true):Promise<ExportResult>{
 const result=await client.rpc(layout==='smartstore'?'admin_smartstore_shipment_export':'admin_shipment_export',{p_ids:keys});
 const exportError=result.error?.message??'';
 if(result.error||!result.data)return {error:exportError.startsWith('shipment_pack_')||exportError.startsWith('production_')||['shipment_item_export_mismatch','shipment_price_allocation_missing'].includes(exportError)?shipmentMutationError(exportError):exportError==='order cancellation in progress'?'재고 부족 부분 취소 또는 취소 요청이 진행 중인 주문이 포함되어 있어 출고지시를 만들지 못했습니다. 취소 처리가 끝난 뒤 다시 시도해주세요.':'발송 대기 상태와 취소 요청을 확인해주세요. 출고지시를 만들지 못했습니다.'};
 let data=result.data as ShipmentExportData;
 // 버전 1 할인 주문의 품목 금액은 거래확정 엑셀과 같은 공통 배분으로 채운다(10/14 회의 A5).
 // 1014-084 사용자 결정 "수령인 정보만": 주문 조회 권한(sales.read)이 없는 출고 전용 운영자가 받는 출고지시 파일은 어느 양식이든
 // (ICONS 표준 양식, 김포 21열의 주문금액/수량·배송비(수집), 배송 운영 안내의 선불 배송비) 구매자·결제·금액 칸을 모든 줄에서 비운다.
 // DB가 비워 보내고 여기서 한 번 더 비우므로 금액 배분도 읽지 않는다(일부 줄만 채우지 않게). 수량은 출고에 필요해 남는다.
 // 착불 배송비·합포장 착불 합계·착불 수납 정보는 남긴다(2026-11-12 "착불 금액은 보이게").
 // ShipmentExportData는 주문 조회 권한자의 계약(금액 숫자)이라 비운 사본은 cast로 넘기고, 빌더가 null 칸을 빈칸으로 그린다.
 const recipientOnly=!readsOrderAmounts;
 if(layout==='smartstore'&&readsOrderAmounts){try{data=await withSmartStoreLegacyAllocations(data,client);}catch{return {error:'주문 당시 금액 배분을 확인하지 못했습니다. 잠시 후 다시 내려받아 주세요.'};}}
 if(recipientOnly)data=recipientOnlyShipmentExport(data) as unknown as ShipmentExportData;
 try{
  let file=recipientOnly?await buildShipmentExport(data,format,layout,undefined,{recipientOnly}):await buildShipmentExport(data,format,layout);let sha256:string|undefined;
  if(layout==='smartstore'&&format==='xlsx'){
   const plain=file.bytes;
   try{const protectedFile=encryptAdminWorkbook(plain,credentials!.password);file={...file,bytes:protectedFile.bytes};sha256=protectedFile.sha256;}
   finally{plain.fill(0);}
  }
  const versions=data.shipments.map(shipment=>({id:shipment.id,updatedAt:shipment.updatedAt}));
  // 서원 원형 양식의 이름 접미사는 파일 구성으로 정해진다. 전달 표시와 같은 트랜잭션에서 배송 건별로 기록해 회신과 정확히 맞춘다.
  const labels=layout==='warehouse'?seowonExportLabels(data.shipments.map(shipment=>({id:shipment.id,shipmentNumber:shipment.shipmentNumber??null,packId:shipment.pack?.id??null,originId:shipment.originId,template:shipment.template,lines:shipment.lines}))):[];
  const mark=labels.length
   ?await client.rpc('admin_mark_seowon_shipments_exported',{target_versions:versions,target_batch:randomUUID(),target_labels:labels})
   :await client.rpc('admin_mark_shipments_exported',{target_versions:versions});
  if(mark.error||mark.data!==keys.length)return {error:'배송 상태가 변경되었습니다. 목록을 새로고침한 뒤 다시 내보내주세요.'};
  const multipleOrigins=layout==='warehouse'&&new Set(data.shipments.map(shipment=>shipment.originId)).size>1;
  const operational=data.shipments.some(shipment=>shipment.isGift||(shipment.shippingCollectFee??0)>0||shipment.pack);
  const extra=operational?(file.extension==='xlsx'?' 별도 배송 운영 안내 시트에서 합포장·선물 포장·착불 조건을 함께 확인해주세요.':' ZIP에 포함된 각 출고 파일과 배송 운영 안내에서 합포장·선물 포장·착불 조건을 함께 확인해주세요.'):' ';
  refresh();
  // 화면의 바코드 경고는 내보내기 전에 읽은 값이라 그 사이 바코드가 바뀌었을 수 있다(리뷰 M27-SHIP-1).
  // 실제로 내보낸 배송 건으로 누른 시점에 그 양식 기준으로 다시 세어 상태 문구에 싣는다(ICONS 표준 양식은 출고지와 관계없이
  // 모든 행에 바코드 칸이 있다, 1027T-046). 경고라 조회 실패는 생략한다.
  const missing=await barcodeGaps(client,keys,layout);
  return {file:{base64:file.bytes.toString('base64'),mime:file.mime,name:file.name,...(sha256?{encryption:'ECMA-376-Agile' as const,sha256}:{})},
   message:`${`${keys.length}건의 출고지시를 내려받았습니다.${multipleOrigins?' 출고지별 파일을 ZIP으로 묶었습니다. 각 파일을 해당 창고에 전달해주세요.':''}${extra}${note}`.trim()}${missing?` ${shipmentBarcodeGapWarning(missing)}`:''}`};
 }catch(error){return {error:error instanceof Error?error.message:'출고지시 파일을 만들지 못했습니다.'};}
}
export async function exportShipmentsAction(ids:unknown,format:'xlsx'|'csv',layout:ShipmentExportLayout='smartstore',credentials?:ExportCredentials):Promise<ExportResult>{
 const auth=await staff();if(!auth)return {error:'직원 권한이 필요합니다.'};const keys=selection(ids);
 if(!keys)return {error:'내보낼 배송 건을 1~1,000개 선택해주세요.'};
 const invalid=exportInputError(format,layout,credentials);if(invalid)return {error:invalid};
 return exportShipments(await createClient(),keys,format,layout,credentials,'',hasAdminCapability(auth,'sales.read'));
}
/** The origin batch has the same selected layout and password contract as a selected-row export. */
export async function exportPendingOriginShipmentsAction(originId:unknown,format:'xlsx'|'csv',layout:ShipmentExportLayout='smartstore',credentials?:ExportCredentials):Promise<ExportResult>{
 const auth=await staff();if(!auth)return {error:'직원 권한이 필요합니다.'};
 if(typeof originId!=='string'||!isUuid(originId))return {error:'출고지를 선택해주세요.'};
 const invalid=exportInputError(format,layout,credentials);if(invalid)return {error:invalid};
 const client=await createClient();
 const pending=await client.rpc('admin_origin_pending_export_ids',{target_origin_id:originId.toLowerCase()});
 const value=pending.data as {ids?:unknown;total?:unknown}|null;
 if(pending.error||!value||!Array.isArray(value.ids)||!Number.isSafeInteger(value.total)||Number(value.total)<value.ids.length)return {error:'발송 대기 배송 건을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'};
 const keys=value.ids.length?selection(value.ids):[];
 if(!keys)return {error:'발송 대기 배송 건을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'};
 if(!keys.length)return {error:'이 출고지에 아직 전달하지 않은 발송 대기 배송 건이 없습니다. 발주확인과 예약 재고 할당·제작·취소 요청을 확인해주세요.'};
 const rest=Number(value.total)-keys.length;
 return exportShipments(client,keys,format,layout,credentials,rest>0?` 남은 ${rest.toLocaleString('ko-KR')}건은 다시 눌러 이어서 받아주세요.`:'',hasAdminCapability(auth,'sales.read'));
}
/**
 * 내보내기 전 경고(10/27 회의 D10): 선택한 배송 건에서 고른 양식의 출고 파일 바코드 칸이 비는 옵션 수.
 * ICONS 표준 양식은 출고지와 관계없이 모든 행에 바코드 칸이 있어 admin_smartstore_shipment_barcode_gaps로 센다(1027T-046).
 * 경고는 출고를 막지 않으므로 권한·입력·조회 실패는 숫자 대신 null로 돌려 경고만 생략한다.
 */
export async function shipmentBarcodeGapsAction(ids:unknown,layout:ShipmentExportLayout='warehouse'):Promise<number|null>{
 if(!await backgroundStaff()||!isExportLayout(layout))return null;const keys=selection(ids);if(!keys)return null;
 return barcodeGaps(await createClient(),keys,layout);
}
/**
 * 출고지 경고: 그 출고지의 미전달 발송 대기 건 전체에서 바코드가 비는 옵션 수.
 * 탭을 열 때마다 부르므로 무거운 admin_origin_pending_export_ids(다음 파일 한 묶음 계산)를 거치지 않고 출고지 단위로 바로 센다
 * (리뷰 M27-SHIP-2). 다음 파일의 정확한 개수는 내려받을 때 실제로 내보낸 배송 건으로 다시 세어 결과 문구에 싣는다.
 */
export async function originBarcodeGapsAction(originId:unknown,layout:ShipmentExportLayout='warehouse'):Promise<number|null>{
 if(!await backgroundStaff()||!isExportLayout(layout)||typeof originId!=='string'||!isUuid(originId))return null;
 return barcodeGaps(await createClient(),{p_origin_id:originId.toLowerCase()},layout);
}
function isExportLayout(layout:unknown):layout is ShipmentExportLayout{return layout==='smartstore'||layout==='warehouse';}
async function barcodeGaps(client:Client,target:string[]|{p_origin_id:string},layout:ShipmentExportLayout):Promise<number|null>{
 try{
  const result=await client.rpc(layout==='smartstore'?'admin_smartstore_shipment_barcode_gaps':'admin_shipment_barcode_gaps',Array.isArray(target)?{p_ids:target}:target);
  return !result.error&&Number.isSafeInteger(result.data)&&Number(result.data)>=0?Number(result.data):null;
 }catch{return null;}
}
export async function completeShipmentsAction(ids:unknown){
 if(!await staff())return {error:'직원 권한이 필요합니다.'};const keys=selection(ids);
 if(!keys)return {error:'배송완료 처리할 배송 건을 1~1,000개 선택해주세요.'};
 const client=await createClient();const result=await client.rpc('admin_complete_shipments',{target_ids:keys});
 if(result.error||!Array.isArray(result.data))return {error:'배송완료를 처리하지 못했습니다. 최신 상태를 확인해주세요.'};
 const rows=result.data as {id:string;ok:boolean;error?:string;affectedIds?:string[]}[];refresh();
 const completed=new Set(rows.filter(row=>row.ok).flatMap(row=>row.affectedIds??[row.id]));
 return {message:`${completed.size}건을 배송완료로 변경했습니다.`,failed:rows.filter(row=>!row.ok).map(row=>({id:row.id,reason:shipmentMutationError(row.error??'')}))};
}
export async function saveShipmentExportColumnsAction(id:string,columns:unknown,updatedAt:string){
 const auth=await staff();if(!auth||!canAccessAdminScreen(auth,null,{capability:'platform.manage',adminOnly:true}))return {error:'관리자 권한이 필요합니다.'};
 const parsed=parseShipmentExportColumns(columns);
 if(!isUuid(id)||!parsed||!updatedAt)return {error:'모든 표준 컬럼의 헤더와 순서를 확인해주세요.'};
 const client=await createClient();const result=await client.rpc('admin_save_origin_export_columns',{target_id:id,target_columns:parsed,expected_updated_at:updatedAt});
 if(result.error)return {error:'다른 변경이 먼저 저장됐거나 양식이 올바르지 않습니다. 최신 출고지 설정을 확인해주세요.'};
 revalidatePath('/admin/settings/origins');return {message:'출고지시 양식을 저장했습니다.',updatedAt:result.data as string};
}

export type ShipmentTrackingRowInput={shipmentId:string;carrier:string;trackingNumber:string};
export type ShipmentTrackingRowResult={ok:true;message:string;registered:string[];unchanged:string[];failed:{shipmentId:string;reason:string}[];queueWarning:boolean}|{ok:false;error:string};
type TrackingBatchRow={line:number;reference:string;ok:boolean;error?:string;shipmentId?:string;orderId?:string;dispatched?:boolean;packedShipments?:{orderId:string;shipmentId:string}[]};
/**
 * 발송 대기 행의 택배사·운송장 칸(S36-072). 창고 회신 파일과 같은 일괄 등록 RPC에 1~100건을 그대로 넘긴다 —
 * 합포장은 묶음 전체에 적용되고, 이미 발송된 배송 건의 운송장은 덮어쓰지 않는다(같은 번호는 그대로, 다르면 실패).
 */
export async function registerShipmentTrackingAction(input:unknown):Promise<ShipmentTrackingRowResult>{
 if(!await dispatchStaff())return {ok:false,error:'직원 권한이 필요합니다.'};
 if(!Array.isArray(input)||!input.length||input.length>DISPATCH_TARGET_LIMIT)return {ok:false,error:'운송장을 등록할 배송 건을 다시 확인해주세요.'};
 const carriers=await getShippingCarrierRegistry();const rows:{line:number;reference:string;carrier:string;trackingNumber:string}[]=[];
 for(const [index,value] of input.entries()){
  const {shipmentId,carrier,trackingNumber}=(typeof value==='object'&&value!==null?value:{}) as Record<string,unknown>;
  if(typeof shipmentId!=='string'||!isUuid(shipmentId)||rows.some(row=>row.reference===shipmentId.toLowerCase()))return {ok:false,error:'운송장을 등록할 배송 건을 다시 확인해주세요.'};
  const selected=typeof carrier==='string'?findShippingCarrier(carriers,carrier):null;
  if(!selected?.active)return {ok:false,error:shipmentMutationError('inactive_shipping_carrier')};
  const tracking=typeof trackingNumber==='string'?normalizeTrackingNumber(trackingNumber):'';
  if(!isTrackingNumber(tracking))return {ok:false,error:'운송장번호는 하이픈을 뺀 8~30자리 영숫자여야 합니다.'};
  rows.push({line:index+1,reference:shipmentId.toLowerCase(),carrier:selected.code,trackingNumber:tracking});
 }
 try{
  const result=await (await createClient()).rpc('admin_import_shipment_tracking_batch',{target_rows:rows});
  if(result.error?.message&&/^(shipment_pack_|inactive_shipping_carrier$|invalid_tracking_)/.test(result.error.message))return {ok:false,error:shipmentMutationError(result.error.message)};
  if(result.error||!Array.isArray(result.data)||result.data.length!==rows.length)return {ok:false,error:'등록 결과를 확인하지 못했습니다. 목록을 새로고침해 배송 상태를 확인해주세요.'};
  const data=result.data as TrackingBatchRow[];
  const registered=data.filter(row=>row.ok&&row.dispatched!==false).map(row=>row.reference);
  const unchanged=data.filter(row=>row.ok&&row.dispatched===false).map(row=>row.reference);
  const failed=data.filter(row=>!row.ok).map(row=>({shipmentId:row.reference,reason:shipmentMutationError(row.error??'')}));
  const deliveries=data.filter(row=>row.ok&&row.dispatched!==false&&row.shipmentId&&row.orderId).flatMap(row=>row.packedShipments??[{orderId:row.orderId!,shipmentId:row.shipmentId!}]);
  let queueWarning=false;
  if(deliveries.length){try{await enqueueOrderShippedEmails([...new Map(deliveries.map(row=>[row.shipmentId,row])).values()]);}catch{queueWarning=true;}}
  if(registered.length||unchanged.length)refreshDispatched();
  const message=registered.length?`운송장 ${registered.length}건을 등록해 배송 중으로 옮겼습니다.${queueWarning?' 배송 메일 대기열 확인이 필요합니다. 주문 상세의 배송 안내 메일에서 확인해주세요.':' 배송 메일은 대기열에서 처리됩니다.'}`
   :unchanged.length?'같은 운송장으로 이미 발송된 배송 건입니다. 그대로 두었습니다.':'운송장을 등록하지 못했습니다.';
  return {ok:true,message,registered,unchanged,failed,queueWarning};
 }catch(error){unstable_rethrow(error);return {ok:false,error:'등록 결과를 확인하지 못했습니다. 목록을 새로고침해 배송 상태를 확인해주세요.'};}
}

/** 발송처리 화면의 배송 방법 팝업(S36-072·S36-X04)이 여는 대상 정보. 고객이 고른 방법·처리 가능 여부·켜진 운영 조건. */
export async function readDispatchDeliveryOptionsAction(ids:unknown):Promise<{ok:true;options:DispatchDeliveryOptions}|{ok:false;error:string}>{
 if(!await dispatchStaff())return {ok:false,error:'직원 권한이 필요합니다.'};
 const keys=selection(ids);
 if(!keys||keys.length>DISPATCH_TARGET_LIMIT)return {ok:false,error:`배송 건을 1~${DISPATCH_TARGET_LIMIT}개 선택해주세요.`};
 try{
  const {data,error}=await (await createClient()).rpc('admin_dispatch_delivery_options',{p_shipment_ids:keys});
  const options=error?null:parseDispatchDeliveryOptions(data);
  return options?{ok:true,options}:{ok:false,error:'배송 방법 정보를 불러오지 못했습니다. 잠시 후 다시 열어주세요.'};
 }catch(error){unstable_rethrow(error);return {ok:false,error:'배송 방법 정보를 불러오지 못했습니다. 잠시 후 다시 열어주세요.'};}
}

export interface DispatchDeliveryRequest{targets:{shipmentId:string;updatedAt:string}[];method:DispatchMethod;reason:string;handoff:DispatchHandoffInput|null;operationId:string}
function dispatchRequest(input:unknown):DispatchDeliveryRequest|null{
 if(typeof input!=='object'||input===null)return null;
 const {targets,method,reason,handoff,operationId}=input as Record<string,unknown>;
 if(!Array.isArray(targets)||!targets.length||targets.length>DISPATCH_TARGET_LIMIT||!DISPATCH_METHODS.includes(method as DispatchMethod)
  ||typeof reason!=='string'||reason.trim().length>DISPATCH_REASON_MAX_LENGTH||typeof operationId!=='string'||!isUuid(operationId))return null;
 const parsed:DispatchDeliveryRequest['targets']=[];
 for(const target of targets){
  const {shipmentId,updatedAt}=(typeof target==='object'&&target!==null?target:{}) as Record<string,unknown>;
  if(typeof shipmentId!=='string'||!isUuid(shipmentId)||typeof updatedAt!=='string'||!INSTANT.test(updatedAt)||parsed.some(row=>row.shipmentId===shipmentId.toLowerCase()))return null;
  parsed.push({shipmentId:shipmentId.toLowerCase(),updatedAt});
 }
 let evidence:DispatchHandoffInput|null=null;
 if(handoff!==null){
  if(typeof handoff!=='object'||!DISPATCH_HANDOFF_METHODS.includes(method as DispatchMethod))return null;
  const fields=handoff as Record<string,unknown>;const keys=['operatorName','providerName','providerPhone','handoffReference','occurredAt'] as const;
  if(Object.keys(fields).some(key=>!(keys as readonly string[]).includes(key))||keys.some(key=>typeof fields[key]!=='string'||!(fields[key] as string).trim())||!INSTANT.test(String(fields.occurredAt)))return null;
  evidence=Object.fromEntries(keys.map(key=>[key,(fields[key] as string).trim()])) as unknown as DispatchHandoffInput;
 }
 return {targets:parsed,method:method as DispatchMethod,reason:reason.trim(),handoff:evidence,operationId:operationId.toLowerCase()};
}
/**
 * 고른 배송 건에 방법을 적용하고, 퀵·직접배송·화물배송이면 실제 인계 근거까지 남긴다. 배송비·결제 금액은
 * 그대로이고, 고객이 고른 방법과 다르면 사유가 필요하다. 배송 건마다 결과를 돌려준다.
 */
export async function applyDispatchDeliveryAction(input:unknown):Promise<{ok:true;receipt:DispatchDeliveryReceipt}|{ok:false;error:string}>{
 if(!await dispatchStaff())return {ok:false,error:'직원 권한이 필요합니다.'};
 const request=dispatchRequest(input);
 if(!request)return {ok:false,error:dispatchDeliveryError('invalid_dispatch_delivery_request')};
 try{
  const {data,error}=await (await createClient()).rpc('admin_dispatch_apply_delivery',{p_targets:request.targets,p_method:request.method,
   p_reason:request.reason||null,p_handoff:request.handoff,p_operation_id:request.operationId});
  if(error)return {ok:false,error:dispatchDeliveryError(error.message)};
  const receipt=parseDispatchDeliveryReceipt(data);
  if(!receipt||receipt.operationId!==request.operationId||receipt.results.length!==request.targets.length)return {ok:false,error:dispatchDeliveryError()};
  if(receipt.changed||receipt.handedOff)refreshDispatched();
  return {ok:true,receipt};
 }catch(error){unstable_rethrow(error);return {ok:false,error:dispatchDeliveryError()};}
}
