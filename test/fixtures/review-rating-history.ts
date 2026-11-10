import type { ReviewRatingHistory } from '@/lib/admin/review-rating-history';
import type { ReviewInsights } from '@/lib/admin/review-insights';
export const reviewRatingHistoryFixture: ReviewRatingHistory = {
  version: 1, asOf: '2026-10-14', comparisonAsOf: '2026-07-14', status: 'available', enabled: true,
  collectionStartedAt: '2026-07-01T15:00:00Z', lastSuccessAt: '2026-10-14T15:05:00Z',
  purgedBeforeAsOf: '2025-09-15', lastPurgedAt: '2026-10-14T15:05:01Z',
  observation: { version: 1, asOf: '2026-07-14', observationDay: '2026-07-15', observedAt: '2026-07-14T15:05:42.123456+00:00',
    sixMonthFrom: '2026-01-15', averageRating: 4.13, sixMonthRating: 4.62, eligibleProductCount: 8,
    ratedProductCount: 3, sixMonthRatedProductCount: 2, reviewCount: 31, sixMonthReviewCount: 5, fingerprint: 'a'.repeat(64) },
};
export const reviewInsightsFixture: ReviewInsights = {
  asOf: '2026-10-14', cohortFrom: '2026-07-17', summary: { newReviews: 3, newLowReviews: 1, averageRating: 4.25, sixMonthRating: 4.52, photoRate: 40, coverageRate: 50 },
  counts: { all: 1, photo: 0, coverage: 0, rating: 1, unanswered: 0 }, total: 1, page: 1, pageSize: 20,
  rows: [{ id: 'test-history-good', name: '이력 비교 상품', price: 1000, imagePath: null, reviewCount: 8, photoCount: 2, unansweredCount: 0, averageRating: 4.25, photoRate: 25, coverageRate: 50, deliveredCount: 6, reviewedCount: 3 }],
};
