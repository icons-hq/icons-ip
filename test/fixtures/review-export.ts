import { DEFAULT_ADMIN_REVIEW_FILTERS } from '@/lib/admin/reviews';
import { reviewExportFilters, type ReviewExportFilters, type ReviewExportRow, type ReviewExportSnapshot } from '@/lib/admin/review-export';

export const reviewExportId = (value: number) => `a7200000-0000-4000-8000-${String(value).padStart(12, '0')}`;
export const reviewExportFilterFixture = (): ReviewExportFilters => reviewExportFilters({ ...DEFAULT_ADMIN_REVIEW_FILTERS });
export function reviewExportRowFixture(overrides: Partial<ReviewExportRow> = {}): ReviewExportRow {
  return { kind: 'ordinary', repeatPurchase: null, id: reviewExportId(1), goodId: '000012-good', goodName: '검증 상품', authorName: '검증 작성자', rating: 4,
    body: '전체 리뷰 내용입니다.\n한글 줄바꿈과 원문을 유지합니다.', imageCount: 2, helpfulCount: 7, status: 'visible', bestState: 'not_selected',
    reportCount: 3, openReportCount: 1, hasReply: false, replyAt: null, createdAt: '2026-10-15T00:00:00+00:00', editedAt: null, ...overrides };
}
export function reviewExportSnapshotFixture(overrides: Partial<ReviewExportSnapshot> = {}): ReviewExportSnapshot {
  return { version: 2, filters: reviewExportFilterFixture(), total: 1, rows: [reviewExportRowFixture()],
    capturedAt: '2026-10-15T04:00:00.123456+00:00', fingerprint: 'a'.repeat(64), ...overrides };
}
