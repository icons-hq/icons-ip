import { isUuid } from '@/lib/uuid';

export const CS_REPLY_TEMPLATE_CATEGORIES = [
  {value:'product',label:'상품'}, {value:'shipping',label:'배송'}, {value:'return',label:'반품'},
  {value:'exchange',label:'교환'}, {value:'refund',label:'환불'}, {value:'other',label:'기타'},
] as const;
export type CsReplyTemplateCategory = typeof CS_REPLY_TEMPLATE_CATEGORIES[number]['value'];
export type CsReplySurface = 'product_question' | 'review';
export interface CsReplyTemplate {
  id:string; surface:CsReplySurface; category:CsReplyTemplateCategory; title:string; body:string;
  revision:number; archivedAt:string|null; updatedAt:string;
}
export interface CsReplyTemplateList { rows:CsReplyTemplate[]; total:number; page:number }
export interface ReviewBatchTarget { id:string; expectedReplyAt:string|null; expectedEditedAt:string|null; expectedStatus:'visible'|'hidden' }
export interface ReviewBatchRequest { requestId:string; items:ReviewBatchTarget[]; reply:string }
export interface ReviewBatchResult { requestId:string; items:{reviewId:string;status:'saved'|'unchanged'|'failed';code:string|null}[] }
export const REVIEW_BATCH_MAX = 50;
export const CS_REPLY_TEMPLATE_PAGE_SIZE = 20;
export const CS_REPLY_SURFACE_LABELS:Record<CsReplySurface,string> = {product_question:'상품 문의',review:'리뷰'};
export function isCsReplySurface(value:unknown):value is CsReplySurface { return value==='product_question'||value==='review'; }
export function csReplyBodyLimit(surface:CsReplySurface) { return surface==='review'?1000:2000; }
function record(value:unknown):value is Record<string,unknown> { return !!value&&typeof value==='object'&&!Array.isArray(value); }
function timestamp(value:unknown):value is string|null { return value===null||(typeof value==='string'&&value.length<=40&&!Number.isNaN(Date.parse(value))); }
export function parseCsReplyTemplate(value:unknown):CsReplyTemplate|null {
  if(!record(value)||typeof value.id!=='string'||!isUuid(value.id)||!isCsReplySurface(value.surface)
    ||!CS_REPLY_TEMPLATE_CATEGORIES.some(category=>category.value===value.category)||typeof value.title!=='string'||typeof value.body!=='string'
    ||!Number.isSafeInteger(value.revision)||Number(value.revision)<1||!timestamp(value.archived_at)||typeof value.updated_at!=='string') return null;
  return {id:value.id,surface:value.surface,category:value.category as CsReplyTemplateCategory,title:value.title,body:value.body,
    revision:Number(value.revision),archivedAt:value.archived_at,updatedAt:value.updated_at};
}
export function parseReviewBatchRequest(value:unknown):ReviewBatchRequest|null {
  if(!record(value)||typeof value.requestId!=='string'||!isUuid(value.requestId)||typeof value.reply!=='string'||!Array.isArray(value.items)
    ||value.items.length<1||value.items.length>REVIEW_BATCH_MAX) return null;
  const reply=value.reply.trim(); if([...reply].length<5||[...reply].length>1000) return null;
  const ids=new Set<string>(); const items:ReviewBatchTarget[]=[];
  for(const item of value.items) {
    if(!record(item)||typeof item.id!=='string'||!isUuid(item.id)||ids.has(item.id.toLowerCase())
      ||!timestamp(item.expectedReplyAt)||!timestamp(item.expectedEditedAt)||(item.expectedStatus!=='visible'&&item.expectedStatus!=='hidden')) return null;
    ids.add(item.id.toLowerCase()); items.push({id:item.id.toLowerCase(),expectedReplyAt:item.expectedReplyAt,expectedEditedAt:item.expectedEditedAt,expectedStatus:item.expectedStatus});
  }
  return {requestId:value.requestId.toLowerCase(),reply,items};
}
export function parseReviewBatchResult(value:unknown):ReviewBatchResult|null {
  if(!record(value)||typeof value.requestId!=='string'||!isUuid(value.requestId)||!Array.isArray(value.items)) return null;
  const items:ReviewBatchResult['items']=[];
  for(const item of value.items) {
    if(!record(item)||typeof item.reviewId!=='string'||!isUuid(item.reviewId)||!['saved','unchanged','failed'].includes(String(item.status))
      ||(item.code!==null&&typeof item.code!=='string')) return null;
    items.push({reviewId:item.reviewId,status:item.status as ReviewBatchResult['items'][number]['status'],code:item.code as string|null});
  }
  return {requestId:value.requestId,items};
}
export function reviewBatchFailureLabel(code:string|null) {
  if(code==='review_not_found') return '리뷰가 삭제되었거나 찾을 수 없습니다.';
  if(code==='review_changed') return '리뷰 또는 답글이 변경되었습니다. 최신 내용을 확인해주세요.';
  if(code==='staff_required') return '관리자 권한을 다시 확인해주세요.';
  if(code==='invalid_review_reply') return '답글 길이를 확인해주세요.';
  return '저장하지 못했습니다. 최신 상태를 확인해주세요.';
}
/** R3(MD-0011): 템플릿은 작성 중인 답글을 대체한다. 작성 중인 내용이 있으면(replaces) 화면이 확인을 거친 뒤에만 적용한다. */
export function applyCsReplyTemplate(current:string,template:string,limit:number):{ok:true;body:string;replaces:boolean}|{ok:false;error:string} {
  if([...template].length>limit) return {ok:false,error:`템플릿이 ${limit.toLocaleString('ko-KR')}자를 넘어 불러올 수 없습니다. 템플릿을 줄여주세요.`};
  return {ok:true,body:template,replaces:Boolean(current.trim())&&current!==template};
}
