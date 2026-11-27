import { formatOrderDateTime } from '@/lib/orders';

/**
 * 표 칸의 날짜와 시각. 한 줄('2026. 11. 26. 15:55')로 쓰면 칸이 그만큼 넓어져 표가 틀보다 커지고 오른쪽 열이 가로 스크롤 밖으로 밀리므로(F-09·F-18),
 * 날짜와 시각을 두 줄로 나눠 보인다. 시각이 없는 값이나 형식을 읽지 못한 값은 한 줄 그대로 둔다.
 */
export function ClaimDateTimeCell({ value }: { value: string }) {
  const text = formatOrderDateTime(value);
  const parts = /^(.*\S)\s+(\d{1,2}:\d{2})$/.exec(text);
  return parts
    ? <span className="flex flex-col tabular-nums" data-date-time=""><span>{parts[1]}</span><span className="text-xs text-muted-foreground">{parts[2]}</span></span>
    : <span className="tabular-nums">{text}</span>;
}
