import { describe, expect, it } from 'vitest';
import {
  compareDelta,
  normalizeStatsAnalysisFilters,
  statsAnalysisHref,
  type StatsAnalysisFilters,
  type StatsTimeseriesRow,
} from './stats-analysis';

const DEFAULTS: StatsAnalysisFilters = {
  days: 30, unit: 'day', compare: 'none', axis: 'payment_method', rank: 'sales', ipId: '',
};

function row(net: number): StatsTimeseriesRow {
  return { bucket: '2026-09-01', gross: net, refunds: 0, net, orderCount: 1 };
}

describe('판매 분석 필터', () => {
  it('모르는 값은 기본값으로 접는다', () => {
    expect(normalizeStatsAnalysisFilters({
      days: '13', unit: '분기', compare: '작년', axis: '없는축', rank: '아무거나',
    })).toEqual(DEFAULTS);
  });

  it('아는 값은 그대로 받는다', () => {
    expect(normalizeStatsAnalysisFilters({
      days: '365', unit: 'month', compare: 'previous_year', axis: 'region', rank: 'claims', ip: ' rilakkuma ',
    })).toEqual({
      days: 365, unit: 'month', compare: 'previous_year', axis: 'region', rank: 'claims', ipId: 'rilakkuma',
    });
  });

  it('기본값은 주소에 싣지 않는다 — 링크가 뜻을 잃지 않게', () => {
    expect(statsAnalysisHref(DEFAULTS)).toBe('/admin/stats/analysis');
    expect(statsAnalysisHref(DEFAULTS, { axis: 'region' })).toBe('/admin/stats/analysis?axis=region');
    expect(statsAnalysisHref({ ...DEFAULTS, days: 7 }, { unit: 'week' }))
      .toBe('/admin/stats/analysis?days=7&unit=week');
  });
});

describe('비교 구간 증감', () => {
  it('비교가 없으면 null 이다', () => {
    expect(compareDelta([row(100)], null)).toBeNull();
  });

  it('두 구간의 순매출 합을 견준다', () => {
    expect(compareDelta([row(100), row(50)], [row(100)])).toEqual({
      current: 150, previous: 100, ratio: 0.5,
    });
  });

  it('기준이 0이면 증감률을 지어내지 않는다', () => {
    /* 0 대비 증가율은 무한대다. 화면에 「+∞%」를 그리느니 비율을 안 준다. */
    expect(compareDelta([row(100)], [])).toEqual({ current: 100, previous: 0, ratio: null });
  });
});
