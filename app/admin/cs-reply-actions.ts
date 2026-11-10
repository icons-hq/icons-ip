'use server';

import { revalidatePath } from 'next/cache';
import { hasAdminCapability } from '@/lib/admin/access';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';
import { CS_REPLY_TEMPLATE_CATEGORIES, CS_REPLY_TEMPLATE_PAGE_SIZE, csReplyBodyLimit, isCsReplySurface, parseCsReplyTemplate, parseReviewBatchRequest, parseReviewBatchResult,
  type CsReplyTemplate, type CsReplyTemplateList, type ReviewBatchResult } from '@/lib/admin/cs-reply-tools';

async function staff() { const auth=await getCurrentAdminAuthState(); return auth.isConfigured&&auth.user&&auth.isStaff&&hasAdminCapability(auth, 'cs.manage'); }
function templateError(error:string) {
  if(error.includes('cs_reply_template_changed')) return '다른 작업에서 템플릿을 변경했습니다. 목록을 새로 조회해주세요.';
  if(error.includes('cs_reply_template_archived')) return '삭제된 템플릿입니다. 복구한 뒤 수정해주세요.';
  if(error.includes('cs_reply_template_not_found')) return '템플릿을 찾을 수 없습니다.';
  return '템플릿을 저장하지 못했습니다. 입력과 최신 상태를 확인해주세요.';
}

export async function listCsReplyTemplatesAction(input:unknown):Promise<{ok:true;data:CsReplyTemplateList}|{ok:false;error:string}> {
  if(!await staff()) return {ok:false,error:'관리자 권한이 필요합니다.'};
  const value=input as Record<string,unknown>|null;
  if(!value||!isCsReplySurface(value.surface)) return {ok:false,error:'답변 유형을 확인해주세요.'};
  const page=Number.isSafeInteger(value.page)&&Number(value.page)>0?Number(value.page):1;
  const query=typeof value.query==='string'?value.query.trim().slice(0,100):'';
  const supabase=await createClient();
  let request=supabase.from('cs_reply_templates').select('id,surface,category,title,body,revision,archived_at,updated_at',{count:'exact'}).eq('surface',value.surface);
  request=value.archived===true?request.not('archived_at','is',null):request.is('archived_at',null);
  if(typeof value.category==='string'&&CS_REPLY_TEMPLATE_CATEGORIES.some(category=>category.value===value.category)) request=request.eq('category',value.category);
  if(query) request=request.ilike('title',`%${query.replace(/[\\%_*]/g,character=>`\\${character}`)}%`);
  const {data,error,count}=await request.order('title').order('id').range((page-1)*CS_REPLY_TEMPLATE_PAGE_SIZE,page*CS_REPLY_TEMPLATE_PAGE_SIZE-1);
  if(error) return {ok:false,error:'답변 템플릿을 조회하지 못했습니다. 다시 시도해주세요.'};
  const rows=(data??[]).map(parseCsReplyTemplate);
  if(rows.some(row=>row===null)) return {ok:false,error:'답변 템플릿 정보를 확인하지 못했습니다.'};
  return {ok:true,data:{rows:rows as CsReplyTemplate[],total:count??0,page}};
}

export async function readCsReplyTemplateAction(input:unknown):Promise<{ok:true;template:CsReplyTemplate|null}|{ok:false;error:string}> {
  if(!await staff()) return {ok:false,error:'관리자 권한이 필요합니다.'};
  const value=input as Record<string,unknown>|null;
  if(!value||!isUuid(value.id)||!isCsReplySurface(value.surface)) return {ok:false,error:'답변 템플릿을 확인해주세요.'};
  const id=value.id.toLowerCase();
  const supabase=await createClient();
  const {data,error}=await supabase.from('cs_reply_templates').select('id,surface,category,title,body,revision,archived_at,updated_at').eq('id',id).eq('surface',value.surface).maybeSingle();
  if(error) return {ok:false,error:'최신 저장본을 확인하지 못했습니다. 작성 중인 문구는 유지됩니다.'};
  const template=data===null?null:parseCsReplyTemplate(data);
  if(data!==null&&(!template||template.id!==id||template.surface!==value.surface)) return {ok:false,error:'최신 저장본의 대상 정보를 확인하지 못했습니다.'};
  return {ok:true,template};
}

export async function saveCsReplyTemplateAction(input:unknown):Promise<{ok:true;template:CsReplyTemplate}|{ok:false;error:string;uncertain?:boolean}> {
  if(!await staff()) return {ok:false,error:'관리자 권한이 필요합니다.'};
  const value=input as Record<string,unknown>|null;
  if(!value||typeof value.id!=='string'||!isUuid(value.id)||!isCsReplySurface(value.surface)||typeof value.title!=='string'||typeof value.body!=='string'
    ||!CS_REPLY_TEMPLATE_CATEGORIES.some(category=>category.value===value.category)||!Number.isSafeInteger(value.revision)||Number(value.revision)<0) return {ok:false,error:'템플릿 입력을 확인해주세요.'};
  const id=value.id.toLowerCase(),title=value.title.trim(),body=value.body.trim();
  if([...title].length<1||[...title].length>35||[...body].length<(value.surface==='review'?2:1)||[...body].length>csReplyBodyLimit(value.surface)) return {ok:false,error:`제목은 35자, 내용은 ${csReplyBodyLimit(value.surface)}자 이내로 입력해주세요.`};
  const supabase=await createClient(); const {data,error}=await supabase.rpc('admin_save_cs_reply_template',{p_id:id,p_surface:value.surface,p_category:value.category,p_title:title,p_body:body,p_expected_revision:value.revision});
  if(error) return {ok:false,error:templateError(error.message),uncertain:!error.code||!['22023','23514','PT409','42501','P0002'].includes(error.code)};
  const template=parseCsReplyTemplate(data);
  return template&&template.id===id&&template.surface===value.surface&&template.category===value.category
    &&template.title===title&&template.body===body&&[Number(value.revision),Number(value.revision)+1].includes(template.revision)&&!template.archivedAt
    ?{ok:true,template}:{ok:false,error:'저장 결과를 확인하지 못했습니다. 최신 저장본을 확인해주세요.',uncertain:true};
}

export async function archiveCsReplyTemplateAction(input:unknown):Promise<{ok:true;template:CsReplyTemplate}|{ok:false;error:string}> {
  if(!await staff()) return {ok:false,error:'관리자 권한이 필요합니다.'};
  const value=input as Record<string,unknown>|null;
  if(!value||typeof value.id!=='string'||!isUuid(value.id)||typeof value.archived!=='boolean'||!Number.isSafeInteger(value.revision)) return {ok:false,error:'템플릿을 확인해주세요.'};
  const supabase=await createClient();const {data,error}=await supabase.rpc('admin_archive_cs_reply_template',{p_id:value.id,p_archived:value.archived,p_expected_revision:value.revision});
  if(error) return {ok:false,error:templateError(error.message)};
  const template=parseCsReplyTemplate(data);return template?{ok:true,template}:{ok:false,error:'변경 결과를 확인하지 못했습니다. 목록을 새로 조회해주세요.'};
}

export async function replyReviewsBatchAction(input:unknown):Promise<{ok:true;result:ReviewBatchResult}|{ok:false;error:string}> {
  if(!await staff()) return {ok:false,error:'관리자 권한이 필요합니다.'};
  const value=parseReviewBatchRequest(input);if(!value) return {ok:false,error:'리뷰는 1~50건, 답글은 5~1000자로 입력해주세요.'};
  const supabase=await createClient();const {data,error}=await supabase.rpc('admin_reply_reviews_batch',{p_request_id:value.requestId,p_items:value.items,p_reply:value.reply});
  if(error) return {ok:false,error:error.message.includes('review_batch_request_changed')?'이미 사용한 요청과 내용이 다릅니다. 처리 결과를 확인해주세요.':'일괄답글 결과를 확인하지 못했습니다. 처리 결과를 다시 확인해주세요.'};
  const result=parseReviewBatchResult(data);if(!result) return {ok:false,error:'일괄답글 결과를 확인하지 못했습니다. 처리 결과를 다시 확인해주세요.'};
  revalidatePath('/admin/cs/reviews');return {ok:true,result};
}

export async function readReviewReplyBatchAction(requestId:unknown):Promise<{ok:true;result:ReviewBatchResult|null}|{ok:false;error:string}> {
  if(!await staff()) return {ok:false,error:'관리자 권한이 필요합니다.'};
  if(typeof requestId!=='string'||!isUuid(requestId)) return {ok:false,error:'처리 요청을 확인해주세요.'};
  const supabase=await createClient();const {data,error}=await supabase.rpc('admin_review_reply_batch_result',{p_request_id:requestId});
  if(error) return {ok:false,error:'처리 결과를 조회하지 못했습니다. 다시 확인해주세요.'};
  const result=data===null?null:parseReviewBatchResult(data);
  if(data!==null&&!result) return {ok:false,error:'처리 결과를 확인하지 못했습니다.'};
  if(result) revalidatePath('/admin/cs/reviews');return {ok:true,result};
}
