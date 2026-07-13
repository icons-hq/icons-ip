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
  onOpenModeration,
  reports,
}: {
  insights: AdminInsights;
  onOpenModeration: () => void;
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
          <button className="btn btn-sm btn-ghost" onClick={onOpenModeration} type="button">
            모두 보기 <Icon name="arrow" size={14} />
          </button>
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
