import Link from 'next/link';
import type { AdminInsights } from '@/lib/admin/insights.server';
import type { AdminReportRecord } from '@/lib/admin/moderation.server';
import { Icon } from '@/components/ui/Icon';
import { MetricCard } from '../MetricCard';
import { RecentOrders } from '../RecentOrders';
import { TopIps } from '../TopIps';
import { OrderPipeline } from '../charts/OrderPipeline';
import { RevenueTrend } from '../charts/RevenueTrend';
import { formatKrw, metricChange } from '../format';
import { reportTargetLabels } from './Moderation';

export function OverviewSection({
  insights,
  reports,
}: {
  insights: AdminInsights;
  reports: AdminReportRecord[];
}) {
  const recent = reports.slice(0, 5);

  return (
    <section className="col" style={{ gap: 16 }}>
      <div className="admin-metric-grid">
        <MetricCard
          icon="spark"
          label="30일 매출"
          value={formatKrw(insights.revenue.current)}
          {...metricChange(insights.revenue)}
        />
        <MetricCard
          icon="bag"
          label="30일 결제 건수"
          value={`${insights.paymentCount.current.toLocaleString('ko-KR')}건`}
          {...metricChange(insights.paymentCount)}
        />
        <MetricCard
          icon="bolt"
          label="평균 결제액"
          value={formatKrw(insights.avgPayment.current)}
          {...metricChange(insights.avgPayment)}
        />
        <MetricCard
          icon="user"
          label="30일 신규 가입"
          value={`${insights.signupCount.current.toLocaleString('ko-KR')}명`}
          {...metricChange(insights.signupCount)}
        />
      </div>

      <div className="admin-overview-charts">
        <RevenueTrend data={insights.dailyRevenue} />
        <OrderPipeline stages={insights.pipeline} />
      </div>

      {/*
        이 대시보드는 "지금 어떤가"를 한눈에 보는 자리로 남긴다(#258). 같은 지표를
        기간·축을 바꿔 파고드는 일은 통계 리포트가 맡으므로, 겹치는 카드 바로 아래에
        그 길을 열어 둔다 — 링크가 없으면 운영자가 여기서 더 깊이 보려다 못 찾는다.
      */}
      <nav aria-label="상세 리포트" className="admin-overview-reports">
        <span className="muted">더 자세히 보기</span>
        <Link className="btn btn-sm btn-ghost" href="/admin/stats/sales">
          판매분석 <Icon name="arrow" size={14} />
        </Link>
        <Link className="btn btn-sm btn-ghost" href="/admin/stats/claims">
          클레임 <Icon name="arrow" size={14} />
        </Link>
        <Link className="btn btn-sm btn-ghost" href="/admin/stats/customers">
          고객현황 <Icon name="arrow" size={14} />
        </Link>
      </nav>

      <div className="admin-overview-bottom">
        <RecentOrders orders={insights.recentOrders} />
        <TopIps ips={insights.topIps} />
      </div>

      <div className="card col" style={{ borderRadius: 10, padding: 18 }}>
        <div className="between" style={{ marginBottom: 8 }}>
          <div>
            <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>최근 신고</h2>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>커뮤니티 신고 최신 5건</div>
          </div>
          <Link className="btn btn-sm btn-ghost" href="/admin/community/moderation">
            모두 보기 <Icon name="arrow" size={14} />
          </Link>
        </div>
        {recent.map((report) => (
          <div key={report.id} className="between" style={{ borderTop: '1px solid var(--line)', gap: 12, padding: '11px 0' }}>
            <div className="col" style={{ gap: 3, minWidth: 0 }}>
              <strong style={{ fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {report.targetLabel}
              </strong>
              <span className="faint mono" style={{ fontSize: 11 }}>
                {reportTargetLabels[report.targetType]} · 신고자 @{report.reporterName} ·{' '}
                {new Date(report.createdAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}
              </span>
            </div>
            <span className="tag" style={{ color: 'var(--violet-2)' }}>{report.status}</span>
          </div>
        ))}
        {!recent.length && (
          <p className="muted" style={{ fontSize: 13, margin: '8px 0 2px' }}>접수된 신고가 없습니다.</p>
        )}
      </div>
    </section>
  );
}
