export const REVIEW_INSIGHTS_PATH = '/admin/cs/review-insights';
export const REVIEW_INSIGHT_FOCUSES = ['all', 'photo', 'coverage', 'rating', 'unanswered'] as const;
export type ReviewInsightFocus = typeof REVIEW_INSIGHT_FOCUSES[number];
export const REVIEW_INSIGHT_LABELS: Record<ReviewInsightFocus, string> = {
  all: '전체 상품', photo: '사진 리뷰 비중이 낮은 상품', coverage: '주문 대비 리뷰가 적은 상품', rating: '평점 4.6 미만 상품', unanswered: '미답글 리뷰가 있는 상품',
};
export interface ReviewInsightFilters { focus: ReviewInsightFocus; query: string; sort: 'analysis' | 'reviews' | 'rating'; page: number; pageSize: 20 | 50 | 100 }
export interface ReviewInsightProduct { id: string; name: string; price: number; imagePath: string | null; reviewCount: number; photoCount: number; unansweredCount: number; averageRating: number | null; photoRate: number | null; coverageRate: number | null; deliveredCount: number; reviewedCount: number }
export interface ReviewInsights {
  asOf: string; cohortFrom: string; summary: { newReviews: number; newLowReviews: number; averageRating: number | null; sixMonthRating: number | null; photoRate: number | null; coverageRate: number | null };
  counts: Record<ReviewInsightFocus, number>; total: number; page: number; pageSize: 20 | 50 | 100; rows: ReviewInsightProduct[];
}
export function normalizeReviewInsightFilters(query: Record<string, string | string[] | undefined>): ReviewInsightFilters {
  const page = Number(query.page);
  return { focus: REVIEW_INSIGHT_FOCUSES.includes(query.focus as ReviewInsightFocus) ? query.focus as ReviewInsightFocus : 'all',
    query: typeof query.q === 'string' ? query.q.trim().slice(0,100) : '',
    sort: query.sort==='reviews' || query.sort==='rating' ? query.sort : 'analysis',
    page: Number.isSafeInteger(page) && page>0 && page<=100000 ? page : 1,
    pageSize: query.size==='50' ? 50 : query.size==='100' ? 100 : 20 };
}
export function reviewInsightHref(filters: ReviewInsightFilters, overrides: Partial<ReviewInsightFilters> = {}): string {
  const value = { ...filters, ...overrides };
  return `${REVIEW_INSIGHTS_PATH}?${new URLSearchParams({ focus:value.focus,q:value.query,sort:value.sort,page:String(value.page),size:String(value.pageSize) })}`;
}
export function parseReviewInsights(value: unknown): ReviewInsights | null {
  if (!value || typeof value!=='object') return null;
  const data=value as ReviewInsights;
  const count=(n: unknown) => typeof n==='number' && Number.isSafeInteger(n) && n>=0;
  const metric=(n: unknown,max: number) => n===null || typeof n==='number' && Number.isFinite(n) && n>=0 && n<=max;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.asOf) || !/^\d{4}-\d{2}-\d{2}$/.test(data.cohortFrom)
    || !data.summary || !data.counts || !count(data.total) || !count(data.page) || data.page<1 || ![20,50,100].includes(data.pageSize)
    || !REVIEW_INSIGHT_FOCUSES.every(key=>count(data.counts[key])) || !count(data.summary.newReviews) || !count(data.summary.newLowReviews)
    || data.summary.newLowReviews>data.summary.newReviews || !metric(data.summary.averageRating,5) || !metric(data.summary.sixMonthRating,5)
    || !metric(data.summary.photoRate,100) || !metric(data.summary.coverageRate,100) || !Array.isArray(data.rows) || data.rows.length>data.pageSize) return null;
  if (data.rows.some(row=> !row || typeof row.id!=='string' || !row.id || typeof row.name!=='string' || !count(row.price)
    || row.imagePath!==null && typeof row.imagePath!=='string' || !count(row.reviewCount) || !count(row.photoCount)
    || !count(row.unansweredCount) || !count(row.deliveredCount) || !count(row.reviewedCount) || row.photoCount>row.reviewCount
    || row.unansweredCount>row.reviewCount || row.reviewedCount>row.deliveredCount || !metric(row.averageRating,5)
    || !metric(row.photoRate,100) || !metric(row.coverageRate,100))) return null;
  return data;
}
