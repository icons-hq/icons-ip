import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { StatsRangeTabs } from './StatsRangeTabs';
import { StatsComparison } from './StatsComparison';
import { normalizeAdminStatsFilters } from '@/lib/admin/stats';
afterEach(() => vi.useRealTimers());
it('조회 중 KST 자정이 지나도 화면·다운로드·비교 기간을 같은 시각에 고정한다', () => {
  const queriedAt = new Date('2026-10-12T14:59:59Z');
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-12T15:00:01Z'));
  const filters = normalizeAdminStatsFilters({ days: '7', compare: 'previous' });
  const html = renderToStaticMarkup(createElement(StatsRangeTabs, { base: '/admin/stats/sales', filters, now: queriedAt }));
  expect(html).toContain('value="2026-10-06"'); expect(html).toContain('value="2026-10-12"');
  expect(html).toContain('from=2026-10-06'); expect(html).toContain('to=2026-10-12'); expect(html).not.toContain('to=2026-10-13');
  const comparison = renderToStaticMarkup(createElement(StatsComparison, { filters, rows: [], now: queriedAt }));
  expect(comparison).toContain('2026-09-29'); expect(comparison).toContain('2026-10-05');
});
it('전년 선택·비교 이름·실제 날짜·같은 조건의 다운로드를 함께 표시한다', () => {
  const filters = normalizeAdminStatsFilters({ from: '2024-02-29', to: '2024-02-29', compare: 'year', bucket: 'week', ip: 'sample' });
  const html = renderToStaticMarkup(createElement(StatsRangeTabs, { base: '/admin/stats/sales', filters }));
  expect(html).toContain('<option value="none">비교 없음</option>');
  expect(html).toContain('<option value="previous">직전 동일 기간</option>');
  expect(html).toContain('<option value="year" selected="">전년 동일 날짜</option>');
  expect(html).toContain('2월 29일은 2월 28일');
  expect(html).toContain('비교기간의 일수가 달라질 수');
  expect(html).toContain('from=2024-02-29'); expect(html).toContain('to=2024-02-29');
  expect(html).toContain('compare=year'); expect(html).toContain('bucket=week'); expect(html).toContain('ip=sample');
  const comparison = renderToStaticMarkup(createElement(StatsComparison, { filters, rows: [{ label: '매출', current: 2000, previous: 1000, unit: '원' }] }));
  expect(comparison).toContain('aria-label="전년 동일 날짜 비교"');
  expect(comparison).toContain('2023-02-28 ~ 2023-02-28'); expect(comparison).toContain('+100.0%');
});
it('비교를 끄면 이전 비교 데이터가 전달돼도 결과를 표시하지 않는다', () => {
  const filters = normalizeAdminStatsFilters({ compare: 'none' });
  expect(renderToStaticMarkup(createElement(StatsComparison, { filters, rows: [{ label: '매출', current: 2000, previous: 1000 }] }))).toBe('');
});
