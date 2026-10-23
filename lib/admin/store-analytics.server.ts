import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { NoticeTrafficReport, TrafficFilters, TrafficReport } from './store-analytics';
export async function getTrafficReport(filters: TrafficFilters, exportAll = false): Promise<TrafficReport> {
 if(filters.error)throw new Error(filters.error);
 const { data,error }=await(await createClient()).rpc('admin_store_analytics_report',{
  p_from:filters.from,p_to:filters.to,p_dimension:filters.dimension,p_key:filters.key||null,p_compare:filters.compare,
  p_grain:filters.grain,p_query:filters.query,p_page:exportAll?1:filters.page,p_page_size:exportAll?10000:20,
 });
 if(error||!data||typeof data!=='object')throw new Error('방문 통계를 불러오지 못했습니다.');return data as TrafficReport;
}
/* 공지 집계는 보조 표다 — 읽기에 실패해도 방문 분석 화면은 그대로 보이고 이 표만 실패를 알린다(null). */
export async function getNoticeTrafficReport(filters: TrafficFilters): Promise<NoticeTrafficReport | null> {
 if(filters.error)return null;
 try {
  const { data,error }=await(await createClient()).rpc('admin_store_analytics_notice_report',{p_from:filters.from,p_to:filters.to});
  if(error||!data||typeof data!=='object'||!Array.isArray((data as NoticeTrafficReport).rows))return null;
  return data as NoticeTrafficReport;
 } catch { return null; }
}
