'use server';
import {canAccessAdminScreen,hasAdminCapability} from '@/lib/admin/access';
import {revalidatePath} from 'next/cache';
import {getCurrentAdminAuthState} from '@/lib/auth/admin';
import {createClient} from '@/lib/supabase/server';
import {buildShipmentExport} from '@/lib/admin/shipment-workbook.server';
import {withSmartStoreLegacyAllocations} from '@/lib/admin/item-allocation.server';
import {seowonExportLabels} from '@/lib/admin/seowon-exchange';
import {randomUUID} from 'node:crypto';
import {shipmentMutationError,type ShipmentExportData} from '@/lib/admin/shipment-dispatch';
import {parseShipmentExportColumns,shipmentBarcodeGapWarning,type ShipmentExportLayout} from '@/lib/admin/shipment-workbook';
import {exportPasswordError} from '@/lib/admin/export-password';
import {encryptAdminWorkbook} from '@/lib/admin/encrypted-workbook.server';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function selection(value:unknown):string[]|null {if(!Array.isArray(value)||!value.length||value.length>1000||!value.every(id=>typeof id==='string'&&UUID.test(id)))return null;return [...new Set((value as string[]).map(id=>id.toLowerCase()))];}
async function staff(){const auth=await getCurrentAdminAuthState();return auth.isConfigured&&auth.user&&auth.isStaff&&hasAdminCapability(auth,'sales.manage')?auth:null;}
function refresh(){revalidatePath('/admin/sales/dispatch');revalidatePath('/admin/sales/shipping');revalidatePath('/admin/sales/orders');revalidatePath('/orders');}
type Client=Awaited<ReturnType<typeof createClient>>;
type ExportCredentials={password:string;passwordConfirmation:string};
type ExportResult={error:string;file?:undefined;message?:undefined}|{file:{base64:string;mime:string;name:string;encryption?:'ECMA-376-Agile';sha256?:string};message:string;error?:undefined};
function exportInputError(format:unknown,layout:unknown,credentials?:ExportCredentials){
 if(!['xlsx','csv'].includes(String(format))||!['smartstore','warehouse'].includes(String(layout)))return '파일 형식과 양식을 확인해주세요.';
 return layout==='smartstore'&&format==='xlsx'?exportPasswordError(credentials?.password,credentials?.passwordConfirmation):null;
}
/** Build and encrypt successfully before recording a warehouse handover. */
async function exportShipments(client:Client,keys:string[],format:'xlsx'|'csv',layout:ShipmentExportLayout,credentials?:ExportCredentials,note=''):Promise<ExportResult>{
 const result=await client.rpc(layout==='smartstore'?'admin_smartstore_shipment_export':'admin_shipment_export',{p_ids:keys});
 const exportError=result.error?.message??'';
 if(result.error||!result.data)return {error:exportError.startsWith('shipment_pack_')||exportError.startsWith('production_')||['shipment_item_export_mismatch','shipment_price_allocation_missing'].includes(exportError)?shipmentMutationError(exportError):'발송 대기 상태와 취소 요청을 확인해주세요. 출고지시를 만들지 못했습니다.'};
 let data=result.data as ShipmentExportData;
 // 버전 1 할인 주문의 품목 금액은 거래확정 엑셀과 같은 공통 배분으로 채운다(10/14 회의 A5).
 if(layout==='smartstore'){try{data=await withSmartStoreLegacyAllocations(data,client);}catch{return {error:'주문 당시 금액 배분을 확인하지 못했습니다. 잠시 후 다시 내려받아 주세요.'};}}
 try{
  let file=await buildShipmentExport(data,format,layout);let sha256:string|undefined;
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
  // 기존 창고 양식이면 실제로 내보낸 배송 건으로 누른 시점에 다시 세어 상태 문구에 싣는다. 경고라 조회 실패는 생략한다.
  const missing=layout==='warehouse'?await barcodeGaps(client,keys):null;
  return {file:{base64:file.bytes.toString('base64'),mime:file.mime,name:file.name,...(sha256?{encryption:'ECMA-376-Agile' as const,sha256}:{})},
   message:`${`${keys.length}건의 출고지시를 내려받았습니다.${multipleOrigins?' 출고지별 파일을 ZIP으로 묶었습니다. 각 파일을 해당 창고에 전달해주세요.':''}${extra}${note}`.trim()}${missing?` ${shipmentBarcodeGapWarning(missing)}`:''}`};
 }catch(error){return {error:error instanceof Error?error.message:'출고지시 파일을 만들지 못했습니다.'};}
}
export async function exportShipmentsAction(ids:unknown,format:'xlsx'|'csv',layout:ShipmentExportLayout='smartstore',credentials?:ExportCredentials):Promise<ExportResult>{
 if(!await staff())return {error:'직원 권한이 필요합니다.'};const keys=selection(ids);
 if(!keys)return {error:'내보낼 배송 건을 1~1,000개 선택해주세요.'};
 const invalid=exportInputError(format,layout,credentials);if(invalid)return {error:invalid};
 return exportShipments(await createClient(),keys,format,layout,credentials);
}
/** The origin batch has the same selected layout and password contract as a selected-row export. */
export async function exportPendingOriginShipmentsAction(originId:unknown,format:'xlsx'|'csv',layout:ShipmentExportLayout='smartstore',credentials?:ExportCredentials):Promise<ExportResult>{
 if(!await staff())return {error:'직원 권한이 필요합니다.'};
 if(typeof originId!=='string'||!UUID.test(originId))return {error:'출고지를 선택해주세요.'};
 const invalid=exportInputError(format,layout,credentials);if(invalid)return {error:invalid};
 const client=await createClient();
 const pending=await client.rpc('admin_origin_pending_export_ids',{target_origin_id:originId.toLowerCase()});
 const value=pending.data as {ids?:unknown;total?:unknown}|null;
 if(pending.error||!value||!Array.isArray(value.ids)||!Number.isSafeInteger(value.total)||Number(value.total)<value.ids.length)return {error:'발송 대기 배송 건을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'};
 const keys=value.ids.length?selection(value.ids):[];
 if(!keys)return {error:'발송 대기 배송 건을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'};
 if(!keys.length)return {error:'이 출고지에 아직 전달하지 않은 발송 대기 배송 건이 없습니다. 발주확인과 예약 재고 할당·제작·취소 요청을 확인해주세요.'};
 const rest=Number(value.total)-keys.length;
 return exportShipments(client,keys,format,layout,credentials,rest>0?` 남은 ${rest.toLocaleString('ko-KR')}건은 다시 눌러 이어서 받아주세요.`:'');
}
/**
 * 내보내기 전 경고(10/27 회의 D10): 선택한 배송 건에서 출고 파일의 바코드 칸이 비는 옵션 수.
 * 경고는 출고를 막지 않으므로 권한·입력·조회 실패는 숫자 대신 null로 돌려 경고만 생략한다.
 */
export async function shipmentBarcodeGapsAction(ids:unknown):Promise<number|null>{
 if(!await staff())return null;const keys=selection(ids);if(!keys)return null;
 return barcodeGaps(await createClient(),keys);
}
/** 출고지 전체 내려받기 버튼이 다음에 받을 미전달 묶음(최대 1,000줄)과 같은 배송 건으로 센다. */
export async function originBarcodeGapsAction(originId:unknown):Promise<number|null>{
 if(!await staff()||typeof originId!=='string'||!UUID.test(originId))return null;
 const client=await createClient();
 const pending=await client.rpc('admin_origin_pending_export_ids',{target_origin_id:originId.toLowerCase()});
 const value=pending.data as {ids?:unknown}|null;
 if(pending.error||!value||!Array.isArray(value.ids))return null;
 if(!value.ids.length)return 0;
 const keys=selection(value.ids);
 return keys?barcodeGaps(client,keys):null;
}
async function barcodeGaps(client:Client,keys:string[]):Promise<number|null>{
 try{
  const result=await client.rpc('admin_shipment_barcode_gaps',{p_ids:keys});
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
 if(!UUID.test(id)||!parsed||!updatedAt)return {error:'모든 표준 컬럼의 헤더와 순서를 확인해주세요.'};
 const client=await createClient();const result=await client.rpc('admin_save_origin_export_columns',{target_id:id,target_columns:parsed,expected_updated_at:updatedAt});
 if(result.error)return {error:'다른 변경이 먼저 저장됐거나 양식이 올바르지 않습니다. 최신 출고지 설정을 확인해주세요.'};
 revalidatePath('/admin/settings/origins');return {message:'출고지시 양식을 저장했습니다.',updatedAt:result.data as string};
}
