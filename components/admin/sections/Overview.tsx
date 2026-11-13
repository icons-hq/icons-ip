import { HomeAttention } from './HomeAttention';
import type { AdminHomeAttention } from '@/lib/admin/home-attention';
import { SellerOverviewSummary } from './SellerOverviewSummary';
import { ADMIN_INSIGHT_PERIODS, type AdminHomeSummary, type AdminInsightPeriod } from '@/lib/admin/home-summary';
import { GOODS_READINESS_REASONS } from '@/lib/admin/goods-readiness';
import type { AdminWorkQueueData } from '@/lib/admin/work-queue';
import { ADMIN_VOCABULARY } from '@/lib/admin/vocabulary';
import Link from 'next/link';
import { ArrowRight, ChevronDown, LayoutGrid, TrendingUp } from 'lucide-react';
import type { AdminInsights } from '@/lib/admin/insights.server';
import type { AdminReportRecord } from '@/lib/admin/moderation.server';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader } from '@/components/admin/kit/ui/card';
import { MetricCard } from '../MetricCard';
import { RecentOrders } from '../RecentOrders';
import { TopIps } from '../TopIps';
import { OrderPipeline } from '../charts/OrderPipeline';
import { RevenueTrend } from '../charts/RevenueTrend';
import { formatKrwExact, metricChange } from '../format';
import { reportTargetLabels } from '@/lib/admin/moderation';
import { statusTone } from '@/lib/admin/status-tone';
import { ADMIN_REPORT_STATUS_LABELS } from '@/lib/admin/moderation';
import { AdminNotice, AdminStatusBadge } from '../console/AdminKit';
import { Skeleton } from '@/components/admin/kit/ui/skeleton';
import { OverviewDeferred, type OverviewLoadable } from './OverviewDeferred';

/* 셸의 콘솔 전환과 같은 구분 선택(링크 탭). */
const SEGMENT_LINK = 'inline-flex h-7 items-center rounded-md px-3 text-[0.8rem] font-medium text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:text-primary-soft-foreground aria-[current=page]:shadow-sm';
const OUTLINE_SM = buttonVariants({ variant: 'outline', size: 'sm' });

/** 판매 성과가 오기 전의 자리. 지표 카드·그래프와 비슷한 높이를 잡아 값이 와도 아래 카드가 크게 밀리지 않는다. */
function PerformancePending() {
  return <div aria-busy="true" className="flex min-w-0 flex-col gap-4" role="status" aria-label="판매 성과 집계 중">
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((key) => <Skeleton className="h-28 rounded-xl" key={key} />)}</div>
    <Skeleton className="h-72 rounded-xl" />
  </div>;
}

export function OverviewSection({
  insights,
  reports,
  workQueue,
  summary,
  days = 30,
  attention,
}: {
  insights: OverviewLoadable<AdminInsights | null>;
  workQueue?: AdminWorkQueueData;
  reports: OverviewLoadable<AdminReportRecord[] | null>;
  summary?: AdminHomeSummary;
  days?: AdminInsightPeriod;
  attention?: AdminHomeAttention;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-4" data-admin-home="overview">
      <SellerOverviewSummary insights={insights} workQueue={workQueue} summary={summary} days={days} />
      {attention ? <HomeAttention data={attention} /> : null}
      <details className="group/performance min-w-0 rounded-xl bg-card text-sm text-card-foreground ring-1 ring-foreground/10" data-admin-home="performance" open>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-4 py-3 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2 text-base font-medium"><TrendingUp aria-hidden="true" className="size-4 text-muted-foreground" />판매 성과</span>
          <ChevronDown aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open/performance:rotate-180" />
        </summary>
        <div className="flex min-w-0 flex-col gap-4 border-t p-4">
          <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <nav aria-label="성과 조회기간" className="inline-flex w-fit shrink-0 items-center rounded-lg bg-muted p-0.5">{ADMIN_INSIGHT_PERIODS.map((period) => <Link aria-current={period === days ? 'page' : undefined} className={SEGMENT_LINK} href={`/admin?period=${period}`} key={period}>{period === 1 ? '일간' : period === 7 ? '주간' : '월간'}</Link>)}</nav>
            <p className="text-sm text-muted-foreground">오늘을 포함한 KST {days}일 · 매출·결제 건수·평균 결제액은 결제완료 결제 기준입니다. 증감은 직전 {days}일과 비교합니다.</p>
          </header>
          <OverviewDeferred fallback={<PerformancePending />} value={insights}>{(ready) => ready ? <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label={`${days}일 매출`}
                comparisonDays={days}
                value={formatKrwExact(ready.revenue.current)}
                {...metricChange(ready.revenue)}
              />
              <MetricCard
                label={`${days}일 결제 건수`}
                comparisonDays={days}
                value={`${ready.paymentCount.current.toLocaleString('ko-KR')}건`}
                {...metricChange(ready.paymentCount)}
              />
              <MetricCard
                label="평균 결제액"
                comparisonDays={days}
                value={formatKrwExact(ready.avgPayment.current)}
                {...metricChange(ready.avgPayment)}
              />
              <MetricCard
                label={`${days}일 신규 가입`}
                comparisonDays={days}
                value={`${ready.signupCount.current.toLocaleString('ko-KR')}명`}
                {...metricChange(ready.signupCount)}
              />
            </div>

            <div className="grid min-w-0 grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(20rem,1fr)]">
              <RevenueTrend data={ready.dailyRevenue} days={days} />
              <OrderPipeline stages={ready.pipeline} />
            </div>

            {/*
              이 대시보드는 "지금 어떤가"를 한눈에 보는 자리로 남긴다(#258). 같은 지표를
              기간·축을 바꿔 파고드는 일은 통계 리포트가 맡으므로, 겹치는 카드 바로 아래에
              그 길을 열어 둔다 — 링크가 없으면 운영자가 여기서 더 깊이 보려다 못 찾는다.
            */}
            <nav aria-label="상세 리포트" className="flex flex-wrap items-center gap-2 border-y py-3">
              <span className="basis-full text-sm text-muted-foreground sm:mr-2 sm:basis-auto">더 자세히 보기</span>
              <Link className={OUTLINE_SM} data-slot="button" href="/admin/stats/sales">
                판매분석 <ArrowRight aria-hidden="true" />
              </Link>
              <Link className={OUTLINE_SM} data-slot="button" href="/admin/stats/claims">
                {ADMIN_VOCABULARY.claims} <ArrowRight aria-hidden="true" />
              </Link>
              <Link className={OUTLINE_SM} data-slot="button" href="/admin/stats/customers">
                고객현황 <ArrowRight aria-hidden="true" />
              </Link>
            </nav>

            <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2">
              <RecentOrders orders={ready.recentOrders} />
              <TopIps ips={ready.topIps} />
            </div>
          </> : <AdminNotice role="status" tone="warning">성과 통계를 불러오지 못했습니다. 새로고침 후 다시 확인해주세요.</AdminNotice>}</OverviewDeferred>
        </div>
      </details>

      {workQueue?.goodsReasons.length ? <section aria-labelledby="admin-home-diagnosis-title" className="min-w-0 rounded-xl bg-card text-sm text-card-foreground ring-1 ring-foreground/10" data-admin-home="diagnosis">
        <header className="flex items-center gap-2 px-4 py-3"><LayoutGrid aria-hidden="true" className="size-4 text-muted-foreground" /><h2 className="text-base font-medium" id="admin-home-diagnosis-title">상품 진단</h2></header>
        <ul aria-label="상품 검토 사유별 건수" className="flex flex-wrap gap-2 border-t p-4">{workQueue.goodsReasons.map((reason) => <li key={reason.code}><Link className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" href={reason.href} prefetch={false}>{GOODS_READINESS_REASONS[reason.code].label}<strong className={`font-semibold tabular-nums${reason.count > 0 ? ' text-warning' : ' text-foreground'}`}>{reason.count.toLocaleString('ko-KR')}개</strong></Link></li>)}</ul>
      </section> : null}

      <Card aria-labelledby="admin-recent-reports-title" className="min-w-0" data-admin-home="reports" role="region">
        <CardHeader>
          <h2 className="text-base leading-snug font-medium" id="admin-recent-reports-title">최근 신고</h2>
          <CardDescription>커뮤니티 신고 최신 5건</CardDescription>
          <CardAction>
            <Link className={OUTLINE_SM} data-slot="button" href="/admin/community/moderation">
              모두 보기 <ArrowRight aria-hidden="true" />
            </Link>
          </CardAction>
        </CardHeader>
        <CardContent>
          <OverviewDeferred fallback={<div aria-busy="true" className="flex flex-col gap-3"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /></div>} value={reports}>{(ready) => {
            const recent = ready?.slice(0, 5) ?? [];
            return recent.length ? <ul className="flex flex-col divide-y">
            {recent.map((report) => (
              <li className="flex min-w-0 items-center justify-between gap-4 py-3 first:pt-0 last:pb-0" key={report.id}>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <strong className="truncate text-sm font-medium">
                    {report.targetLabel}
                  </strong>
                  <span className="text-xs text-muted-foreground">
                    {reportTargetLabels[report.targetType]} · 신고자 @{report.reporterName} ·{' '}
                    {new Date(report.createdAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}
                  </span>
                </div>
                <AdminStatusBadge tone={statusTone('report', report.status)}>{ADMIN_REPORT_STATUS_LABELS[report.status] ?? report.status}</AdminStatusBadge>
              </li>
            ))}
          </ul> : <p className="text-sm text-muted-foreground">{ready ? '접수된 신고가 없습니다.' : '신고 목록을 불러오지 못했습니다.'}</p>;
          }}</OverviewDeferred>
        </CardContent>
      </Card>

      {/* 가이드는 매일 보는 숫자의 자리를 차지하지 않게 맨 아래 작은 링크로 둔다. */}
      <aside aria-label="판매자센터 안내" className="flex justify-end px-1 text-xs text-muted-foreground">
        <Link className="underline-offset-4 hover:text-foreground hover:underline" href="/admin/guide">사용 가이드</Link>
      </aside>
    </div>
  );
}
