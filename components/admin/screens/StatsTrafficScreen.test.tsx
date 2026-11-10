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

describe('두 화면의 구분', () => {
  it('조회 기간이 프리셋과 같으면 현재로 표시하고, 마케팅 링크 성과는 링크 유입을 앞에 세운다', () => {
    const now = new Date('2026-10-23T03:00:00Z');
    const seven = trafficFilters({ days: '7' }, true, now);
    const html = renderToStaticMarkup(<StatsTrafficScreen filters={seven} marketing now={now} report={{ ...report, dimension: 'link' }} />);
    expect(html).toMatch(/<a aria-current="true"[^>]*>최근 7일<\/a>/);
    expect(html.indexOf('>링크 유입<')).toBeLessThan(html.indexOf('>방문 세션<'));
    const traffic = renderToStaticMarkup(<StatsTrafficScreen filters={filters} now={now} report={report} />);
    expect(traffic).not.toContain('>링크 유입</span>');
  });
});

describe('요약 카드의 증감 색', () => {
  const compared: TrafficMetrics = { ...metrics, sessions: 100, productViews: 90, orders: 10, conversionRate: 2, grossAmount: 1000, netAmount: 950 };
  const current: TrafficMetrics = { ...metrics, sessions: 90, productViews: 85, orders: 9, conversionRate: 1.9, grossAmount: 500, netAmount: 480 };

  /* 크기로 한 칸만 고르면 같은 하락인데 색이 달라 규칙 없이 보인다 — 색은 방향만 본다. */
  it('줄어든 칸은 크기와 상관없이 모두 ▼ 위험색이다', () => {
    const html = renderToStaticMarkup(<StatsTrafficScreen filters={filters} report={{ ...report, summary: current, comparison: compared }} />);
    expect(html.match(/data-tone="danger"/g)).toHaveLength(6);
    expect(html).toMatch(/data-tone="danger"[^>]*><span aria-hidden="true"[^>]*>▼<\/span>-50\.0%/);
    expect(html).toContain('환불 차감 후 금액');
    expect(html).not.toContain('>환불 차감금액<');
  });

  it('늘어난 칸은 ▲ 성공색, 그대로인 칸은 회색이다', () => {
    const html = renderToStaticMarkup(<StatsTrafficScreen filters={filters} report={{ ...report, summary: { ...compared, sessions: 120 }, comparison: compared }} />);
    expect(html).toMatch(/data-tone="success"[^>]*><span aria-hidden="true"[^>]*>▲<\/span>\+20\.0%/);
    expect(html.match(/>▲</g)).toHaveLength(1);
    expect(html.match(/>–</g)).toHaveLength(5);
    expect(html).not.toContain('>▼<');
    expect(html).not.toContain('data-tone="danger"');
  });

  it('요약 카드의 금액은 판매분석과 같은 ₩ 표기이고 미측정은 그대로 말한다', () => {
    const html = renderToStaticMarkup(<StatsTrafficScreen filters={filters} report={{ ...report, summary: { ...current, netAmount: null as never }, comparison: compared }} />);
    expect(html).toContain('₩500');
    expect(html).toContain('비교 ₩1,000');
    expect(html).toContain('미측정');
  });

  it('표의 방문 증감 열도 같은 규칙이고 줄마다 배지가 반복되지 않게 글자로 그린다', () => {
    const row = (key: string, sessions: number) => ({ key, label: key, metrics: { ...metrics, sessions }, comparison: { ...metrics, sessions: 100 }, archived: false, observedUntil: null });
    const html = renderToStaticMarkup(<StatsTrafficScreen filters={filters} report={{ ...report, rows: [row('up', 191), row('down', 93), row('same', 100)], total: 3 }} />);
    expect(html).toMatch(/<span class="[^"]*text-success[^"]*" data-tone="success"><span aria-hidden="true"[^>]*>▲<\/span>\+91<\/span>/);
    expect(html).toMatch(/<span class="[^"]*text-destructive[^"]*" data-tone="danger"><span aria-hidden="true"[^>]*>▼<\/span>-7<\/span>/);
    expect(html).toMatch(/<span class="[^"]*text-muted-foreground[^"]*" data-tone="neutral"><span aria-hidden="true"[^>]*>–<\/span>0<\/span>/);
  });
});

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
