import type { AdminFieldErrors } from '@/lib/admin/catalog';

/*
 * 어드민 콘솔이 공유하는 KST 시간 헬퍼 (S9 #331 정리).
 *
 * 어드민의 모든 날짜는 KST 로 읽고 쓴다. `new Date()` 의 로컬 타임존이나 UTC 를 그대로
 * 쓰면 서버가 어디서 돌든 자정 근처에서 하루가 밀리고, 해외에서 접속한 운영자가 9시간
 * 어긋난 기간을 만든다. 그 규율을 콘솔마다 각자 베껴 두면 한쪽만 고쳐지는 날이 온다.
 *
 * 여기 있는 것은 여러 콘솔이 글자 그대로 같은 구현을 들고 있던 두 가지뿐이다. 콘솔별로
 * 검증 강도나 오류 문구가 다른 변형(카탈로그·큐레이션의 kstDateTimeToIso)은 계약이
 * 달라서 합치지 않았다 — 합치려면 어느 문구가 정본인지부터 정해야 한다.
 */

const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DATE_TIME_ERROR = '날짜와 시각을 선택해주세요.';

/** KST 일자(`YYYY-MM-DD`). DB 의 일별 버킷·조회기간 경계와 같은 하루 정의다. */
const KST_DAY_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function kstDay(date: Date): string {
  return KST_DAY_FORMAT.format(date);
}

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * datetime-local 입력을 KST 로 해석해 ISO 로 옮긴다.
 *
 * 빈 칸은 오류가 아니라 `null` 이다 — 필수 여부는 부르는 폼이 정한다.
 */
export function kstDateTimeToIso(
  formData: FormData,
  key: string,
  errors: AdminFieldErrors,
): string | null {
  const raw = readString(formData, key);
  if (!raw) return null;

  const match = DATE_TIME_PATTERN.exec(raw);
  if (!match) {
    errors[key] = DATE_TIME_ERROR;
    return null;
  }

  const [, year, month, day, hour, minute] = match;
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:00+09:00`);
  if (Number.isNaN(parsed.getTime())) {
    errors[key] = DATE_TIME_ERROR;
    return null;
  }
  return parsed.toISOString();
}
