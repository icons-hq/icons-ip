/** Optional first-party measurement. Raw URLs and referrer strings stay here. */
export const STORE_ANALYTICS_NOTICE_VERSION = 'analytics-v1';
export const STORE_ANALYTICS_API = '/api/store-analytics';
export const STORE_ANALYTICS_CHOICE_KEY = 'icons:analytics-choice:v1';
export const STORE_ANALYTICS_CHANNELS = ['direct','search','social','email','paid','referral','internal'] as const;
export const STORE_ANALYTICS_SOURCES = ['none','google','naver','bing','daum','instagram','facebook','youtube','kakao','x','threads','email','other','icons'] as const;
export const STORE_ANALYTICS_MEDIA = ['none','organic','social','email','cpc','paid_social','referral','internal'] as const;
export type AnalyticsChoice = 'unset' | 'accepted' | 'declined';
export type AnalyticsChannel = typeof STORE_ANALYTICS_CHANNELS[number];
export type AnalyticsSource = typeof STORE_ANALYTICS_SOURCES[number];
export type AnalyticsMedium = typeof STORE_ANALYTICS_MEDIA[number];
export interface AnalyticsAcquisition { channel: AnalyticsChannel; source: AnalyticsSource; medium: AnalyticsMedium }
export interface AnalyticsPage { kind: 'home'|'shop'|'good'|'stories'|'story'|'ip'|'events'|'event'; target: string; linkToken: string|null }
export interface AnalyticsEvent extends AnalyticsAcquisition { eventId: string; pageKind: AnalyticsPage['kind']; targetId: string; linkToken: string|null }
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SLUG=/^[a-z0-9][a-z0-9-]{0,199}$/;
const TOKEN=/^[0-9a-f]{32}$/;
export const CHANNEL_LABELS: Record<AnalyticsChannel,string> = {direct:'직접·출처 미확인',search:'검색',social:'소셜',email:'이메일',paid:'유료 캠페인 표기',referral:'기타 외부',internal:'스토어 내부'};
export const SOURCE_LABELS: Record<AnalyticsSource,string> = {none:'출처 없음',google:'Google',naver:'네이버',bing:'Bing',daum:'다음',instagram:'Instagram',facebook:'Facebook',youtube:'YouTube',kakao:'카카오',x:'X',threads:'Threads',email:'이메일',other:'기타',icons:'ICONS'};
export const PAGE_LABELS: Record<AnalyticsPage['kind'],string> = {home:'스토어 홈',shop:'상품 목록',good:'상품 상세',stories:'쇼핑스토리 목록',story:'쇼핑스토리',ip:'IP',events:'이벤트 목록',event:'이벤트 상세'};

export function analyticsCookieNames(secure: boolean) {
 return {choice:secure?'__Host-icons_analytics_choice':'icons_analytics_choice',session:secure?'__Host-icons_analytics_session':'icons_analytics_session'};
}
export function analyticsChoice(value: unknown): AnalyticsChoice {
 return value===`${STORE_ANALYTICS_NOTICE_VERSION}:yes`?'accepted':value===`${STORE_ANALYTICS_NOTICE_VERSION}:no`?'declined':'unset';
}
function single(search: URLSearchParams,key:string):string|null {const values=search.getAll(key);return values.length===1?values[0]:null;}
export function analyticsPage(pathname:string,search:URLSearchParams):AnalyticsPage|null {
 const rawLink=single(search,'icm');const linkToken=rawLink&&TOKEN.test(rawLink)?rawLink:null;
 if(pathname==='/')return {kind:'home',target:'home',linkToken};
 if(pathname==='/shop') {const category=single(search,'category');return {kind:'shop',target:category&&UUID.test(category)?category:'all',linkToken};}
 if(pathname==='/shop/new'||pathname==='/shop/best')return {kind:'shop',target:pathname.endsWith('/new')?'new':'best',linkToken};
 if(pathname==='/stories'||pathname==='/events')return {kind:pathname==='/stories'?'stories':'events',target:'all',linkToken};
 const match=pathname.match(/^\/(shop|stories|ip|events)\/([^/]+)$/);if(!match)return null;
 const kind=match[1]==='shop'?'good':match[1]==='stories'?'story':match[1]==='ip'?'ip':'event';
 if(kind==='story'?!UUID.test(match[2]):!SLUG.test(match[2]))return null;
 return {kind,target:match[2],linkToken};
}
const HOST_SOURCES: ReadonlyArray<[string,AnalyticsSource,AnalyticsChannel]> = [
 ['google.com','google','search'],['google.co.kr','google','search'],['naver.com','naver','search'],['bing.com','bing','search'],['daum.net','daum','search'],
 ['instagram.com','instagram','social'],['facebook.com','facebook','social'],['youtube.com','youtube','social'],['youtu.be','youtube','social'],
 ['kakao.com','kakao','social'],['kakao.co.kr','kakao','social'],['x.com','x','social'],['twitter.com','x','social'],['t.co','x','social'],['threads.net','threads','social'],['threads.com','threads','social'],
];
export function analyticsAcquisition(search:URLSearchParams,referrer:string,origin:string,internalNavigation=false):AnalyticsAcquisition {
 const source=single(search,'utm_source')?.toLowerCase();const medium=single(search,'utm_medium')?.toLowerCase();
 // Only finite known values cross the collection boundary. Campaign, content,
 // term and unknown values may contain personal data and are never transmitted.
 if(source&&STORE_ANALYTICS_SOURCES.includes(source as AnalyticsSource)&&!['none','other','icons'].includes(source)) {
  const normalizedSource=source as AnalyticsSource;
  if(medium==='cpc'||medium==='paid_social')return {channel:'paid',source:normalizedSource,medium};
  if(medium==='email'||source==='email')return {channel:'email',source:normalizedSource,medium:'email'};
  if(['google','naver','bing','daum'].includes(source))return {channel:'search',source:normalizedSource,medium:'organic'};
  return {channel:'social',source:normalizedSource,medium:'social'};
 }
 if(internalNavigation)return {channel:'internal',source:'icons',medium:'internal'};
 if(referrer)try {
  const parsed=new URL(referrer);
  if(parsed.protocol!=='http:'&&parsed.protocol!=='https:')return {channel:'direct',source:'none',medium:'none'};
  if(parsed.origin===origin)return {channel:'internal',source:'icons',medium:'internal'};
  const match=HOST_SOURCES.find(([host])=>parsed.hostname===host||parsed.hostname.endsWith(`.${host}`));
  if(match)return {channel:match[2],source:match[1],medium:match[2]==='search'?'organic':'social'};
  return {channel:'referral',source:'other',medium:'referral'};
 }catch{/* Malformed referrers reveal no collected string. */}
 return {channel:'direct',source:'none',medium:'none'};
}
export function parseAnalyticsEvent(input:unknown):AnalyticsEvent|null {
 if(!input||typeof input!=='object'||Array.isArray(input))return null;
 const row=input as Record<string,unknown>;const keys=['eventId','pageKind','targetId','linkToken','channel','source','medium'];
 if(Object.keys(row).length!==keys.length||Object.keys(row).some(key=>!keys.includes(key))||typeof row.eventId!=='string'||!UUID.test(row.eventId)
  ||typeof row.pageKind!=='string'||!Object.hasOwn(PAGE_LABELS,row.pageKind)||typeof row.targetId!=='string'||row.targetId.length>200
  ||(row.linkToken!==null&&(typeof row.linkToken!=='string'||!TOKEN.test(row.linkToken)))
  ||!STORE_ANALYTICS_CHANNELS.includes(row.channel as AnalyticsChannel)||!STORE_ANALYTICS_SOURCES.includes(row.source as AnalyticsSource)||!STORE_ANALYTICS_MEDIA.includes(row.medium as AnalyticsMedium))return null;
 if(row.pageKind==='home'?row.targetId!=='home':row.pageKind==='stories'||row.pageKind==='events'?row.targetId!=='all':row.pageKind==='story'?!UUID.test(row.targetId):row.pageKind==='shop'?!['all','new','best'].includes(row.targetId)&&!UUID.test(row.targetId):!SLUG.test(row.targetId))return null;
 return row as unknown as AnalyticsEvent;
}
