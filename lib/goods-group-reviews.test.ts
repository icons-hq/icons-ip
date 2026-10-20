import { describe, expect, it } from 'vitest';
import { parseGoodsGroupReviewPage } from './goods-group-reviews';

const review = { id: 'a6140000-0000-4000-8000-000000000001', goodId: 'original-good', goodName: '구매 당시 이름', variantNames: ['파랑'],
  rating: 4, body: '구매 후기', imagePaths: [], authorName: '구매자', isMine: false, createdAt: '2026-10-14T00:00:00Z',
  editedAt: null, adminReply: null, adminReplyAt: null };
const page = { grouped: true, summary: { count: 1, average: 4, distribution: [0, 0, 0, 1, 0], photoCount: 0 }, total: 1, reviews: [review] };
describe('그룹 리뷰 공개 응답', () => {
  it('구매 당시 상품·옵션을 보존하고 비어 있는 다음 페이지에서도 전체 건수를 잃지 않는다', () => {
    expect(parseGoodsGroupReviewPage(page)?.reviews[0]).toMatchObject({ goodId: 'original-good', goodName: '구매 당시 이름', variantNames: ['파랑'] });
    expect(parseGoodsGroupReviewPage({ ...page, reviews: [] })?.total).toBe(1);
  });
  it('중복 리뷰와 페이지 평균을 전체 평점처럼 보이게 하는 불일치 집계를 거절한다', () => {
    expect(parseGoodsGroupReviewPage({ ...page, reviews: [review, review] })).toBeNull();
    expect(parseGoodsGroupReviewPage({ ...page, summary: { ...page.summary, count: 2 } })).toBeNull();
    expect(parseGoodsGroupReviewPage({ ...page, summary: { ...page.summary, average: 6 } })).toBeNull();
    expect(parseGoodsGroupReviewPage({ ...page, reviews: [{ ...review, privateAccount: 'hidden' }] })).toBeNull();
    expect(parseGoodsGroupReviewPage({ ...page, reviews: [{ ...review, goodId: 'javascript:bad' }] })).toBeNull();
  });
});
