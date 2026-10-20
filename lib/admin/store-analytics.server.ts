import 'server-only';
import { createClient } from '@/lib/supabase/server';
import type { TrafficFilters, TrafficReport } from './store-analytics';
export async function getTrafficReport(filters: TrafficFilters, exportAll = false): Promise<TrafficReport> {
 if(filters.error)throw new Error(filters.error);
 const { data,error }=await(await createClient()).rpc('admin_store_analytics_report',{
  p_from:filters.from,p_to:filters.to,p_dimension:filters.dimension,p_key:filters.key||null,p_compare:filters.compare,
  p_grain:filters.grain,p_query:filters.query,p_page:exportAll?1:filters.page,p_page_size:exportAll?10000:20,
 });
 if(error||!data||typeof data!=='object')throw new Error('방문 통계를 불러오지 못했습니다.');return data as TrafficReport;
}
