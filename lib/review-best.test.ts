import { describe, expect, it } from 'vitest';
import { canSelectBestReview, parseReviewBestRequest, parseReviewBestState, parseSelectedReviewCards, type ReviewBestState } from './review-best';
const id = '93500000-0000-4000-8000-000000000001';
const state: ReviewBestState = { reviewId: id, selected: true, revision: 1, reviewFingerprint: 'a'.repeat(32), selectedAt: '2026-10-13T01:00:00Z', reason: '구체적인 사용 후기', problem: null, state: 'selected' };
const request = { reviewId: id, selected: true, reason: '구체적인 사용 후기', expectedRevision: 0, reviewFingerprint: state.reviewFingerprint, operationId: id };
describe('BEST 선정 계약', () => {
  it('현재와 재확인 상태를 구별하고 모순된 응답은 거절한다', () => {
    expect(parseReviewBestState(state)).toEqual(state);
    expect(parseReviewBestState({ ...state, selected: false })).toBeNull();
    expect(parseReviewBestState({ ...state, revision: 0 })).toBeNull();
    expect(parseReviewBestState({ ...state, problem: 'review_changed' })).toBeNull();
    expect(parseReviewBestState({ ...state, state: 'needs_review', problem: 'review_changed' })?.problem).toBe('review_changed');
    expect(canSelectBestReview({ ...state, state: 'needs_review', problem: 'purchase_changed' })).toBe(true);
    expect(canSelectBestReview({ ...state, state: 'needs_review', problem: 'purchase_ineligible' })).toBe(false);
  });
  it('사유와 동시수정 기준을 엄격하게 검증한다', () => {
    expect(parseReviewBestRequest({ ...request, reason: '  사유 입력  ' })?.reason).toBe('사유 입력');
    for (const patch of [{ reason: 'a' }, { reason: 'a\nb' }, { reason: 'a'.repeat(501) }, { expectedRevision: -1 }, { selected: 'true' }, { reviewFingerprint: '' }, { extra: true }]) expect(parseReviewBestRequest({ ...request, ...patch })).toBeNull();
  });
  it('공개 카드는 무작위 선정된 정확한 3개이며 1점도 허용한다', () => {
    const cards = [1,2,3].map(n => ({ id: `93500000-0000-4000-8000-${String(n).padStart(12,'0')}`, rating: n, body: '선정된 리뷰 본문', authorName: '구매자', createdAt: '2026-10-13T01:00:00Z', imagePaths: [] }));
    expect(parseSelectedReviewCards(cards)).toEqual(cards);
    expect(parseSelectedReviewCards(cards.map(card => ({ ...card, orderId: 'private' })))?.[0]).not.toHaveProperty('orderId');
    expect(parseSelectedReviewCards([])).toEqual([]);
    expect(parseSelectedReviewCards(cards.slice(0,2))).toBeNull();
    expect(parseSelectedReviewCards([...cards,cards[0]])).toBeNull();
    expect(parseSelectedReviewCards([cards[0],cards[0],cards[2]])).toBeNull();
    expect(parseSelectedReviewCards([{ ...cards[0], rating: 0 },...cards.slice(1)])).toBeNull();
  });
});
