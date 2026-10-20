import { describe, expect, it } from 'vitest';
import { isReviewRatingDate, parseReviewRatingCollectionResult, parseReviewRatingHistory, reviewRatingComparisonText, reviewRatingMonthsBefore } from './review-rating-history';
import { reviewRatingHistoryFixture as fixture } from '@/test/fixtures/review-rating-history';

describe('versioned review rating observations', () => {
  it.each([['2026-05-31', '2026-02-28'], ['2024-05-31', '2024-02-29'], ['2026-08-31', '2026-05-31'], ['2026-10-14', '2026-07-14']])('uses calendar month subtraction for %s', (input, expected) => {
    expect(reviewRatingMonthsBefore(input, 3)).toBe(expected);
  });
  it('checks actual calendar dates and the exact same-version historical observation', () => {
    expect(isReviewRatingDate('2026-02-30')).toBe(false);
    expect(parseReviewRatingHistory(fixture, fixture.asOf)).toEqual(fixture);
    expect(parseReviewRatingHistory({ ...fixture, version: 2, observation: { ...fixture.observation, version: 2 } }, fixture.asOf)?.version).toBe(2);
    for (const patch of [{ version: 0 }, { version: 2 }, { asOf: '2026-10-15' }, { comparisonAsOf: '2026-07-15' }, { extra: true }, { lastSuccessAt: null }, { enabled: true, collectionStartedAt: null }]) {
      expect(parseReviewRatingHistory({ ...fixture, ...patch }, fixture.asOf)).toBeNull();
    }
  });
  it.each([
    { averageRating: null }, { averageRating: 0 }, { averageRating: 4.123 }, { averageRating: NaN },
    { ratedProductCount: 9 }, { sixMonthRatedProductCount: 4 }, { reviewCount: 2 }, { sixMonthReviewCount: 32 },
    { observedAt: '2026-07-15T15:05:00Z' }, { observedAt: '2026-07-14T24:00:00Z' }, { observedAt: '2026-07-14T15:60:00Z' },
    { sixMonthFrom: '2026-01-14' }, { observationDay: '2026-07-14' }, { fingerprint: 'x'.repeat(64) }, { extra: true },
  ])('rejects incompatible historical data %j', patch => {
    expect(parseReviewRatingHistory({ ...fixture, observation: { ...fixture.observation, ...patch } }, fixture.asOf)).toBeNull();
  });
  it('preserves null metrics only with a zero denominator', () => {
    const value = { ...fixture, observation: { ...fixture.observation!, averageRating: null, sixMonthRating: null, ratedProductCount: 0, sixMonthRatedProductCount: 0, reviewCount: 0, sixMonthReviewCount: 0 } };
    expect(parseReviewRatingHistory(value, fixture.asOf)).toEqual(value);
    expect(reviewRatingComparisonText(4.5, { kind: 'ready', data: value }, 'averageRating')).toBe('비교할 평점 없음');
  });
  it('distinguishes unstarted collection, an actually completed retention boundary, and a missed observation', () => {
    const unstarted = { ...fixture, status: 'before_collection_start' as const, enabled: false, collectionStartedAt: null, lastSuccessAt: null, purgedBeforeAsOf: null, lastPurgedAt: null, observation: null };
    const missed = { ...fixture, status: 'not_collected' as const, observation: null };
    const expired = { ...missed, status: 'outside_retention' as const, purgedBeforeAsOf: '2026-07-15' };
    for (const value of [unstarted, missed, expired]) expect(parseReviewRatingHistory(value, fixture.asOf)).toEqual(value);
    expect(parseReviewRatingHistory({ ...unstarted, status: 'not_collected' }, fixture.asOf)).toBeNull();
    expect(parseReviewRatingHistory({ ...missed, status: 'outside_retention' }, fixture.asOf)).toBeNull();
    expect(parseReviewRatingHistory({ ...expired, lastPurgedAt: null }, fixture.asOf)).toBeNull();
    expect(reviewRatingComparisonText(4.5, { kind: 'ready', data: unstarted }, 'averageRating')).toContain('수집 시작 전');
    expect(reviewRatingComparisonText(4.5, { kind: 'ready', data: missed }, 'averageRating')).toContain('해당 날짜 미수집');
    expect(reviewRatingComparisonText(4.5, { kind: 'ready', data: expired }, 'averageRating')).toBe('보존 기간 외');
  });
  it('compares rounded hundredths as points, independently for each denominator', () => {
    const history = { kind: 'ready' as const, data: fixture };
    expect(reviewRatingComparisonText(4.25, history, 'averageRating')).toBe('3개월 전 대비 +0.12점');
    expect(reviewRatingComparisonText(4.52, history, 'sixMonthRating')).toBe('3개월 전 대비 −0.10점');
    expect(reviewRatingComparisonText(4.13, history, 'averageRating')).toBe('3개월 전 대비 0.00점');
    expect(reviewRatingComparisonText(null, history, 'averageRating')).toBe('비교할 평점 없음');
    expect(reviewRatingComparisonText(4.25, { kind: 'error' }, 'averageRating')).toBe('과거 비교를 불러오지 못했습니다');
  });
  it('strictly validates collection status without accepting forged or partial success', () => {
    const base = { version: 1, asOf: null, observedAt: null, fingerprint: null };
    for (const status of ['disabled', 'too_early']) expect(parseReviewRatingCollectionResult({ ...base, status })?.status).toBe(status);
    expect(parseReviewRatingCollectionResult({ ...base, version: null, status: 'busy' })?.status).toBe('busy');
    const recorded = { status: 'recorded', version: 1, asOf: '2026-07-14', observedAt: fixture.observation!.observedAt, fingerprint: 'a'.repeat(64) };
    expect(parseReviewRatingCollectionResult(recorded)).toEqual(recorded);
    expect(parseReviewRatingCollectionResult({ ...recorded, status: 'already_recorded' })?.status).toBe('already_recorded');
    for (const bad of [{ ...base, status: 'recorded' }, { ...base, status: 'busy' }, { ...recorded, asOf: '2026-07-15' }, { ...recorded, extra: true }, { ...recorded, status: 'ok' }]) expect(parseReviewRatingCollectionResult(bad)).toBeNull();
  });
});
