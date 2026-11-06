import { kstCalendarDate } from './minimum-age';

/*
 * 19금 굿즈의 성인 판정 (청소년 보호법 제2조 제1호).
 *
 * 법은 "청소년"을 만 19세 미만인 사람으로 정하면서 "만 19세가 되는 해의 1월 1일을
 * 맞이한 사람은 제외"한다. 그래서 이 판정은 생일이 아니라 출생 연도로 한다 — KST
 * 달력으로 올해가 출생 연도 + 19 이상이면 성인이다(2026년에는 2007년생부터).
 *
 * 입력은 휴대폰 본인확인 결과의 생년월일(YYYYMMDD)이고, 결과를 받은 그 자리에서 한
 * 번만 판정한다. 생년월일은 저장하지 않으므로 나중에 다시 계산할 수 없다 — 그래서
 * 증거에는 판정과 함께 이 정책 버전을 남긴다. 기준이 바뀌면 버전을 올린다.
 *
 * 가입 연령(minimum-age.ts)과 섞지 않는다. 그쪽은 자가신고 생년월일의 만 나이이고,
 * 여기는 본인확인 결과의 연 나이다. 어느 쪽도 다른 쪽을 대체하지 않는다.
 */

export const ADULT_AGE_YEARS = 19;

export const ADULT_VERIFICATION_POLICY_VERSION = 'adult_19_youth_protection_act@2026-10-23';

export type AdultAgeDecision = 'adult' | 'underage';

const COMPACT_DATE = /^(\d{4})(\d{2})(\d{2})$/;

/**
 * 판정할 수 없는 입력(형식 오류·없는 날짜·미래 날짜·1900년 이전)은 `null`이다. 호출자는
 * 이를 본인확인 결과 오류로 다룬다 — 나이를 모르는 상태를 성인으로도 미성년으로도
 * 승격하지 않는다.
 */
export function adultAgeDecision(birthDay: string, now: Date = new Date()): AdultAgeDecision | null {
  const match = COMPACT_DATE.exec(birthDay);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 1900
    || probe.getUTCFullYear() !== year
    || probe.getUTCMonth() + 1 !== month
    || probe.getUTCDate() !== day
  ) {
    return null;
  }

  const today = kstCalendarDate(now);
  const isFuture = year > today.year
    || (year === today.year && (month > today.month || (month === today.month && day > today.day)));
  if (isFuture) return null;

  return today.year - year >= ADULT_AGE_YEARS ? 'adult' : 'underage';
}
