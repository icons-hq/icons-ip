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
    /* 상품 검색은 같은 화면 GET 폼을 제출한다(kit Button은 type을 주지 않으면 button이 된다). */
    expect(html).toMatch(/<form[^>]*method="get"[\s\S]*?<button(?=[^>]*type="submit")[^>]*>조회<\/button>/);
    expect(html).toContain('상품별 평균의 평균');
    expect(html).not.toContain('NaN');
    const href=html.match(/href="([^"]+)"[^>]*>리뷰 조회 및 관리/)?.[1]?.replaceAll('&amp;','&');
    expect(href).toBeTruthy();
    const linkedFilters=normalizeAdminReviewFilters(Object.fromEntries(new URL(href!, 'https://icons.example').searchParams));
    expect(linkedFilters).toMatchObject({field:'good',query:'검수 상품',status:'visible'});
  });
});

describe('review insights 상태 구분', () => {
  const row = { id: 'g-a', name: '검수 상품', price: 1000, imagePath: null, reviewCount: 8, photoCount: 8, unansweredCount: 3, averageRating: 4.59, photoRate: 100, coverageRate: 100, deliveredCount: 6, reviewedCount: 3 };
  const data: ReviewInsights = { asOf: '2026-10-12', cohortFrom: '2026-07-15', summary: { newReviews: 3, newLowReviews: 1, averageRating: 3.8, sixMonthRating: null, photoRate: 27.64, coverageRate: 50 }, counts: { all: 23, photo: 2, coverage: 0, rating: 1, unanswered: 4 }, total: 2, page: 1, pageSize: 20, rows: [row, { ...row, id: 'g-b', averageRating: 4.6, unansweredCount: 0 }] };
  const html = renderToStaticMarkup(<ReviewInsightsScreen data={data} filters={normalizeReviewInsightFilters({})} />);

  /* 탭이 '평점 4.6 미만'을 말하는데 표가 같은 기준을 안 쓰면 위험 상품이 안 갈린다. 경계값 4.6은 서버처럼 미달이 아니다. */
  it('평점 칸은 탭과 같은 4.6 기준으로 미달만 주의색이고 글자로도 말한다', () => {
    expect(html).toMatch(/class="font-semibold text-warning">4\.59</);
    expect(html).toMatch(/class="font-semibold\s*">4\.60</);
    expect(html.match(/리뷰 8개 · 4\.6 미만/g)).toHaveLength(1);
  });

  it('미답글 칸은 주의색 없이 숫자로 두고, 문제 건수가 있는 탭만 주의색이다', () => {
    expect(html).not.toMatch(/text-warning[^>]*>3건</);
    expect(html).toMatch(/text-muted-foreground[^>]*>0건</);
    expect(html).toMatch(/전체 상품<span class="tabular-nums\s*">23개/);
    expect(html).toMatch(/사진 리뷰 비중이 낮은 상품<span class="[^"]*text-warning[^"]*">2개/);
    expect(html).toMatch(/주문 대비 리뷰가 적은 상품<span class="tabular-nums\s*">0개/);
  });

  /* 다른 화면의 건수 카드와 같은 모양이고, 값은 표와 같은 자릿수로 줄여 넘긴다. */
  it('맨 위 숫자는 건수 카드로 그린다', () => {
    expect(html.match(/data-tone="[a-z]+"/g)).toHaveLength(6);
    expect(html).toMatch(/data-tone="danger"[\s\S]*?3점 이하 새 리뷰/);
    expect(html).toContain('27.6<span');
    expect(html).not.toContain('27.64');
    expect(html).toContain('미작성 상품주문');
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
