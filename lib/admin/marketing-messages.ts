import { isUuid } from '@/lib/uuid';
import { marketingCouponCode, parseMarketingCoupon, type MarketingCoupon } from './marketing-coupons';
import { isCount, isInstant, isRecord, normalizeSegmentRule, parseSegmentEstimate, parseSegmentOptions, type SegmentOption, type SegmentOptions, type SegmentEstimate, type SegmentRule } from './customer-segments';
export const MARKETING_MESSAGES_PATH = '/admin/marketing/messages';
export const MARKETING_TEMPLATES = ['text','image','product_list','product_cards'] as const;
export type MarketingTemplate = typeof MARKETING_TEMPLATES[number];
export const MARKETING_TEMPLATE_LABELS: Record<MarketingTemplate,string> = { text:'설명형',image:'이미지형',product_list:'상품 목록형',product_cards:'상품 카드형' };
export const MARKETING_RUN_STATES = ['queued','processing','completed','blocked','canceled','expired'] as const;
export type MarketingRunState = typeof MARKETING_RUN_STATES[number];
export const MARKETING_STATE_LABELS: Record<MarketingRunState|'draft',string> = { draft:'작성 중',queued:'예약 대기',processing:'등록 중',completed:'처리 완료',blocked:'확인 필요',canceled:'예약 취소',expired:'기한 지남' };
export const MARKETING_REASON_LABELS: Record<string,string> = { sender_permission:'발행자 권한 변경',segment_changed:'세그먼트 변경·삭제',product_unavailable:'상품 공개 상태 변경',start_deadline:'예약 시각부터 1시간 경과',delivery_window_ended:'알림 등록 가능 시간 종료' };
export interface MarketingContent { template:MarketingTemplate; title:string; body:string; imagePath:string|null; goodIds:string[]; buttons:{label:string;path:string}[]; couponCode?:string|null }
export type MarketingSchedule = {kind:'immediate'}|{kind:'once';at:string}|{kind:'weekly';startDate:string;endDate:string;weekday:number;time:string};
export type MarketingExclusion = 'none'|'received'|'read';
export interface MarketingRun { id:string;scheduledAt:string;state:MarketingRunState;reason:string|null;startedAt:string|null;completedAt:string|null;candidateCount:number;sentCount:number;excludedCount:number;readCount:number }
export interface MarketingCampaign { id:string;reference:number;name:string;revision:number;state:'draft'|'published';segmentId:string;segmentRevision:number;segmentName:string;rule:SegmentRule;ruleHash:string;content:MarketingContent;schedule:MarketingSchedule;exclusion:MarketingExclusion;createdAt:string;updatedAt:string;archived:boolean;estimate:SegmentEstimate|null;selectedProducts:SegmentOption[];runs:MarketingRun[];coupon?:MarketingCoupon|null }
export interface MarketingValues { name:string;segmentId:string;segmentRevision:number;content:MarketingContent;schedule:MarketingSchedule;exclusion:MarketingExclusion;copyFrom?:string }
export interface MarketingFilters {query:string;state:'all'|'draft'|MarketingRunState;page:number;start:string;end:string}
export interface MarketingList {rows:MarketingCampaign[];total:number;page:number;pageSize:20;filters:MarketingFilters}
export interface MarketingProduct {id:string;name:string;imageUrl:string|null;price:number;compareAtPrice?:number|null;priceMax?:number}
export interface MarketingProductOptions extends SegmentOptions {products:MarketingProduct[]}
export interface MyMarketingMessage {id:string;registeredAt:string;content:MarketingContent;goodIds:string[];goods:MarketingProduct[];coupon?:MarketingCoupon|null}
const chars=(value:string)=>[...value].length;
export function safeMarketingPath(value:unknown):value is string {return typeof value==='string' && chars(value)<=500 && /^\/([^/].*)?$/.test(value) && !/[\u0000-\u001f\u007f\\%]/.test(value) && !/^\/(admin|api|auth|login|logout)(\/|[?#]|$)/i.test(value);}
export function parseMarketingContent(value:unknown):MarketingContent|null {
 if(!isRecord(value)||!MARKETING_TEMPLATES.includes(value.template as MarketingTemplate)||typeof value.title!=='string'||typeof value.body!=='string'||!Array.isArray(value.goodIds)||!Array.isArray(value.buttons))return null;
 const template=value.template as MarketingTemplate,title=value.title.trim(),body=value.body.replace(/\r\n/g,'\n').trim(),maxLines=template==='text'?16:template==='image'?8:2;
 if(!title||chars(title)>120||/[\u0000-\u001f\u007f]/.test(title)||!body||chars(body)>500||/[\u0000-\u0008\u000b-\u001f\u007f]/.test(body)||body.split('\n').length>maxLines
  ||value.imagePath!==null&&(typeof value.imagePath!=='string'||!/^public-media\/catalog\/curation\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/.test(value.imagePath))
  ||template==='image'&&!value.imagePath||['text','product_cards'].includes(template)&&value.imagePath!==null||value.goodIds.some(id=>typeof id!=='string'||!/^[a-z0-9][a-z0-9-]{0,119}$/.test(id))||new Set(value.goodIds).size!==value.goodIds.length
  ||(['text','image'].includes(template)?value.goodIds.length!==0:!value.goodIds.length||value.goodIds.length>(template==='product_list'?3:6))||value.buttons.length>2)return null;
 if(value.buttons.some(button=>!isRecord(button)||typeof button.label!=='string'||!button.label.trim()||chars(button.label.trim())>20||/[\u0000-\u001f\u007f]/.test(button.label)||!safeMarketingPath(button.path)))return null;
 if(value.couponCode!==undefined&&value.couponCode!==null&&!marketingCouponCode(value.couponCode))return null;
 return {template,title,body,imagePath:value.imagePath as string|null,goodIds:value.goodIds as string[],buttons:value.buttons.map(button=>({label:String(button.label).trim(),path:String(button.path)})),...(value.couponCode!==undefined?{couponCode:value.couponCode as string|null}:{})};
}
export function parseMarketingSchedule(value:unknown):MarketingSchedule|null {
 if(!isRecord(value))return null;
 if(value.kind==='immediate')return {kind:'immediate'};
 if(value.kind==='once'&&isInstant(value.at))return {kind:'once',at:value.at};
 if(value.kind==='weekly'&&typeof value.startDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value.startDate)&&typeof value.endDate==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value.endDate)&&isCount(value.weekday)&&value.weekday<=6&&typeof value.time==='string'&&/^(0[89]|1[0-9]):[0-5][0-9]$/.test(value.time))return {kind:'weekly',startDate:value.startDate,endDate:value.endDate,weekday:value.weekday,time:value.time};
 return null;
}
export function marketingScheduleError(schedule:MarketingSchedule,at=new Date()):string|null {
 if(schedule.kind==='immediate'){const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',hour:'2-digit',hourCycle:'h23'}).format(at));return hour<8||hour>=20?'즉시 등록은 한국 시각 08:00–20:00에 가능합니다.':null;}
 if(schedule.kind==='once'){const date=new Date(schedule.at),hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',hour:'2-digit',hourCycle:'h23'}).format(date));if(date<=at||date.getTime()>at.getTime()+366*86400000||hour<8||hour>=20)return '예약은 1년 이내의 미래 시각, 한국 시각 08:00–20:00로 설정해주세요.';return null;}
 const start=new Date(`${schedule.startDate}T${schedule.time}:00+09:00`),end=new Date(`${schedule.endDate}T${schedule.time}:00+09:00`),days=(end.getTime()-start.getTime())/86400000;
 if(!Number.isFinite(days)||days<0||days>365)return '반복 기간은 시작일부터 최대 1년으로 설정해주세요.';
 const first=new Date(start);first.setUTCDate(first.getUTCDate()+((schedule.weekday-new Date(`${schedule.startDate}T00:00:00Z`).getUTCDay()+7)%7));
 if(first>end||first<=at||end.getTime()>at.getTime()+366*86400000)return '선택한 요일의 첫 회차가 미래 시각에 있도록 기간을 확인해주세요.';return null;
}
export function parseMarketingCampaign(value:unknown):MarketingCampaign|null {
 if(!isRecord(value)||!isUuid(value.id)||!isCount(value.reference)||value.reference<1||typeof value.name!=='string'||!isCount(value.revision)||value.revision<1||!['draft','published'].includes(String(value.state))||!isUuid(value.segmentId)||!isCount(value.segmentRevision)||value.segmentRevision<1||typeof value.segmentName!=='string'||typeof value.ruleHash!=='string'||!/^[0-9a-f]{64}$/.test(value.ruleHash)||!['none','received','read'].includes(String(value.exclusion))||!isInstant(value.createdAt)||!isInstant(value.updatedAt)||typeof value.archived!=='boolean'||!Array.isArray(value.runs))return null;
 const rule=normalizeSegmentRule(value.rule),content=parseMarketingContent(value.content),schedule=parseMarketingSchedule(value.schedule),estimate=value.estimate===null?null:parseSegmentEstimate(value.estimate);
 const coupon=value.coupon==null?null:parseMarketingCoupon(value.coupon);if(value.coupon!=null&&(!coupon||coupon.code!==content?.couponCode))return null;
 if(!rule||!content||!schedule||!parseSegmentOptions(value.selectedProducts)||value.estimate!==null&&!estimate||value.runs.some(run=>!isRecord(run)||!isUuid(run.id)||!isInstant(run.scheduledAt)||!MARKETING_RUN_STATES.includes(run.state as MarketingRunState)||run.reason!==null&&typeof run.reason!=='string'||run.startedAt!==null&&!isInstant(run.startedAt)||run.completedAt!==null&&!isInstant(run.completedAt)||!isCount(run.candidateCount)||!isCount(run.sentCount)||!isCount(run.excludedCount)||!isCount(run.readCount)||run.sentCount+run.excludedCount>run.candidateCount||run.readCount>run.sentCount))return null;
 return {...value,rule,content,schedule,estimate} as unknown as MarketingCampaign;
}
export function parseMyMarketingMessage(value:unknown):Omit<MyMarketingMessage,'goods'>|null {if(!isRecord(value)||!isUuid(value.id)||!isInstant(value.registeredAt)||!Array.isArray(value.goodIds))return null;const content=parseMarketingContent(value.content),coupon=value.coupon===undefined||value.coupon===null?null:parseMarketingCoupon(value.coupon);if(!content||value.goodIds.some(id=>typeof id!=='string'||!content.goodIds.includes(id))||value.coupon!=null&&(!coupon||coupon.code!==content.couponCode))return null;return {id:value.id,registeredAt:value.registeredAt,content,goodIds:value.goodIds as string[],...(value.coupon!==undefined?{coupon}:{})};}
export function marketingCounts(campaign:MarketingCampaign){return campaign.runs.reduce((sum,run)=>({sent:sum.sent+run.sentCount,read:sum.read+run.readCount,excluded:sum.excluded+run.excludedCount}),{sent:0,read:0,excluded:0});}
export function marketingState(campaign:MarketingCampaign):'draft'|MarketingRunState {if(campaign.state==='draft')return 'draft';return (['processing','queued','blocked','completed','expired','canceled'] as const).find(state=>campaign.runs.some(run=>run.state===state))??'completed';}
export function normalizeMarketingFilters(params:Record<string,string|string[]|undefined>):MarketingFilters {const first=(v:string|string[]|undefined)=>Array.isArray(v)?v[0]:v,raw=first(params.state),page=Number(first(params.page));return {query:(first(params.q)??'').trim().slice(0,100),state:raw==='draft'||MARKETING_RUN_STATES.includes(raw as MarketingRunState)?raw as MarketingFilters['state']:'all',page:Number.isSafeInteger(page)&&page>0&&page<=100000?page:1,start:/^\d{4}-\d{2}-\d{2}$/.test(first(params.start)??'')?first(params.start)!:'',end:/^\d{4}-\d{2}-\d{2}$/.test(first(params.end)??'')?first(params.end)!:''};}
export function marketingMessagesHref(filters:MarketingFilters,page=filters.page){const params=new URLSearchParams({q:filters.query,state:filters.state,page:String(page),start:filters.start,end:filters.end});return `${MARKETING_MESSAGES_PATH}?${params}`;}
