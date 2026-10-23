import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { trafficFilters, type NoticeTrafficReport, type TrafficMetrics, type TrafficReport } from '@/lib/admin/store-analytics';
import { StatsTrafficScreen } from './StatsTrafficScreen';

const metrics: TrafficMetrics = { pageViews: 3, productViews: 1, sessions: 2, linkLandings: 0, orders: 0, convertedSessions: 0, conversionRate: 0, grossAmount: 0, refundAmount: 0, netAmount: 0 };
const coverage = { days: 1, observed_days: 0, partial_days: 1, missing_days: 0, archived_days: 0, observed_minutes: 10, expected_minutes: 10, observed_until: null };
const report: TrafficReport = {
  from: '2026-10-23', to: '2026-10-23', comparisonFrom: null, comparisonTo: null, dimension: 'channel', selectedKey: null, selectedLabel: null,
  summary: metrics, comparison: null, coverage, comparisonCoverage: null, trend: [], comparisonTrend: [], rows: [], total: 0,
  collection: { enabled: true, startedAt: '2026-10-01T00:00:00Z', noticeVersion: 'analytics-v1', lastHeartbeatAt: null, rawRetentionDays: 90, aggregateRetentionMonths: 13, retentionBacklog: 0 },
  observedAt: '2026-10-23T03:00:00Z', advertisingCost: null, roas: null,
};
const notices: NoticeTrafficReport = {
  from: '2026-10-23', to: '2026-10-23', observedAt: '2026-10-23T03:00:00Z',
  rows: [
    { curationId: '11111111-1111-4111-8111-111111111111', placement: 'notice_bar', title: '이용약관 개정 안내', impressions: 1200, clicks: 36, impressionSessions: 900, clickSessions: 30, clickRate: 3 },
    { curationId: '22222222-2222-4222-8222-222222222222', placement: 'notice_strip', title: null, impressions: 0, clicks: 0, impressionSessions: 0, clickSessions: 0, clickRate: null },
  ],
};
const filters = trafficFilters({ from: '2026-10-23', to: '2026-10-23' }, false, new Date('2026-10-23T03:00:00Z'));

describe('방문·유입 분석의 상단 공지 노출·클릭', () => {
  it('공지별 노출·클릭·세션·클릭률을 같은 기간 표로 보이고 삭제된 공지를 이름으로 숨기지 않는다', () => {
    const html = renderToStaticMarkup(<StatsTrafficScreen filters={filters} noticeReport={notices} report={report} />);
    expect(html).toContain('상단 공지 노출·클릭');
    expect(html).toContain('이용약관 개정 안내');
    expect(html).toContain('텍스트 공지 바');
    expect(html).toContain('상단 띠배너');
    expect(html).toContain('1,200');
    expect(html).toContain('3%');
    expect(html).toContain('삭제된 공지');
    expect(html).toContain('계산 불가');
    expect(html).toContain('클릭은 같은 방문에서 노출된 뒤에만 셉니다');
  });

  it('집계가 없으면 빈 상태를, 읽기 실패면 화면 전체가 아니라 이 표만 실패를 알린다', () => {
    expect(renderToStaticMarkup(<StatsTrafficScreen filters={filters} noticeReport={{ ...notices, rows: [] }} report={report} />))
      .toContain('이 기간에 집계된 공지 노출이 없습니다.');
    const failed = renderToStaticMarkup(<StatsTrafficScreen filters={filters} noticeReport={null} report={report} />);
    expect(failed).toContain('공지 노출·클릭 집계를 불러오지 못했습니다.');
    expect(failed).toContain('방문·유입 분석');
  });

  it('마케팅 링크 성과 화면에는 공지 표를 두지 않는다', () => {
    const marketing = trafficFilters({ from: '2026-10-23', to: '2026-10-23' }, true, new Date('2026-10-23T03:00:00Z'));
    expect(renderToStaticMarkup(<StatsTrafficScreen filters={marketing} marketing noticeReport={notices} report={{ ...report, dimension: 'link' }} />))
      .not.toContain('상단 공지 노출·클릭');
  });
});
