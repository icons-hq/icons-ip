import { WorkQueueSection } from './WorkQueue';
import type { AdminWorkQueueData } from '@/lib/admin/work-queue';
import { ADMIN_VOCABULARY } from '@/lib/admin/vocabulary';
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
  workQueue,
}: {
  insights: AdminInsights | null;
  workQueue?: AdminWorkQueueData;
  reports: AdminReportRecord[] | null;
}) {
  const recent = reports?.slice(0, 5) ?? [];

  return (
    <section className="admin-overview">
      <WorkQueueSection data={workQueue} />
      <section className="admin-overview__performance" aria-labelledby="admin-performance-title">
      <header className="admin-overview__heading">
        <h2 id="admin-performance-title" className="admin-overview__title">성과 통계 · 최근 30일</h2>
        <p className="admin-overview__description">오늘을 포함한 KST 30일 · 매출·결제 건수·평균 결제액은 결제완료 결제 기준입니다. 주문 단계 분포는 전체 기간입니다.</p>
      </header>
      {insights ? <>
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
          {ADMIN_VOCABULARY.claims} <Icon name="arrow" size={14} />
        </Link>
        <Link className="btn btn-sm btn-ghost" href="/admin/stats/customers">
          고객현황 <Icon name="arrow" size={14} />
        </Link>
      </nav>

      <div className="admin-overview-bottom">
        <RecentOrders orders={insights.recentOrders} />
        <TopIps ips={insights.topIps} />
      </div>

      </> : <p role="status">성과 통계를 불러오지 못했습니다. 새로고침 후 다시 확인해주세요.</p>}
      </section>

      <section className="card wc-admin-kit wc-admin-kit__card admin-overview-panel" aria-labelledby="admin-recent-reports-title">
        <header className="admin-overview-panel__heading">
          <div>
            <h2 id="admin-recent-reports-title" className="admin-overview-panel__title">최근 신고</h2>
            <p className="admin-overview-panel__description">커뮤니티 신고 최신 5건</p>
          </div>
          <Link className="btn btn-sm btn-ghost" href="/admin/community/moderation">
            모두 보기 <Icon name="arrow" size={14} />
          </Link>
        </header>
        <div className="admin-overview-list">
        {recent.map((report) => (
          <div key={report.id} className="admin-overview-list__row">
            <div className="admin-overview-list__copy">
              <strong className="admin-overview-list__name">
                {report.targetLabel}
              </strong>
              <span className="admin-overview-list__meta">
                {reportTargetLabels[report.targetType]} · 신고자 @{report.reporterName} ·{' '}
                {new Date(report.createdAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}
              </span>
            </div>
            <span className="tag">{report.status}</span>
          </div>
        ))}
        {!recent.length && (
          <p className="admin-overview-panel__description">{reports ? '접수된 신고가 없습니다.' : '신고 목록을 불러오지 못했습니다.'}</p>
        )}
        </div>
      </section>
    </section>
  );
}
