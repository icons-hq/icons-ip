import { describe, expect, it } from 'vitest';
import { parseGoodsGroupReviewHelpfulPage, parseReviewHelpfulRequest, parseReviewHelpfulState } from './review-helpful';
import { parseGoodsGroupReviewPage } from './goods-group-reviews';
import { goodReviewsHref, normalizeGoodReviewOptions } from './reviews';

const reviewId = 'a6140000-0000-4000-8000-000000000001';
const row = { id: reviewId, goodId: 'original-good', goodName: '구매 당시 굿즈', variantNames: ['파랑'], rating: 4,
  body: '합성 후기', imagePaths: [], authorName: '구매자', isMine: false, createdAt: '2026-10-14T00:00:00Z', editedAt: null,
  adminReply: null, adminReplyAt: null };
const original = { grouped: true, summary: { count: 1, average: 4, distribution: [0, 0, 0, 1, 0], photoCount: 0 }, total: 1, reviews: [row] };
const state = { reviewId, helpfulCount: 2, helpfulByMe: true, canMarkHelpful: true };
const page = { ...original, viewerAuthenticated: true, reviews: [{ ...row, helpfulCount: 2, helpfulByMe: true, canMarkHelpful: true }] };

describe('리뷰 도움 표시 계약', () => {
  it('원구매·그룹·집계를 보존하며 기존 strict reader를 넓히지 않는다', () => {
    expect(parseGoodsGroupReviewPage(original)).not.toBeNull();
    expect(parseGoodsGroupReviewPage(page)).toBeNull();
    expect(parseGoodsGroupReviewHelpfulPage(page)).toEqual(page);
    expect(parseGoodsGroupReviewHelpfulPage({ ...page, reviews: [{ ...page.reviews[0], voterIds: ['private'] }] })).toBeNull();
    expect(parseGoodsGroupReviewHelpfulPage({ ...page, privateAccount: 'private' })).toBeNull();
  });
  it('누락·부정확한 숫자·불가능한 회원 상태를 0명으로 바꾸지 않는다', () => {
    for (const helpfulCount of [undefined, '2', -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseGoodsGroupReviewHelpfulPage({ ...page, reviews: [{ ...page.reviews[0], helpfulCount }] })).toBeNull();
    }
    expect(parseGoodsGroupReviewHelpfulPage({ ...page, viewerAuthenticated: false })).toBeNull();
    expect(parseGoodsGroupReviewHelpfulPage({ ...page, reviews: [{ ...page.reviews[0], isMine: true }] })).toBeNull();
    expect(parseReviewHelpfulState({ ...state, helpfulCount: 0 })).toBeNull();
    expect(parseReviewHelpfulState({ ...state, canMarkHelpful: false })).toEqual({ ...state, canMarkHelpful: false });
  });
  it('비회원에게 공개 도움수만 허용하고 투표자 정보는 포함하지 않는다', () => {
    const guest = { ...page, viewerAuthenticated: false, reviews: [{ ...page.reviews[0], helpfulByMe: false, canMarkHelpful: false }] };
    expect(parseGoodsGroupReviewHelpfulPage(guest)).toEqual(guest);
    expect(parseGoodsGroupReviewHelpfulPage({ ...guest, reviews: [{ ...guest.reviews[0], isMine: true }] })).not.toBeNull();
    expect(parseGoodsGroupReviewHelpfulPage({ ...guest, reviews: [{ ...guest.reviews[0], helpfulByMe: true }] })).toBeNull();
  });
  it('같은 목표 상태의 재시도와 검증된 PDP 복귀 조건만 받는다', () => {
    const options = normalizeGoodReviewOptions({ reviewSort: 'helpful_desc', reviewPhoto: '1', reviewPage: '2' });
    const request = { goodId: 'converted-good', reviewId, marked: false, options };
    expect(parseReviewHelpfulRequest(request)).toEqual(request);
    expect(goodReviewsHref(request.goodId, options)).toBe('/shop/converted-good?reviewSort=helpful_desc&reviewPhoto=1&reviewPage=2#reviews');
    expect(parseReviewHelpfulRequest({ ...request, marked: 'false' })).toBeNull();
    expect(parseReviewHelpfulRequest({ ...request, userId: reviewId })).toBeNull();
    expect(parseReviewHelpfulRequest({ ...request, goodId: '../login?next=https://example.test' })).toBeNull();
    expect(parseReviewHelpfulRequest({ ...request, options: { ...options, page: 0 } })).toBeNull();
  });
});
