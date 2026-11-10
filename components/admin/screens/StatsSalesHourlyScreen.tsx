import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { StatsSalesHourlyTrend } from '@/components/admin/charts/StatsSalesHourlyTrend';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { StatsFilterControl, StatsFilterRow } from '@/components/admin/StatsRangeTabs';
import { StatsRateChange } from '@/components/admin/StatsComparison';
import { StatsSummaryTile } from '@/components/admin/StatsSummary';
import { ADMIN_SALES_HOURLY_PATH, adminSalesHourlyHref, adminSalesHourlyTime, type AdminSalesHourlyFilters, type AdminSalesHourlyReport } from '@/lib/admin/stats-hourly';
import { krw } from '@/lib/format';
import { StatsSalesViews } from './StatsSalesScreen';

export function StatsSalesHourlyControls({ filters, report, error }: { filters: AdminSalesHourlyFilters; report?: AdminSalesHourlyReport; error?: string }) {
  const yesterday = report ? new Date(Date.parse(`${report.date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10) : undefined;
  return <>
    <StatsSalesViews comparisonDate={filters.comparisonDate} current="hourly" ipId={filters.ipId} />
    <h2 className="text-lg leading-tight font-semibold tracking-tight">시간대별 판매현황</h2>
    <form action={ADMIN_SALES_HOURLY_PATH} className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground" key={adminSalesHourlyHref(filters)} method="get">
      <StatsFilterRow label="조회조건">
        <StatsFilterControl htmlFor="admin-sales-hourly-compare" label="비교일"><Input className="w-40" defaultValue={filters.comparisonDate ?? report?.comparisonDate ?? ''} id="admin-sales-hourly-compare" max={yesterday} name="compareDate" type="date" /></StatsFilterControl>
        <StatsFilterControl htmlFor="admin-sales-hourly-ip" label="IP 필터 (상품 TOP10)"><Input className="w-40" defaultValue={filters.ipId} id="admin-sales-hourly-ip" maxLength={64} name="ip" placeholder="IP 코드" /></StatsFilterControl>
      </StatsFilterRow>
      <StatsFilterRow label="오늘 현황">
        <button className={buttonVariants({ variant: 'soft' })} data-slot="button" type="submit"><RefreshCw aria-hidden="true" />조회·갱신</button>
        <Link className={buttonVariants({ variant: 'ghost' })} data-slot="button" href={ADMIN_SALES_HOURLY_PATH}>초기화</Link>
        <p className="text-xs text-muted-foreground">비교일 미선택 시 7일 전 · 오늘의 완료된 시간대까지 조회</p>
      </StatsFilterRow>
    </form>
    {error ? <AdminNotice role="alert" tone="danger">{error} <Link className="font-medium underline underline-offset-4" href={adminSalesHourlyHref({ ipId: filters.ipId })}>최신 현황 조회</Link></AdminNotice> : null}
  </>;
}

export function StatsSalesHourlyScreen({ report, filters }: { report: AdminSalesHourlyReport; filters: AdminSalesHourlyFilters }) {
  const current = report.summary.current; const comparison = report.summary.comparison;
  return <div className="flex min-w-0 flex-col gap-4" data-stats-screen="sales-hourly">
    <StatsSalesHourlyControls filters={filters} report={report} />
    <div className="flex flex-col gap-0.5 rounded-lg border bg-muted/40 px-4 py-3 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]"><p>조회시각(KST): {adminSalesHourlyTime(report.asOf)}</p><p>오늘 집계 마감(KST): {adminSalesHourlyTime(report.cutoff)} 직전 · 완료 {report.completedHours}시간</p><p>주문 생성시각 기준이며 조회 시점에 결제가 유지되는 주문만 포함합니다. IP 조건은 상품 TOP10에만 적용됩니다.</p></div>
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-stats-summary="">
      <StatsSummaryTile label="오늘 집계 주문매출" value={current ? krw(current.revenue) : '—'}><small className="text-xs text-muted-foreground tabular-nums">비교일 동일 시간: {comparison ? krw(comparison.revenue) : '—'}</small>{current && comparison ? <StatsRateChange current={current.revenue} previous={comparison.revenue} /> : <small className="text-xs text-muted-foreground">집계 마감까지 완료된 시간대가 없습니다.</small>}</StatsSummaryTile>
      <StatsSummaryTile label="오늘 집계 주문수" value={current ? `${current.orderCount.toLocaleString('ko-KR')}건` : '—'}><small className="text-xs text-muted-foreground tabular-nums">비교일 동일 시간: {comparison ? `${comparison.orderCount.toLocaleString('ko-KR')}건` : '—'}</small>{current && comparison ? <StatsRateChange current={current.orderCount} previous={comparison.orderCount} /> : <small className="text-xs text-muted-foreground">집계 마감까지 완료된 시간대가 없습니다.</small>}</StatsSummaryTile>
    </div>
    <details className="rounded-lg border bg-muted/40 px-4 py-3 text-sm"><summary className="cursor-pointer font-medium">집계 기준 확인</summary><ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-xs leading-relaxed text-muted-foreground">
      <li>현재 진행 중인 시간을 제외한 한국시간 정시 구간입니다. 비교일도 같은 완료 시간까지만 집계합니다. 00시에는 오늘 완료된 시간대가 없으며 직전 1시간은 전날 23시부터 오늘 00시 직전입니다.</li>
      <li>주문수는 상품 주문서 수, 주문매출은 배송비·할인·적립금을 반영한 주문 총액입니다. 주문 생성시각으로 나누며 카드 승인시각 기준이 아닙니다. 티켓 예매는 포함하지 않습니다.</li>
      <li>조회 시점에 결제완료·발주확인·배송중·배송완료·거래확정인 주문만 포함합니다. 취소되면 이후 조회의 과거 시간 값도 달라질 수 있습니다.</li>
      <li>상품금액은 주문 당시 수량×단가에서 복수구매 할인을 뺀 금액입니다. 혼합 IP 주문의 총액을 IP별로 나누지 않으며 IP 조건은 상품 TOP10에만 적용합니다. 비교값은 현재 순위에 오른 같은 상품의 값입니다.</li>
      <li>시간별 값·요약·순위·비교값은 같은 조회 시점입니다. 갱신은 새로운 조회이며 이전 시점의 주문 상태를 재현하지 않습니다.</li>
    </ul></details>
    <StatsSalesHourlyTrend report={report} />
  </div>;
}
