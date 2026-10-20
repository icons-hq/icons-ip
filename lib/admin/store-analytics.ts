import { kstDay } from './kst';
import { CHANNEL_LABELS, SOURCE_LABELS, PAGE_LABELS, type AnalyticsChannel, type AnalyticsSource, type AnalyticsPage } from '@/lib/store-analytics';
export const TRAFFIC_DIMENSIONS = { channel: '유입 경로', page: '페이지 유형', good: '상품', ip: 'IP', category: '카테고리', link: '마케팅 링크' } as const;
export type TrafficDimension = keyof typeof TRAFFIC_DIMENSIONS;
export type TrafficMetric = 'pageViews'|'productViews'|'sessions'|'linkLandings'|'orders'|'convertedSessions'|'conversionRate'|'grossAmount'|'refundAmount'|'netAmount';
export type TrafficMetrics = Record<TrafficMetric, number | null>;
export type TrafficCoverage = { days: number; observed_days: number; partial_days: number; missing_days: number; archived_days: number; observed_minutes: number; expected_minutes: number; observed_until: string | null };
export interface TrafficTrend { date: string; metrics: TrafficMetrics; states: string[]; archived: boolean }
export interface TrafficRow { key: string; label: string; metrics: TrafficMetrics; comparison: TrafficMetrics | null; archived: boolean; observedUntil: string | null }
export interface TrafficReport {
 from: string; to: string; comparisonFrom: string | null; comparisonTo: string | null; dimension: TrafficDimension; selectedKey: string | null; selectedLabel: string | null;
 summary: TrafficMetrics; comparison: TrafficMetrics | null; coverage: TrafficCoverage; comparisonCoverage: TrafficCoverage | null;
 trend: TrafficTrend[]; comparisonTrend: TrafficTrend[]; rows: TrafficRow[]; total: number;
 collection: { enabled: boolean; startedAt: string | null; noticeVersion: string; lastHeartbeatAt: string | null; rawRetentionDays: number; aggregateRetentionMonths: number; retentionBacklog: number };
 observedAt: string; advertisingCost: null; roas: null;
}
export interface TrafficFilters { from: string; to: string; dimension: TrafficDimension; key: string; compare: 'previous'|'year'|'none'; grain: 'day'|'week'|'month'; query: string; page: number; error?: string }
const param = (query: Record<string,string|string[]|undefined>, key: string) => typeof query[key] === 'string' ? query[key] : '';
const day = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
export function trafficFilters(query: Record<string,string|string[]|undefined>, marketing = false, now = new Date()): TrafficFilters {
 const today = kstDay(now); const requestedDays = Number(param(query,'days')); const days = [1,7,30].includes(requestedDays) ? requestedDays : 7;
 const rawFrom = param(query,'from'), rawTo = param(query,'to'); const explicit = Boolean(rawFrom || rawTo);
 const from = explicit ? rawFrom : new Date(Date.parse(`${today}T00:00:00Z`) - (days-1)*86400000).toISOString().slice(0,10);
 const to = explicit ? rawTo : today; const dimension = param(query,'dimension'); const compare = param(query,'compare'); const grain = param(query,'grain');
 const page = Number(param(query,'page')); const key = param(query,'key'); const search = param(query,'q');
 const error = !day(from) || !day(to) || from > to || to > today || Date.parse(to)-Date.parse(from) >= 60*86400000 ? '한국 날짜 기준으로 오늘까지 최대 60일을 선택해주세요.'
  : key.length > 200 || /[\x00-\x1f\x7f]/.test(key) || search.length > 100 ? '검색 조건이 너무 길거나 올바르지 않습니다.' : undefined;
 return { from, to, dimension: marketing ? 'link' : Object.hasOwn(TRAFFIC_DIMENSIONS,dimension) ? dimension as TrafficDimension : 'channel',
  key, compare: compare === 'year' || compare === 'none' ? compare : 'previous', grain: grain === 'week' || grain === 'month' ? grain : 'day',
  query: search, page: Number.isSafeInteger(page) && page > 0 && page <= 100000 ? page : 1, ...(error ? { error } : {}) };
}
export function trafficHref(base: string, filters: TrafficFilters, patch: Partial<TrafficFilters> = {}) {
 const value = { ...filters, ...patch }; const params = new URLSearchParams({ from:value.from,to:value.to,dimension:value.dimension,compare:value.compare,grain:value.grain });
 if (value.key) params.set('key',value.key); if(value.query)params.set('q',value.query);if(value.page>1)params.set('page',String(value.page));return `${base}?${params}`;
}
export function trafficLabel(dimension: TrafficDimension, key: string, fallback: string) {
 if(dimension==='channel') { const [channel,source,medium]=key.split('/');return `${CHANNEL_LABELS[channel as AnalyticsChannel] || '기타'} · ${SOURCE_LABELS[source as AnalyticsSource] || '기타'}${medium==='cpc'?' / CPC':medium==='paid_social'?' / 유료 소셜':''}`; }
 if(dimension==='page')return PAGE_LABELS[key as AnalyticsPage['kind']] || fallback;
 return fallback;
}
export function trafficNumber(value: number | null | undefined, suffix = '') { return value == null ? '미측정' : `${value.toLocaleString('ko-KR')}${suffix}`; }
export function trafficDifference(current: number | null, previous: number | null, percent = false) {
 if(current==null||previous==null)return '비교 불가';const difference=Math.round((current-previous)*100)/100;
 return `${difference>0?'+':''}${difference.toLocaleString('ko-KR')}${percent?'%p':''}`;
}
export const TRAFFIC_STATE_LABELS: Record<string,string> = { observed:'정상 관측',collecting:'수집 중',partial:'일부 관측',unmeasured:'수집 전',paused:'수집 중단',expired:'보존 만료',future:'미래' };
