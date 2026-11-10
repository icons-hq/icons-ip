import { describe, expect, it, vi } from 'vitest';
import {
  parseGoodsReviewSummaries,
  pickGoodsReviewSummaries,
  reviewStarCount,
  reviewSummaryLabel,
} from './goods-review-summary';
import { GOODS_REVIEW_SUMMARY_BATCH, loadGoodsReviewSummaries } from './goods-review-summary.server';

/* 목록 카드 별점(LFS 패리티 2차 L4 · CL-02) — RPC 응답 검증·배치·표시 규칙. */

describe('parseGoodsReviewSummaries', () => {
  it('keeps only requested goods with a positive count and a 1–5 average', () => {
    const parsed = parseGoodsReviewSummaries([
      { goodId: 'a', reviewCount: 3, ratingAverage: '4.33' },
      { goodId: 'b', reviewCount: 0, ratingAverage: 4 },
      { goodId: 'c', reviewCount: 2, ratingAverage: 6 },
      { goodId: 'outside', reviewCount: 9, ratingAverage: 5 },
      { goodId: 'a', reviewCount: 1, ratingAverage: 1 },
      { goodId: 'd', reviewCount: 1.5, ratingAverage: 3 },
      null,
      'junk',
    ], new Set(['a', 'b', 'c', 'd']));

    expect(parsed).toEqual({ a: { count: 3, average: 4.33 } });
  });

  it('returns nothing for a non-array payload', () => {
    expect(parseGoodsReviewSummaries(null, new Set(['a']))).toEqual({});
    expect(parseGoodsReviewSummaries({ goodId: 'a' }, new Set(['a']))).toEqual({});
  });
});

describe('pickGoodsReviewSummaries', () => {
  it('ships only the listed goods to the screen', () => {
    const all = { a: { count: 1, average: 5 }, b: { count: 2, average: 3 } };

    expect(pickGoodsReviewSummaries(all, ['b', 'z'])).toEqual({ b: { count: 2, average: 3 } });
    expect(pickGoodsReviewSummaries(undefined, ['a'])).toEqual({});
  });
});

describe('star display', () => {
  it('rounds like the product detail rating and reads a sentence instead of star glyphs', () => {
    expect(reviewStarCount(4.5)).toBe(5);
    expect(reviewStarCount(4.33)).toBe(4);
    expect(reviewStarCount(0.2)).toBe(0);
    expect(reviewStarCount(9)).toBe(5);
    expect(reviewSummaryLabel({ count: 1234, average: 4.25 })).toBe('평점 5점 만점에 4.3점, 리뷰 1,234개');
  });
});

describe('loadGoodsReviewSummaries', () => {
  it('reads unique ids in batches of 500 instead of once per card', async () => {
    const rpc = vi.fn(async (_name: string, args: { p_good_ids: string[] }) => ({
      data: args.p_good_ids.slice(0, 1).map((goodId) => ({ goodId, reviewCount: 1, ratingAverage: 5 })),
      error: null,
    }));
    const ids = Array.from({ length: GOODS_REVIEW_SUMMARY_BATCH + 3 }, (_, index) => `g${index}`);

    const summaries = await loadGoodsReviewSummaries({ rpc } as never, [...ids, 'g0']);

    expect(rpc.mock.calls.map(([name, args]) => [name, args.p_good_ids.length])).toEqual([
      ['get_goods_review_summaries', 500],
      ['get_goods_review_summaries', 3],
    ]);
    expect(Object.keys(summaries)).toEqual(['g0', 'g500']);
  });

  it('drops a failed batch without failing the others and skips the call for an empty list', async () => {
    const rpc = vi.fn(async (_name: string, args: { p_good_ids: string[] }) => (args.p_good_ids[0] === 'g0'
      ? { data: null, error: { message: 'unavailable' } }
      : { data: [{ goodId: args.p_good_ids[0], reviewCount: 2, ratingAverage: 4 }], error: null }));
    const ids = Array.from({ length: GOODS_REVIEW_SUMMARY_BATCH + 1 }, (_, index) => `g${index}`);

    expect(await loadGoodsReviewSummaries({ rpc } as never, ids)).toEqual({ g500: { count: 2, average: 4 } });
    expect(await loadGoodsReviewSummaries({ rpc } as never, [])).toEqual({});
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});
