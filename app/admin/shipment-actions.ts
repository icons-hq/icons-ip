'use server';
import {revalidatePath} from 'next/cache';
import {getCurrentAdminAuthState} from '@/lib/auth/admin';
import {createClient} from '@/lib/supabase/server';
import {buildShipmentExport} from '@/lib/admin/shipment-workbook.server';
import {shipmentMutationError,type ShipmentExportData} from '@/lib/admin/shipment-dispatch';
import {parseShipmentExportColumns} from '@/lib/admin/shipment-workbook';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function selection(value:unknown):string[]|null {if(!Array.isArray(value)||!value.length||value.length>1000||!value.every(id=>typeof id==='string'&&UUID.test(id)))return null;return [...new Set((value as string[]).map(id=>id.toLowerCase()))];}
async function staff(){const auth=await getCurrentAdminAuthState();return auth.isConfigured&&auth.user&&auth.isStaff?auth:null;}
function refresh(){revalidatePath('/admin/sales/dispatch');revalidatePath('/admin/sales/shipping');revalidatePath('/admin/sales/orders');revalidatePath('/orders');}
type Client=Awaited<ReturnType<typeof createClient>>;
type ExportResult={error:string;file?:undefined;message?:undefined}|{file:{base64:string;mime:string;name:string};message:string;error?:undefined};
/** Build the warehouse files first; only a successfully built batch is recorded as handed over. */
async function exportShipments(client:Client,keys:string[],format:'xlsx'|'csv',note=''):Promise<ExportResult>{
 const result=await client.rpc('admin_shipment_export',{target_ids:keys});
 if(result.error||!result.data)return {error:'발송 대기 상태와 취소 요청을 확인해주세요. 출고지시를 만들지 못했습니다.'};
 const data=result.data as ShipmentExportData;
 try{
  const file=await buildShipmentExport(data,format);
  const mark=await client.rpc('admin_mark_shipments_exported',{target_versions:data.shipments.map(shipment=>({id:shipment.id,updatedAt:shipment.updatedAt}))});
  if(mark.error||mark.data!==keys.length)return {error:'배송 상태가 변경되었습니다. 목록을 새로고침한 뒤 다시 내보내주세요.'};
  refresh();
  return {file:{base64:file.bytes.toString('base64'),mime:file.mime,name:file.name},
   message:`${keys.length}건의 출고지시를 내려받았습니다.${file.extension==='zip'?' 출고지별 파일을 ZIP으로 묶었습니다. 각 파일을 해당 창고에 그대로 전달해주세요.':''}${note}`};
 }catch(error){return {error:error instanceof Error?error.message:'출고지시 파일을 만들지 못했습니다.'};}
}
export async function exportShipmentsAction(ids:unknown,format:'xlsx'|'csv'):Promise<ExportResult>{
 if(!await staff())return {error:'직원 권한이 필요합니다.'};const keys=selection(ids);
 if(!keys||!['xlsx','csv'].includes(format))return {error:'내보낼 배송 건을 1~1,000개 선택해주세요.'};
 return exportShipments(await createClient(),keys,format);
}
/** 한 출고지의 아직 전달하지 않은 발송 대기 건을 품목 1,000줄(회신 한도)까지 그 창고 양식 파일 하나로 받는다. */
export async function exportPendingOriginShipmentsAction(originId:unknown,format:'xlsx'|'csv'):Promise<ExportResult>{
 if(!await staff())return {error:'직원 권한이 필요합니다.'};
 if(typeof originId!=='string'||!UUID.test(originId)||!['xlsx','csv'].includes(format))return {error:'출고지를 선택해주세요.'};
 const client=await createClient();
 const pending=await client.rpc('admin_origin_pending_export_ids',{target_origin_id:originId.toLowerCase()});
 const value=pending.data as {ids?:unknown;total?:unknown}|null;
 if(pending.error||!value||!Array.isArray(value.ids)||typeof value.total!=='number')return {error:'발송 대기 배송 건을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'};
 const keys=value.ids.length?selection(value.ids):[];
 if(!keys)return {error:'발송 대기 배송 건을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.'};
 if(!keys.length)return {error:'이 출고지에 아직 전달하지 않은 발송 대기 배송 건이 없습니다. 발주확인과 예약 재고 할당·취소 요청을 확인해주세요.'};
 const rest=value.total-keys.length;
 return exportShipments(client,keys,format,rest>0?` 남은 ${rest.toLocaleString('ko-KR')}건은 다시 눌러 이어서 받아주세요.`:'');
}
export async function completeShipmentsAction(ids:unknown){
 if(!await staff())return {error:'직원 권한이 필요합니다.'};const keys=selection(ids);
 if(!keys)return {error:'배송완료 처리할 배송 건을 1~1,000개 선택해주세요.'};
 const client=await createClient();const result=await client.rpc('admin_complete_shipments',{target_ids:keys});
 if(result.error||!Array.isArray(result.data))return {error:'배송완료를 처리하지 못했습니다. 최신 상태를 확인해주세요.'};
 const rows=result.data as {id:string;ok:boolean;error?:string}[];refresh();
 return {message:`${rows.filter(row=>row.ok).length}건을 배송완료로 변경했습니다.`,failed:rows.filter(row=>!row.ok).map(row=>({id:row.id,reason:shipmentMutationError(row.error??'')}))};
}
export async function saveShipmentExportColumnsAction(id:string,columns:unknown,updatedAt:string){
 const auth=await staff();if(auth?.role!=='admin')return {error:'관리자 권한이 필요합니다.'};
 const parsed=parseShipmentExportColumns(columns);
 if(!UUID.test(id)||!parsed||!updatedAt)return {error:'모든 표준 컬럼의 헤더와 순서를 확인해주세요.'};
 const client=await createClient();const result=await client.rpc('admin_save_origin_export_columns',{target_id:id,target_columns:parsed,expected_updated_at:updatedAt});
 if(result.error)return {error:'다른 변경이 먼저 저장됐거나 양식이 올바르지 않습니다. 최신 출고지 설정을 확인해주세요.'};
 revalidatePath('/admin/settings/origins');return {message:'출고지시 양식을 저장했습니다.',updatedAt:result.data as string};
}
