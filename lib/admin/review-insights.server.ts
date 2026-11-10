import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { parseReviewInsights, type ReviewInsightFilters } from './review-insights';

export async function getAdminReviewInsights(filters: ReviewInsightFilters) {
  const client=await createClient();
  const { data,error }=await client.rpc('admin_review_insights',{ p_focus:filters.focus,p_query:filters.query,p_sort:filters.sort,p_page:filters.page,p_page_size:filters.pageSize });
  const parsed=parseReviewInsights(data);
  if(error || !parsed) throw new Error('리뷰 분석을 불러오지 못했습니다. 잠시 후 다시 조회해주세요.');
  return parsed;
}
