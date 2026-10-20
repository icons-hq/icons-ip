import { describe, expect, it } from 'vitest';
import { adminSalesTrend, adminStatsChange, adminStatsComparisonFilters, adminStatsComparisonLabel, adminStatsComparisonMode, adminStatsFilterRange, adminStatsHref, adminStatsPreviousFilters, normalizeAdminStatsFilters } from './stats';

describe('판매자 리포트 기간과 집계', () => {
  it('직접 지정일 양끝을 KST 일자로 포함한다', () => {
    const filters = normalizeAdminStatsFilters({ from: '2026-10-01', to: '2026-10-12', compare: 'previous', bucket: 'week', ip: 'test' });
    expect(adminStatsFilterRange(filters)).toEqual({ from: '2026-09-30T15:00:00.000Z', to: '2026-10-12T15:00:00.000Z' });
    expect(adminStatsPreviousFilters(filters)).toMatchObject({ from: '2026-09-19', to: '2026-09-30', compare: false });
    expect(adminStatsHref('/report', filters)).toBe('/report?ip=test&from=2026-10-01&to=2026-10-12&compare=previous&bucket=week');
  });
  it.each([
    { from: '2026-02-30', to: '2026-03-01' }, { from: '2026-10-13', to: '2026-10-12' },
    { from: '2025-01-01', to: '2026-01-02' }, { from: '2026-01-01' },
  ])('잘못된 기간을 다른 범위로 조용히 조회하지 않는다: %j', params => {
    const filters = normalizeAdminStatsFilters(params);
    expect(filters.rangeError).toBeTruthy();
    expect(() => adminStatsFilterRange(filters)).toThrow('시작일과 종료일');
  });
  it('윤년 366일은 허용하고 주별 객단가는 주문수로 가중한다', () => {
    expect(normalizeAdminStatsFilters({ from: '2024-01-01', to: '2024-12-31' }).rangeError).toBeUndefined();
    const filters = normalizeAdminStatsFilters({ from: '2026-10-05', to: '2026-10-12', bucket: 'week' });
    expect(adminSalesTrend([
      { date: '2026-10-05', orderCount: 1, revenue: 1000, averageOrderValue: 1000 },
      { date: '2026-10-06', orderCount: 3, revenue: 9000, averageOrderValue: 3000 },
    ], filters)).toEqual([
      { date: '2026-10-05', orderCount: 4, revenue: 10000, averageOrderValue: 2500 },
      { date: '2026-10-12', orderCount: 0, revenue: 0, averageOrderValue: 0 },
    ]);
  });
  it('비교기간 실적이 없으면 무한 증가율을 만들지 않는다', () => {
    expect(adminStatsChange(100, 0)).toBe('비교기간 실적 없음');
    expect(adminStatsChange(0, 0)).toBe('변동 없음');
    expect(adminStatsChange(125, 100)).toBe('+25.0%');
  });
  it.each([
    ['2024-02-29', '2024-02-29', '2023-02-28', '2023-02-28', 1, 1],
    ['2024-02-28', '2024-03-01', '2023-02-28', '2023-03-01', 3, 2],
    ['2025-02-28', '2025-03-01', '2024-02-28', '2024-03-01', 2, 3],
    ['2024-01-01', '2024-12-31', '2023-01-01', '2023-12-31', 366, 365],
    ['2025-02-28', '2026-02-28', '2024-02-28', '2025-02-28', 366, 367],
  ])('전년 양끝 날짜를 유지하고 2/29만 보정한다: %s~%s', (from, to, expectedFrom, expectedTo, days, comparisonDays) => {
    const filters = normalizeAdminStatsFilters({ from, to, compare: 'year', bucket: 'month', ip: 'year-ip' });
    expect(filters.rangeError).toBeUndefined();
    const comparison = adminStatsComparisonFilters(filters)!;
    expect(comparison).toMatchObject({ from: expectedFrom, to: expectedTo, compare: false, comparisonMode: 'none', bucket: 'month', ipId: 'year-ip' });
    const range = adminStatsFilterRange(filters);
    const comparisonRange = adminStatsFilterRange(comparison);
    expect((Date.parse(range.to) - Date.parse(range.from)) / 86400000).toBe(days);
    expect((Date.parse(comparisonRange.to) - Date.parse(comparisonRange.from)) / 86400000).toBe(comparisonDays);
    expect(adminStatsComparisonFilters(comparison)).toBeNull();
  });
  it('윤일 하루를 전년 2/28의 KST 자정부터 다음 자정까지 조회한다', () => {
    const filters = normalizeAdminStatsFilters({ from: '2024-02-29', to: '2024-02-29', compare: 'year' });
    expect(adminStatsFilterRange(adminStatsComparisonFilters(filters)!)).toEqual({ from: '2023-02-27T15:00:00.000Z', to: '2023-02-28T15:00:00.000Z' });
  });
  it('빠른 기간 전년 비교는 전달된 조회시각의 KST 날짜를 사용한다', () => {
    const filters = normalizeAdminStatsFilters({ days: '7', compare: 'year' });
    expect(adminStatsComparisonFilters(filters, new Date('2024-03-01T14:59:59Z'))).toMatchObject({ from: '2023-02-24', to: '2023-03-01' });
    expect(adminStatsComparisonFilters(filters, new Date('2024-03-01T15:00:00Z'))).toMatchObject({ from: '2023-02-25', to: '2023-03-02' });
  });
  it('기존 boolean·previous 링크와 전년 URL을 구분하고 비교 없음은 조회하지 않는다', () => {
    const legacy = { days: 7 as const, ipId: '', compare: true };
    expect(adminStatsComparisonMode(legacy)).toBe('previous');
    expect(adminStatsComparisonLabel(legacy)).toBe('직전 동일 기간 비교');
    expect(adminStatsHref('/stats', legacy)).toBe('/stats?days=7&compare=previous');
    expect(normalizeAdminStatsFilters({ compare: 'true' })).toMatchObject({ compare: true, comparisonMode: 'previous' });
    const yearly = normalizeAdminStatsFilters({ from: '2024-02-28', to: '2024-03-01', compare: 'year', bucket: 'week', ip: 'sample' });
    expect(adminStatsHref('/stats', yearly)).toBe('/stats?ip=sample&from=2024-02-28&to=2024-03-01&compare=year&bucket=week');
    expect(adminStatsComparisonLabel(yearly)).toBe('전년 동일 날짜 비교');
    expect(adminStatsComparisonFilters({ ...yearly, compare: false })).toBeNull();
    expect(adminStatsHref('/stats', { ...yearly, compare: false })).not.toContain('compare=');
    for (const compare of ['none', 'false', 'unknown', '']) {
      expect(adminStatsComparisonFilters(normalizeAdminStatsFilters({ compare }))).toBeNull();
    }
  });
  it('전년 비교도 조회기간 366일 제한과 잘못된 날짜 거부를 유지한다', () => {
    const filters = normalizeAdminStatsFilters({ from: '2024-01-01', to: '2025-01-01', compare: 'year' });
    expect(filters.rangeError).toContain('366');
    expect(() => adminStatsComparisonFilters(filters)).toThrow('366');
  });
});
