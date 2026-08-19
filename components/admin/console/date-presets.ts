/**
 * 콘솔 조회기간 프리셋 계산.
 *
 * 판매관리·클레임·문의·리뷰 콘솔은 모두 "오늘 / 1주 / 1개월 / 3개월 + 직접 입력" 형태의
 * 기간 필터를 공유한다. 여기 있는 함수는 전부 순수 함수이며, 서버 컴포넌트에서 링크 href를
 * 만들 때 호출한다.
 *
 * 기준 시간대는 항상 KST다. `new Date()`의 로컬 타임존이나 UTC를 그대로 쓰면 서버가
 * 어디서 돌든 자정 근처에서 하루가 밀린다. `lib/admin/insights.server.ts`와 같은
 * `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' })` 관용구로 KST 날짜를 뽑는다.
 */

export const CONSOLE_DATE_PRESET_IDS = ['today', 'week', 'month', 'quarter'] as const;
export type ConsoleDatePresetId = (typeof CONSOLE_DATE_PRESET_IDS)[number];

/** 프리셋 버튼 문구. 스마트스토어 판매자센터 조회기간 칩과 같은 축약 표기를 쓴다. */
export const CONSOLE_DATE_PRESET_LABELS: Record<ConsoleDatePresetId, string> = {
  today: '오늘',
  week: '1주',
  month: '1개월',
  quarter: '3개월',
};

/** `YYYY-MM-DD` 두 개로 표현한 조회기간. 양끝 모두 포함(inclusive)이다. */
export interface ConsoleDateRange {
  from: string;
  to: string;
}

export interface ConsoleDatePreset {
  id: ConsoleDatePresetId;
  label: string;
  range: ConsoleDateRange;
}

const KST_DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function formatDay(year: number, month: number, day: number) {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

function parseDay(day: string) {
  const match = DAY_PATTERN.exec(day);
  if (!match) throw new RangeError(`KST 날짜 형식이 아닙니다: ${day}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** 오늘(KST)의 `YYYY-MM-DD`. `now`는 테스트에서 기준 시각을 주입하려고 열어 둔다. */
export function kstToday(now: Date = new Date()): string {
  return KST_DAY_FORMAT.format(now);
}

/**
 * `YYYY-MM-DD`에 일 단위를 더한다.
 *
 * 계산은 전부 UTC 필드로 한다. 로컬 타임존 생성자(`new Date(y, m, d)`)를 쓰면 서버
 * 타임존과 DST가 개입해 월말·연말 경계에서 하루가 어긋난다.
 */
export function shiftKstDay(day: string, days: number): string {
  const parsed = parseDay(day);
  const shifted = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  return formatDay(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
}

/**
 * `YYYY-MM-DD`에 월 단위를 더한다.
 *
 * 대상 월에 없는 날짜(3월 31일의 한 달 전 = 2월 31일)는 그 달의 말일로 당긴다. 당기지
 * 않으면 Date가 다음 달로 넘겨버려 "1개월 전"이 3월 3일이 되는 사고가 난다.
 */
export function shiftKstMonth(day: string, months: number): string {
  const parsed = parseDay(day);
  const monthIndex = parsed.month - 1 + months;
  const targetYear = parsed.year + Math.floor(monthIndex / 12);
  const targetMonth = ((monthIndex % 12) + 12) % 12;
  /* Date.UTC(year, month + 1, 0)은 해당 월의 말일이다. */
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return formatDay(targetYear, targetMonth + 1, Math.min(parsed.day, lastDay));
}

/**
 * 프리셋 한 개의 조회기간.
 *
 * - `today` — 오늘 하루
 * - `week` — 오늘 포함 최근 7일
 * - `month` / `quarter` — 1개월·3개월 전 같은 날짜부터 오늘까지(말일 보정 포함)
 */
export function consoleDatePresetRange(
  preset: ConsoleDatePresetId,
  now: Date = new Date(),
): ConsoleDateRange {
  const today = kstToday(now);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'week':
      return { from: shiftKstDay(today, -6), to: today };
    case 'month':
      return { from: shiftKstMonth(today, -1), to: today };
    case 'quarter':
      return { from: shiftKstMonth(today, -3), to: today };
  }
}

/** 프리셋 목록. `ConsoleFilterPanel`이 링크를 그릴 때 쓴다. */
export function consoleDatePresets(
  presets: readonly ConsoleDatePresetId[] = CONSOLE_DATE_PRESET_IDS,
  now: Date = new Date(),
): ConsoleDatePreset[] {
  return presets.map((id) => ({
    id,
    label: CONSOLE_DATE_PRESET_LABELS[id],
    range: consoleDatePresetRange(id, now),
  }));
}

/** 현재 필터 값이 이 프리셋과 정확히 같은지. 활성 칩 표시에 쓴다. */
export function isConsoleDateRangeActive(
  range: ConsoleDateRange,
  current: { from?: string | null; to?: string | null } | null | undefined,
): boolean {
  return Boolean(current) && current?.from === range.from && current?.to === range.to;
}
