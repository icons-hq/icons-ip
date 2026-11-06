import { describe, expect, it } from 'vitest';

import { ADULT_VERIFICATION_POLICY_VERSION, adultAgeDecision } from './adult-age';

/* KST 자정은 UTC 전날 15:00이다. */
const kstMidnight = (year: number, month: number, day: number) =>
  new Date(Date.UTC(year, month - 1, day) - 9 * 60 * 60 * 1000);

describe('adultAgeDecision', () => {
  it('만 19세가 되는 해의 1월 1일 KST부터 성인으로 본다', () => {
    // 2007년 12월 31일생은 2026년 1월 1일에 만 18세지만 청소년보호법상 청소년이 아니다.
    expect(adultAgeDecision('20071231', kstMidnight(2026, 1, 1))).toBe('adult');
    expect(adultAgeDecision('20070101', kstMidnight(2026, 1, 1))).toBe('adult');
  });

  it('그 해가 오기 전에는 생일이 지났어도 청소년이다', () => {
    const lastSecondOf2025Kst = new Date(kstMidnight(2026, 1, 1).getTime() - 1000);
    expect(adultAgeDecision('20070101', lastSecondOf2025Kst)).toBe('underage');
    expect(adultAgeDecision('20080101', kstMidnight(2026, 6, 1))).toBe('underage');
  });

  it('서버 시간대가 아니라 KST 달력으로 연도를 센다', () => {
    // UTC로는 아직 2025년 12월 31일 15:00이지만 KST로는 2026년 1월 1일 0시다.
    expect(adultAgeDecision('20071231', new Date('2025-12-31T15:00:00Z'))).toBe('adult');
    expect(adultAgeDecision('20071231', new Date('2025-12-31T14:59:59Z'))).toBe('underage');
  });

  it('형식이 맞지 않거나 없는 날짜는 판정하지 않는다', () => {
    const now = kstMidnight(2026, 10, 23);
    expect(adultAgeDecision('2007-01-01', now)).toBeNull();
    expect(adultAgeDecision('20070230', now)).toBeNull();
    expect(adultAgeDecision('20071301', now)).toBeNull();
    expect(adultAgeDecision('', now)).toBeNull();
    expect(adultAgeDecision('18991231', now)).toBeNull();
  });

  it('미래 생년월일은 판정하지 않는다', () => {
    const now = kstMidnight(2026, 10, 23);
    expect(adultAgeDecision('20261024', now)).toBeNull();
    expect(adultAgeDecision('20261023', now)).toBe('underage');
  });

  it('정책 버전은 증거 제약과 같은 형식이다', () => {
    expect(ADULT_VERIFICATION_POLICY_VERSION).toMatch(/^[a-z0-9_]{1,64}@[0-9]{4}-[0-9]{2}-[0-9]{2}$/);
  });
});
