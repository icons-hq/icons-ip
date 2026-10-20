import { describe, expect, it } from 'vitest';
import { newReviewEventValues, normalizeReviewEventFilters, parseReviewEventSelection, parseReviewEventValues, reviewEventToday } from './review-events';
describe('review event contracts', () => {
  it('uses KST date boundaries and requires real dates and bounded terms', () => {
    expect(reviewEventToday(Date.parse('2026-10-13T15:00:00Z'))).toBe('2026-10-14');
    const values = { ...newReviewEventValues('2026-10-13'), title: '후기 이벤트', description: '별점과 무관한 사용 후기' };
    expect(parseReviewEventValues(values)).toEqual(values);
    for (const change of [{ startsOn: '2026-02-30' }, { endsOn: values.startsOn }, { announcesOn: values.endsOn }, { plannedWinners: 1001 }, { creditAmount: '1000' }, { creditValidityDays: 0 }, { title: '1234567890123456' }, { title: ' 제목 ' }]) expect(parseReviewEventValues({ ...values, ...change })).toBeNull();
  });
  it('accepts target IDs only for the selected mode and rejects empty/duplicate/oversized targets', () => {
    const values = { ...newReviewEventValues(), title: '이벤트', description: '안내문' };
    expect(parseReviewEventValues({ ...values, targetType: 'goods', goodIds: ['g1'] })).not.toBeNull();
    for (const change of [{ goodIds: ['g1'] }, { targetType: 'goods' }, { targetType: 'goods', goodIds: ['g1', 'g1'] }, { targetType: 'goods', goodIds: Array.from({ length: 501 }, (_, n) => `g${n}`) }]) expect(parseReviewEventValues({ ...values, ...change })).toBeNull();
  });
  it('requires both timestamp and content fingerprint for selection rechecks', () => {
    const token = { id: '92000000-0000-4000-8000-000000000001', reviewUpdatedAt: '2026-10-13T01:00:00Z', reviewFingerprint: 'a'.repeat(32) };
    expect(parseReviewEventSelection([token])).toEqual([token]);
    expect(parseReviewEventSelection([{ ...token, reviewFingerprint: '' }])).toBeNull();
    expect(parseReviewEventSelection([token, token])).toBeNull();
  });
  it('normalizes URL filters without negative or malformed pagination', () => {
    expect(normalizeReviewEventFilters({ page: '-1', pageSize: '999', from: '2026-10-14', to: '2026-10-13', state: 'broken' })).toMatchObject({ page: 1, pageSize: 20, from: '2026-10-14', to: '2026-10-14', state: 'all' });
  });
});
