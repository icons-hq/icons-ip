import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminInsights } from '@/lib/admin/insights.server';
import { OverviewSection } from './Overview';

vi.mock('@/components/ui/Icon', () => ({ Icon: () => null }));

const insights: AdminInsights = {
  revenue: { current: 690000, previous: 400000 },
  paymentCount: { current: 12, previous: 9 },
  avgPayment: { current: 57500, previous: 44444 },
  signupCount: { current: 8, previous: 5 },
  dailyRevenue: [{ date: '2026-08-18', goods: 690000, tickets: 0 }],
  pipeline: [{ status: 'paid', count: 3 }],
  recentOrders: [],
  topIps: [],
};

describe('OverviewSection', () => {
  it('한눈에 보는 지표 카드를 그대로 유지한다', () => {
    const html = renderToStaticMarkup(<OverviewSection insights={insights} reports={[]} />);

    expect(html).toContain('30일 매출');
    expect(html).toContain('30일 신규 가입');
  });

  /*
   * 대시보드는 "지금 어떤가"를 보는 자리로 남기고, 같은 지표를 기간·축으로
   * 파고드는 일은 통계 리포트가 맡는다(#258). 링크가 없으면 운영자가 여기서
   * 더 깊이 보려다 못 찾는다.
   */
  it('세 통계 리포트로 가는 길을 연다', () => {
    const html = renderToStaticMarkup(<OverviewSection insights={insights} reports={[]} />);

    expect(html).toContain('href="/admin/stats/sales"');
    expect(html).toContain('href="/admin/stats/claims"');
    expect(html).toContain('href="/admin/stats/customers"');
  });
});
