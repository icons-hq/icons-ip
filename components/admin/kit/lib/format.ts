/**
 * ICONS: 날짜는 운영팀 표기(ko-KR 숫자 날짜, `2026. 10. 30.`)로 쓴다. Dice UI 원본은 en-US 긴 날짜
 * (`October 30, 2026`)다. 값은 달력 칸의 브라우저 자정이라 시간대를 따로 지정하지 않는다.
 */
export function formatDate(
  date: Date | string | number | undefined,
  opts: Intl.DateTimeFormatOptions = {},
) {
  if (!date) return "";

  try {
    return new Intl.DateTimeFormat("ko-KR", {
      month: opts.month ?? "2-digit",
      day: opts.day ?? "2-digit",
      year: opts.year ?? "numeric",
      ...opts,
    }).format(new Date(date));
  } catch {
    return "";
  }
}
