import { renderToStaticMarkup } from 'react-dom/server';
import { describe,it,expect } from 'vitest';
import { ReviewInsightsScreen } from './ReviewInsightsScreen';
import { normalizeReviewInsightFilters,type ReviewInsights } from '@/lib/admin/review-insights';
import { normalizeAdminReviewFilters } from '@/lib/admin/reviews';

describe('review insights screen',()=>{
  it('shows actual diagnostics, their cohort denominator and preserved filtered pagination',()=>{
    const data: ReviewInsights={asOf:'2026-10-12',cohortFrom:'2026-07-15',summary:{newReviews:3,newLowReviews:1,averageRating:4.25,sixMonthRating:null,photoRate:40,coverageRate:50},counts:{all:23,photo:2,coverage:3,rating:1,unanswered:4},total:23,page:1,pageSize:20,rows:[{id:'g-a',name:'검수 상품',price:1000,imagePath:null,reviewCount:8,photoCount:2,unansweredCount:3,averageRating:4.25,photoRate:25,coverageRate:50,deliveredCount:6,reviewedCount:3}]};
    const html=renderToStaticMarkup(<ReviewInsightsScreen data={data} filters={normalizeReviewInsightFilters({q:'검수'})}/>);
    expect(html).toContain('사진 리뷰 비중이 낮은 상품');
    expect(html).toContain('2026-07-15');
    expect(html).toContain('25.0%');
    expect(html).toContain('미작성 상품주문');
    expect(html).toContain('page=2');
    expect(html).toContain('상품별 평균의 평균');
    expect(html).not.toContain('NaN');
    const href=html.match(/href="([^"]+)">리뷰 조회 및 관리/)?.[1]?.replaceAll('&amp;','&');
    expect(href).toBeTruthy();
    const linkedFilters=normalizeAdminReviewFilters(Object.fromEntries(new URL(href!, 'https://icons.example').searchParams));
    expect(linkedFilters).toMatchObject({field:'good',query:'검수 상품',status:'visible'});
  });
});

import { reviewInsightsFixture, reviewRatingHistoryFixture } from '@/test/fixtures/review-rating-history';
it('shows each three-month delta, both asOf dates, observation time and actual denominators', () => {
  const html = renderToStaticMarkup(<ReviewInsightsScreen data={reviewInsightsFixture} history={{ kind: 'ready', data: reviewRatingHistoryFixture }} filters={normalizeReviewInsightFilters({})}/>);
  expect(html).toContain('3개월 전 대비 +0.12점');
  expect(html).toContain('3개월 전 대비 −0.10점');
  expect(html).toContain('현재 2026-10-14 / 3개월 전 2026-07-14');
  expect(html).toContain('과거 관측 시각:');
  expect(html).toContain('상품 3개, 공개 리뷰 31건');
  expect(html).toContain('상품 2개, 공개 리뷰 5건');
  expect(html).toContain('이력 비교 상품');
});
it('does not hide the current data when history is unavailable', () => {
  const html = renderToStaticMarkup(<ReviewInsightsScreen data={reviewInsightsFixture} history={{ kind: 'error' }} filters={normalizeReviewInsightFilters({})}/>);
  expect(html).toContain('과거 비교를 불러오지 못했습니다');
  expect(html).toContain('4.25');
  expect(html).toContain('이력 비교 상품');
});
