import { describe, expect, it } from 'vitest';
import { parseReviewTypePolicy, parseTypedReviewPage, targetReviewDaysRemaining } from './review-types';
import { normalizeAdminReviewFilters, adminReviewHref } from './admin/reviews';
import { reviewExportFilters, reviewExportHref, parseReviewExportQuery, parseReviewExportSnapshot } from './admin/review-export';
import { reviewExportSnapshotFixture } from '@/test/fixtures/review-export';
const policy = { revision: 1, enabled: false, basis: 'delivered', startDays: null, endDays: null, maxOrderDays: null, rewardEligible: false, evidence: '', updatedAt: '2026-10-16T00:00:00Z' };
describe('리뷰 유형 계약', () => {
 it('기본 꺼짐은 빈 기간을 허용하고 활성화는 실제 기간을 요구한다', () => {
  expect(parseReviewTypePolicy(policy)).toEqual(policy);
  for (const patch of [{ enabled: true }, { startDays: 29 }, { startDays: 90, endDays: 31 }, { maxOrderDays: 0 }, { rewardEligible: 'true' }, { extra: true }]) expect(parseReviewTypePolicy({ ...policy, ...patch })).toBeNull();
  expect(parseReviewTypePolicy({ ...policy, enabled: true, startDays: 31, endDays: 90 })).not.toBeNull();
 });
 it('유형·재구매 조건은 검색·페이지·내보내기에 유지된다', () => {
  const filters = normalizeAdminReviewFilters({ kind: 'month', repeat: 'yes', page: '2' });
  expect(adminReviewHref(filters)).toContain('kind=month');
  const exported = reviewExportFilters(filters);
  expect(parseReviewExportQuery(new URL(reviewExportHref(exported), 'https://example.test').searchParams)).toEqual(exported);
  expect(parseReviewExportQuery(new URLSearchParams('kind=unknown'))).toBeNull();
  expect(parseReviewExportQuery(new URLSearchParams('repeat=true'))).toBeNull();
 });
 it('공개 유형 누락을 일반 리뷰나 첫 구매로 추측하지 않는다', () => {
  const page = { grouped: false, viewerAuthenticated: false, summary: { count: 1, average: 5, distribution: [0, 0, 0, 0, 1], photoCount: 0 }, total: 1, reviews: [{ id: 'c7160750-0000-4000-8000-000000000001', goodId: 'test', goodName: '합성 상품', variantNames: [], rating: 5, body: '합성 리뷰 본문', imagePaths: [], authorName: '구매자', isMine: false, createdAt: '2026-10-16T00:00:00Z', editedAt: null, adminReply: null, adminReplyAt: null, helpfulCount: 0, helpfulByMe: false, canMarkHelpful: false, kind: 'month', repeatPurchase: null }] };
  expect(parseTypedReviewPage(page)?.reviews[0]).toMatchObject({ kind: 'month', repeatPurchase: null });
  expect(parseTypedReviewPage({ ...page, reviews: [{ ...page.reviews[0], kind: undefined }] })).toBeNull();
  expect(parseTypedReviewPage({ ...page, reviews: [{ ...page.reviews[0], repeatPurchase: 'false' }] })).toBeNull();
 });
 it('버전 2 파일은 유형 누락·거짓 재구매 타입을 거절한다', () => {
  const snapshot = reviewExportSnapshotFixture();
  expect(parseReviewExportSnapshot(snapshot, snapshot.filters)).not.toBeNull();
  for (const patch of [{ kind: undefined }, { repeatPurchase: 'true' }, { kind: 'unknown' }]) expect(parseReviewExportSnapshot({ ...snapshot, rows: [{ ...snapshot.rows[0], ...patch }] }, snapshot.filters)).toBeNull();
 });
 it('배송일 재계산 대신 서버가 고정한 마감일을 사용한다', () => {
  expect(targetReviewDaysRemaining({ deliveredAt: '2026-01-01T00:00:00Z', deadlineAt: '2026-10-20T00:00:00Z' }, new Date('2026-10-16T00:00:00Z'))).toBe(4);
 });
});
