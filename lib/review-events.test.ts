import { describe, expect, it } from 'vitest';
import { newReviewEventValues, normalizeReviewEventFilters, parseReviewEventCreditPolicy, parseReviewEventSelection, parseReviewEventValues, reviewEventCreditPolicyLabel,
  reviewEventCreditPolicyProblem, reviewEventError, reviewEventFieldErrors, reviewEventToday, trimReviewEventText, withReviewEventEndsOn, withReviewEventStartsOn } from './review-events';
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

/* R6: 등록 실패 원인(정책 꺼짐·상한 초과·필드 범위)을 저장 전에 필드별로 알린다. 서버·DB 규칙과 같은 기준이다. */
describe('review event editor guidance (R6)', () => {
  const today = '2026-10-28';
  const base = () => ({ ...newReviewEventValues(today), title: '후기 이벤트', description: '별점과 무관한 사용 후기' });

  it('trims surrounding spaces before validation instead of failing the whole form', () => {
    const trimmed = trimReviewEventText({ ...base(), title: ' 후기 이벤트 ', description: '사용 후기 \n' });
    expect(trimmed.title).toBe('후기 이벤트');
    expect(trimmed.description).toBe('사용 후기');
    expect(parseReviewEventValues(trimmed)).not.toBeNull();
  });

  it('reports each invalid field with its own reason', () => {
    expect(reviewEventFieldErrors(base(), today)).toEqual({});
    const errors = reviewEventFieldErrors({ ...base(), title: '', description: '1234567890123456789012345678901', startsOn: today,
      endsOn: '2026-12-31', announcesOn: '2026-10-29', plannedWinners: 0, creditAmount: 0, creditValidityDays: 0, targetType: 'goods' }, today);
    expect(Object.keys(errors).sort()).toEqual(['announcesOn', 'creditAmount', 'creditValidityDays', 'description', 'endsOn', 'plannedWinners', 'startsOn', 'target', 'title'].sort());
    expect(errors.title).toContain('1~15자');
    expect(errors.description).toContain('1~30자');
    expect(errors.startsOn).toContain('내일');
    expect(errors.endsOn).toContain('+1~31일');
    expect(errors.target).toContain('상품');
  });

  it('moves the end and announcement dates with the start date, staying inside their ranges', () => {
    const values = base();
    const moved = withReviewEventStartsOn(values, '2026-11-10');
    expect(moved.startsOn).toBe('2026-11-10');
    expect(moved.endsOn).toBe('2026-11-17');
    expect(moved.announcesOn).toBe('2026-11-20');
    expect(reviewEventFieldErrors(moved, today)).toEqual({});
    const broken = withReviewEventStartsOn({ ...values, endsOn: '2027-12-01', announcesOn: '2026-01-01' }, '2026-11-10');
    expect(reviewEventFieldErrors(broken, today)).toEqual({});
    expect(withReviewEventStartsOn(values, '').startsOn).toBe('');
    const ended = withReviewEventEndsOn({ ...values, announcesOn: '2026-11-30' }, '2026-11-08');
    expect(ended.announcesOn).toBe('2026-11-11');
    expect(withReviewEventEndsOn(values, '2026-11-04').announcesOn).toBe(values.announcesOn);
  });

  it('compares credit terms with the store credit policy before saving', () => {
    expect(parseReviewEventCreditPolicy({ enabled: true, maxBalance: 100000, validityDays: 30 })).toEqual({ enabled: true, maxBalance: 100000, validityDays: 30 });
    expect(parseReviewEventCreditPolicy({ enabled: false, maxBalance: null, validityDays: null })).toEqual({ enabled: false, maxBalance: null, validityDays: null });
    expect(parseReviewEventCreditPolicy({ enabled: 'yes' })).toBeNull();
    expect(reviewEventCreditPolicyLabel({ enabled: true, maxBalance: 100000, validityDays: 30 })).toBe('적립금 정책: 켜짐 · 보유 상한 100,000원 · 유효기간 30일');
    expect(reviewEventCreditPolicyLabel({ enabled: false, maxBalance: null, validityDays: null })).toBe('적립금 정책: 꺼짐');
    expect(reviewEventCreditPolicyProblem(base(), { enabled: false, maxBalance: null, validityDays: null })).toEqual({
      form: '적립금 정책이 꺼져 있어 리뷰이벤트를 저장할 수 없습니다. 설정 > 적립금 정책에서 켠 뒤 저장하세요.' });
    const policy = { enabled: true, maxBalance: 500, validityDays: 10 };
    const problem = reviewEventCreditPolicyProblem(base(), policy);
    expect(problem.creditAmount).toContain('500원');
    expect(problem.creditValidityDays).toContain('10일');
    expect(reviewEventCreditPolicyProblem({ ...base(), creditAmount: 500, creditValidityDays: 10 }, policy)).toEqual({});
    expect(reviewEventCreditPolicyProblem(base(), null)).toEqual({});
  });

  it('maps a rejected value check to the input guidance instead of a generic permission message', () => {
    expect(reviewEventError('invalid_review_event')).toContain('입력값');
    expect(reviewEventError('invalid_review_event')).not.toContain('권한');
  });
});
