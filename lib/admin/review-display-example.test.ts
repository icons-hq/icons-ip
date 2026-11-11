import { describe, expect, it } from 'vitest';
import { REVIEW_DISPLAY_EXAMPLE_GOOD_ID, REVIEW_DISPLAY_EXAMPLE_MARK, reviewDisplayExample, reviewDisplayExampleImage } from './review-display-example';

/* SHEET-027: 노출 예시는 합성 데이터다. 어디에 찍혀도 실제 후기로 읽히지 않고, 바깥 주소를 부르지 않는다. */
describe('review display example data', () => {
  const now = new Date('2026-11-11T03:00:00.000Z');
  const example = reviewDisplayExample(now);

  it('marks every customer-visible text as an example', () => {
    expect(example.goodName.startsWith(REVIEW_DISPLAY_EXAMPLE_MARK)).toBe(true);
    for (const review of example.section.reviews) {
      expect(review.body.startsWith(REVIEW_DISPLAY_EXAMPLE_MARK), review.id).toBe(true);
      expect(review.authorName, review.id).toContain('예시');
      if (review.adminReply) expect(review.adminReply.startsWith(REVIEW_DISPLAY_EXAMPLE_MARK), review.id).toBe(true);
      if (review.eventDisclosure) expect(review.eventDisclosure.eventTitle).toContain('예시');
    }
    for (const card of example.cards) expect(card.name.startsWith(REVIEW_DISPLAY_EXAMPLE_MARK)).toBe(true);
    expect(decodeURIComponent(reviewDisplayExampleImage('예시 사진 1', 10))).toContain('예시 사진 1');
  });

  it('uses inline images only — no storage or outside addresses', () => {
    const urls = [...example.section.reviews.flatMap(review => review.imageUrls), ...(example.highlights.reviews?.cards.flatMap(card => card.imageUrls) ?? [])];
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    for (const card of example.cards) expect(card.imageBackground).toMatch(/^url\("data:image\/svg\+xml;charset=utf-8,[^"]*"\) center \/ cover no-repeat$/);
  });

  it('keeps the summary consistent with the listed reviews, like the public loader', () => {
    const { summary, reviews, total, pageSize, viewerAuthenticated } = example.section;
    expect(summary.count).toBe(reviews.length);
    expect(total).toBe(reviews.length);
    expect(reviews.length).toBeLessThanOrEqual(pageSize);
    expect(summary.distribution.reduce((sum, count) => sum + count, 0)).toBe(summary.count);
    expect(summary.average).toBeCloseTo(reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length, 2);
    expect(summary.photoCount).toBe(reviews.filter(review => review.imageUrls.length).length);
    expect(viewerAuthenticated).toBe(false);
    expect(reviews.every(review => !review.isMine && !review.canMarkHelpful)).toBe(true);
    expect(example.cards[0].reviewSummary).toEqual({ count: summary.count, average: summary.average });
    expect(example.cards[1].reviewSummary).toBeNull();
  });

  it('shows the cases an operator asks about: photos, reply, edit, one-month review, repeat purchase, event disclosure', () => {
    const { reviews } = example.section;
    expect(reviews.some(review => review.imageUrls.length > 1 && review.adminReply)).toBe(true);
    expect(reviews.some(review => review.editedAt)).toBe(true);
    expect(reviews.some(review => review.kind === 'month')).toBe(true);
    expect(reviews.some(review => review.repeatPurchase)).toBe(true);
    expect(reviews.some(review => review.eventDisclosure && !review.eventDisclosure.revoked)).toBe(true);
    expect(new Set(reviews.map(review => review.rating)).size).toBeGreaterThan(1);
    expect(reviews.map(review => review.createdAt)).toEqual([...reviews.map(review => review.createdAt)].sort().reverse());
    expect(reviews.every(review => Date.parse(review.createdAt) <= now.getTime())).toBe(true);
  });

  it('builds the top review summary from 4-5 point reviews, photo reviews first', () => {
    const highlights = example.highlights.reviews!;
    expect(highlights.count).toBe(example.section.summary.count);
    expect(highlights.positiveCount).toBe(example.section.reviews.filter(review => review.rating >= 4).length);
    expect(highlights.cards.every(card => card.rating >= 4)).toBe(true);
    const photos = highlights.cards.map(card => card.imageUrls.length > 0);
    expect(photos).toEqual([...photos].sort((left, right) => Number(right) - Number(left)));
    expect(REVIEW_DISPLAY_EXAMPLE_GOOD_ID).toMatch(/^[a-z0-9][a-z0-9-]{0,199}$/);
  });
});
