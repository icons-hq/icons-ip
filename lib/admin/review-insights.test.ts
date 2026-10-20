import { describe,it,expect } from 'vitest';
import { normalizeReviewInsightFilters,parseReviewInsights,reviewInsightHref,type ReviewInsights } from './review-insights';

const empty: ReviewInsights={ asOf:'2026-10-12',cohortFrom:'2026-07-15',summary:{newReviews:0,newLowReviews:0,averageRating:null,sixMonthRating:null,photoRate:null,coverageRate:null},counts:{all:0,photo:0,coverage:0,rating:0,unanswered:0},total:0,page:1,pageSize:20,rows:[] };
describe('review diagnostics input and response boundary',()=>{
  it('normalizes bounded URL inputs and preserves literal search through focus and pages',()=>{
    const filters=normalizeReviewInsightFilters({focus:'photo',q:' %상품& ',size:'50',page:'2',sort:'reviews'});
    expect(filters).toEqual({focus:'photo',query:'%상품&',pageSize:50,page:2,sort:'reviews'});
    const url=new URL(reviewInsightHref(filters,{focus:'rating',page:1}),'https://test.local');
    expect(url.searchParams.get('q')).toBe('%상품&');
    expect(url.searchParams.get('focus')).toBe('rating');
    expect(normalizeReviewInsightFilters({focus:['photo'],page:'Infinity',size:'500'}).page).toBe(1);
  });
  it('preserves missing-data metrics as null and rejects impossible rates or malformed rows',()=>{
    expect(parseReviewInsights(empty)).toEqual(empty);
    expect(parseReviewInsights({...empty,summary:{...empty.summary,coverageRate:101}})).toBeNull();
    expect(parseReviewInsights({...empty,summary:{...empty.summary,newLowReviews:1}})).toBeNull();
    expect(parseReviewInsights({...empty,rows:[null]})).toBeNull();
    expect(parseReviewInsights({...empty,total:NaN})).toBeNull();
  });
});
