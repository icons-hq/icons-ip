import { describe,it,expect,vi } from 'vitest';
vi.mock('server-only',()=>({}));
const mocks=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>mocks}));
import { getAdminReviewInsights } from './review-insights.server';
import { normalizeReviewInsightFilters } from './review-insights';

describe('review insight loader',()=>{
  it('passes all filters to the single aggregate RPC and does not turn a failed read into zero data',async()=>{
    mocks.rpc.mockResolvedValueOnce({data:null,error:{message:'unavailable'}});
    await expect(getAdminReviewInsights(normalizeReviewInsightFilters({focus:'coverage',q:'needle',sort:'reviews',page:'2',size:'50'}))).rejects.toThrow('리뷰 분석을 불러오지 못했습니다');
    expect(mocks.rpc).toHaveBeenCalledWith('admin_review_insights',{p_focus:'coverage',p_query:'needle',p_sort:'reviews',p_page:2,p_page_size:50});
  });
});
