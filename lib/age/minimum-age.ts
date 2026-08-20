/*
 * v1 가입 최소 연령 판정 (ADR-0009).
 *
 * 앱 폼, DB 트리거, 법정 문서 문구가 같은 기준을 써야 한 곳만 바뀌는 상태가
 * 생기지 않는다. 이 파일이 앱 쪽 진실원이고, DB 쪽은 같은 규칙을 Postgres
 * `age()`로 구현한다 — 두 구현이 윤년·경계일에서 같은 답을 낸다는 것을
 * migration의 회귀 테스트가 고정한다.
 *
 * 이 판정은 `minimum_age_14` purpose 하나만 담당한다. 19+ 성인 상품 접근은
 * NICE 본인확인 증거(`adult_19`, #210)로 별도 관리하며, 여기서 계산한 생년월일
 * 기반 나이를 성인인증으로 승격하지 않는다.
 */

/** 만 나이 판정의 기준 시간대. 이용자가 자기 달력으로 이해하는 날짜와 어긋나면 안 된다. */
export const AGE_POLICY_TIMEZONE = 'Asia/Seoul';

/** v1 가입 기준. 만 14세 미만의 법정대리인 동의 경로는 제공하지 않는다(ADR-0009). */
export const MINIMUM_SIGNUP_AGE = 14;

/** 증거에 남기는 정책 식별자. 기준이 바뀌면 버전을 올려 과거 판정과 구분한다. */
export const MINIMUM_AGE_POLICY_VERSION = 'minimum_age_14@2026-08-22';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

/** KST 달력 기준의 연·월·일. 서버가 어느 타임존에서 돌든 같은 답을 낸다. */
function kstCalendarDate(instant: Date): CalendarDate {
  const shifted = new Date(instant.getTime() + KST_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** 실제로 존재하는 날짜만 통과시킨다. 2월 30일 같은 값은 판정 대상이 아니다. */
function parseBirthDate(value: string): CalendarDate | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;

  const [, rawYear, rawMonth, rawDay] = match;
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  const probe = new Date(Date.UTC(year, month - 1, day));

  if (
    probe.getUTCFullYear() !== year
    || probe.getUTCMonth() + 1 !== month
    || probe.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

/**
 * 한국식 만 나이. 생일이 지나야 한 살 오른다.
 *
 * 2월 29일생은 평년에 생일이 없어 3월 1일에 도래한다 — 월·일 비교가 그 규칙을
 * 그대로 만든다. 2월 28일에 도래시키면 미성년을 하루 먼저 통과시키게 된다.
 *
 * 형식이 잘못된 값은 판정할 수 없으므로 `null`이다. 호출자가 이를 "나이 미상"
 * 으로 다루게 해서, 0이나 -1 같은 숫자가 조용히 비교에 쓰이지 않게 한다.
 */
export function koreanAge(birthDate: string, now: Date = new Date()): number | null {
  const birth = parseBirthDate(birthDate);
  if (!birth) return null;

  const today = kstCalendarDate(now);
  const beforeBirthday =
    today.month < birth.month || (today.month === birth.month && today.day < birth.day);

  return today.year - birth.year - (beforeBirthday ? 1 : 0);
}

/**
 * 가입 기준 충족 여부. 판정할 수 없는 입력은 거부한다 — 나이를 모르는 상태를
 * 통과로 처리하면 게이트가 형식 오류 하나로 열린다.
 */
export function meetsMinimumSignupAge(birthDate: string, now: Date = new Date()): boolean {
  const age = koreanAge(birthDate, now);
  return age !== null && age >= MINIMUM_SIGNUP_AGE;
}
