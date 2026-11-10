'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { isCount, isRecord, normalizeSegmentFilters, parseSegmentOptions, type SegmentActionResult, type SegmentList } from '@/lib/admin/customer-segments';
import { loadCustomerSegments } from '@/lib/admin/customer-segments.server';
import { MARKETING_MESSAGES_PATH, MARKETING_STATE_LABELS, marketingState, parseMarketingContent, parseMarketingSchedule, type MarketingFilters, type MarketingValues, type MarketingProductOptions } from '@/lib/admin/marketing-messages';
import { loadMarketingMessages, loadMarketingProducts } from '@/lib/admin/marketing-messages.server';
import { createClient } from '@/lib/supabase/server';
import { processMarketingMessages } from '@/lib/marketing-messages-jobs.server';
import { isUuid } from '@/lib/uuid';
type Saved={id:string;revision:number;state:'draft'|'published';processingPending?:boolean};
function uncertain<T>():SegmentActionResult<T>{return {error:'처리 결과를 확인하지 못했습니다. 같은 요청으로 결과를 다시 확인해주세요.',uncertain:true};}
function failure<T>(error:{message?:string;code?:string}):SegmentActionResult<T>{const messages:Record<string,string>={marketing_campaign_changed:'다른 저장 결과가 있거나 이미 발행된 메시지입니다. 상세를 다시 불러와주세요.',customer_segment_changed:'세그먼트가 변경되거나 삭제되었습니다. 다시 선택해주세요.',customer_segment_estimate_required:'같은 세그먼트의 예상 고객수를 다시 확인해주세요. 결과는 15분 동안 사용할 수 있습니다.',marketing_product_unavailable:'상품의 공개 상태가 변경되었습니다. 상품을 다시 선택해주세요.',marketing_outside_window:'즉시 등록은 한국 시각 08:00–20:00에 가능합니다.',invalid_marketing_schedule:'예약·반복 일정을 확인해주세요. 미래 시각, 1년 이내, 한국 시각 08:00–20:00에 설정할 수 있습니다.',marketing_nothing_to_cancel:'취소할 대기 회차가 없습니다. 현재 처리 중인 회차는 취소할 수 없습니다.',marketing_campaign_active:'남은 예약을 먼저 취소해주세요. 처리 중인 회차는 완료 후 보관할 수 있습니다.',unverified_artwork:'이미지 검증 결과를 확인할 수 없습니다. 이미지를 다시 업로드해주세요.',operator_capability_required:'마케팅 관리 권한이 없습니다.'};
 if(error.message&&messages[error.message])return {error:messages[error.message]};return ['22023','23514','23505','42501','PT409','P0002'].includes(error.code??'')?{error:'입력과 현재 권한을 확인해주세요.'}:uncertain<T>();}
async function access(){return requireAdminActionAccess(MARKETING_MESSAGES_PATH,{capability:'marketing.manage'});}
export async function searchMarketingSegmentsAction(query:string,page:number):Promise<SegmentActionResult<SegmentList>>{try{if(!await access())return {error:'마케팅 관리 권한이 없습니다.'};if(typeof query!=='string'||query.length>100||!isCount(page)||page<1)return {error:'조회 조건을 확인해주세요.'};return {data:await loadCustomerSegments(normalizeSegmentFilters({q:query,page:String(page)}))};}catch(error){unstable_rethrow(error);return {error:'세그먼트를 조회하지 못했습니다.'};}}
export async function searchMarketingProductsAction(query:string,page:number):Promise<SegmentActionResult<MarketingProductOptions>>{try{if(!await access())return {error:'마케팅 관리 권한이 없습니다.'};if(typeof query!=='string'||query.length>100||!isCount(page)||page<1)return {error:'조회 조건을 확인해주세요.'};const client=await createClient(),{data,error}=await client.rpc('admin_marketing_product_options',{p_query:query,p_page:page}),rows=isRecord(data)?parseSegmentOptions(data.rows):null;if(error||!isRecord(data)||!rows||!isCount(data.total)||data.page!==page||data.pageSize!==20)throw new Error('invalid product options');return {data:{rows,total:data.total,page,pageSize:20,products:await loadMarketingProducts(rows.map(row=>row.id))}};}catch(error){unstable_rethrow(error);return {error:'공개 상품을 조회하지 못했습니다.'};}}
export async function saveMarketingMessageAction(input:{id:string;revision:number;operationId:string;values:MarketingValues;publish:boolean;estimateId:string|null}):Promise<SegmentActionResult<Saved>>{
 try{if(!await access())return {error:'마케팅 관리 권한이 없습니다.'};const value=input?.values,content=parseMarketingContent(value?.content),schedule=parseMarketingSchedule(value?.schedule);
  if(!isUuid(input?.id)||!isUuid(input.operationId)||!isCount(input.revision)||input.revision>1_000_000_000||typeof input.publish!=='boolean'||!value||typeof value.name!=='string'||!value.name.trim()||[...value.name.trim()].length>50||/[\u0000-\u001f\u007f]/.test(value.name)||!isUuid(value.segmentId)||!isCount(value.segmentRevision)||value.segmentRevision<1||!content||!schedule||!['none','received','read'].includes(value.exclusion)||value.copyFrom!==undefined&&!isUuid(value.copyFrom)||input.publish&&!isUuid(input.estimateId))return {error:'대상·내용·일정의 입력을 확인해주세요.'};
  const client=await createClient(),{data,error}=await client.rpc('admin_save_marketing_campaign',{p_id:input.id,p_expected_revision:input.revision,p_operation_id:input.operationId,p_values:{...value,name:value.name.trim(),content,schedule},p_publish:input.publish,p_estimate_id:input.estimateId});
  if(error)return failure(error);if(!isRecord(data)||data.id!==input.id||data.revision!==input.revision+1||data.state!==(input.publish?'published':'draft'))return uncertain();
  let processingPending=false;if(input.publish&&schedule.kind==='immediate'){try{await processMarketingMessages(input.id);}catch{processingPending=true;}}
  revalidatePath(MARKETING_MESSAGES_PATH);revalidatePath(`${MARKETING_MESSAGES_PATH}/${input.id}`);return {data:{id:input.id,revision:data.revision as number,state:data.state as Saved['state'],processingPending}};
 }catch(error){unstable_rethrow(error);return uncertain();}
}
export async function changeMarketingMessageAction(input:{id:string;revision:number;operationId:string;action:'cancel'|'archive'}):Promise<SegmentActionResult<{id:string;revision:number;affectedCount:number}>>{
 try{if(!await access())return {error:'마케팅 관리 권한이 없습니다.'};if(!isUuid(input?.id)||!isUuid(input.operationId)||!isCount(input.revision)||input.revision<1||!['cancel','archive'].includes(input.action))return {error:'메시지와 작업을 확인해주세요.'};
  const client=await createClient(),{data,error}=await client.rpc('admin_change_marketing_campaign',{p_id:input.id,p_expected_revision:input.revision,p_operation_id:input.operationId,p_action:input.action});if(error)return failure(error);if(!isRecord(data)||data.id!==input.id||data.revision!==input.revision+1||!isCount(data.affectedCount)||data.affectedCount<1)return uncertain();
  revalidatePath(MARKETING_MESSAGES_PATH);revalidatePath(`${MARKETING_MESSAGES_PATH}/${input.id}`);return {data:{id:input.id,revision:data.revision as number,affectedCount:data.affectedCount}};
 }catch(error){unstable_rethrow(error);return uncertain();}
}
export async function exportMarketingMessagesAction(filters:MarketingFilters):Promise<SegmentActionResult<{base64:string;filename:string}>>{
 try{if(!await access())return {error:'마케팅 관리 권한이 없습니다.'};const first=await loadMarketingMessages({...filters,page:1});if(first.total>1000)return {error:'다운로드는 최대 1,000개 메시지입니다. 기간이나 상태로 조회 범위를 좁혀주세요.'};
  const rows=[...first.rows];for(let page=2;page<=Math.ceil(first.total/20);page++)rows.push(...(await loadMarketingMessages({...filters,page})).rows);
  const ExcelJS=(await import('exceljs')).default,book=new ExcelJS.Workbook(),sheet=book.addWorksheet('마케팅 메시지');
  sheet.addRow(['메시지 ID','메시지명','세그먼트','현재 상태','생성 시각','회차 예약 시각','회차 상태','실제 인앱 등록','읽음 처리','제외','상태 사유']);
  for(const row of rows){const common=[`MSG-${row.reference}`,row.name,row.segmentName,MARKETING_STATE_LABELS[marketingState(row)],row.createdAt];if(!row.runs.length)sheet.addRow([...common,'','작성 중',0,0,0,'']);for(const run of row.runs)sheet.addRow([...common,run.scheduledAt,MARKETING_STATE_LABELS[run.state],run.sentCount,run.readCount,run.excludedCount,run.reason??'']);}
  sheet.views=[{state:'frozen',ySplit:1}];sheet.getRow(1).font={bold:true};sheet.columns.forEach(column=>{column.width=24;});const bytes=await book.xlsx.writeBuffer();return {data:{base64:Buffer.from(bytes).toString('base64'),filename:`marketing-messages-${new Date().toISOString().slice(0,10)}.xlsx`}};
 }catch(error){unstable_rethrow(error);return {error:'이력을 다운로드하지 못했습니다. 조회 조건을 확인해주세요.'};}
}
