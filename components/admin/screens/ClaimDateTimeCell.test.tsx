import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ClaimDateTimeCell } from './ClaimDateTimeCell';

/* 표 칸의 날짜와 시각을 두 줄로 나눈다(F-09·F-18) — 한 줄이면 칸이 넓어져 표가 틀보다 커진다. */
it('날짜와 시각을 한국 시간 기준으로 두 줄에 나눠 보인다', () => {
  const html = renderToStaticMarkup(<ClaimDateTimeCell value="2026-11-26T06:55:00Z" />);
  expect(html).toContain('<span>2026. 11. 26.</span>');
  expect(html).toMatch(/<span class="text-xs text-muted-foreground">15:55<\/span>/);
  expect(html).toContain('data-date-time=""');
});
it('읽을 수 없는 값은 빈 칸으로 둔다', () => {
  expect(renderToStaticMarkup(<ClaimDateTimeCell value="not a date" />)).toBe('<span class="tabular-nums"></span>');
});
