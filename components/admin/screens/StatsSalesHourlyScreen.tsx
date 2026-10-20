import Link from 'next/link';
import { StatsSalesHourlyTrend } from '@/components/admin/charts/StatsSalesHourlyTrend';
import { adminStatsChange } from '@/lib/admin/stats';
import { ADMIN_SALES_HOURLY_PATH, adminSalesHourlyHref, adminSalesHourlyTime, type AdminSalesHourlyFilters, type AdminSalesHourlyReport } from '@/lib/admin/stats-hourly';
import { krw } from '@/lib/format';

export function StatsSalesHourlyControls({ filters, report, error }: { filters: AdminSalesHourlyFilters; report?: AdminSalesHourlyReport; error?: string }) {
  const yesterday = report ? new Date(Date.parse(`${report.date}T00:00:00Z`) - 86400000).toISOString().slice(0, 10) : undefined;
  return <>
    <nav className="admin-sales-stats-views" aria-label="판매분석 조회 종류"><Link href="/admin/stats/sales">기간별 판매분석</Link><Link aria-current="page" href={adminSalesHourlyHref({ comparisonDate: filters.comparisonDate, ipId: filters.ipId })}>시간대별 현황</Link></nav>
    <h2>시간대별 판매현황</h2>
    <div className="admin-stats-controls"><form action={ADMIN_SALES_HOURLY_PATH} method="get" key={adminSalesHourlyHref(filters)}>
      <div className="admin-stats-range-row"><span>조회조건</span><label>비교일<input type="date" name="compareDate" max={yesterday} defaultValue={filters.comparisonDate ?? report?.comparisonDate ?? ''} /></label><label>IP 필터 (상품 TOP10)<input name="ip" maxLength={64} defaultValue={filters.ipId} placeholder="IP 코드" /></label></div>
      <div className="admin-stats-range-row"><span>오늘 현황</span><button type="submit" className="btn admin-stats-search">조회·갱신</button><Link href={ADMIN_SALES_HOURLY_PATH} className="btn btn-ghost">초기화</Link><p className="admin-note">비교일 미선택 시 7일 전 · 오늘의 완료된 시간대까지 조회</p></div>
    </form></div>
    {error ? <p role="alert">{error} <Link href={adminSalesHourlyHref({ ipId: filters.ipId })}>최신 현황 조회</Link></p> : null}
  </>;
}

export function StatsSalesHourlyScreen({ report, filters }: { report: AdminSalesHourlyReport; filters: AdminSalesHourlyFilters }) {
  const current = report.summary.current; const comparison = report.summary.comparison;
  return <section className="admin-console admin-stats admin-sales-hourly wc-admin-kit">
    <StatsSalesHourlyControls filters={filters} report={report} />
    <div className="admin-sales-hourly-observation"><p>조회시각(KST): {adminSalesHourlyTime(report.asOf)}</p><p>오늘 집계 마감(KST): {adminSalesHourlyTime(report.cutoff)} 직전 · 완료 {report.completedHours}시간</p><p>주문 생성시각 기준이며 조회 시점에 결제가 유지되는 주문만 포함합니다. IP 조건은 상품 TOP10에만 적용됩니다.</p></div>
    <div className="admin-stats-summary">
      <div><span>오늘 집계 주문매출</span><strong className="mono">{current ? krw(current.revenue) : '—'}</strong><small>비교일 동일 시간: {comparison ? krw(comparison.revenue) : '—'}</small><small>{current && comparison ? adminStatsChange(current.revenue, comparison.revenue) : '집계 마감까지 완료된 시간대가 없습니다.'}</small></div>
      <div><span>오늘 집계 주문수</span><strong className="mono">{current ? `${current.orderCount.toLocaleString('ko-KR')}건` : '—'}</strong><small>비교일 동일 시간: {comparison ? `${comparison.orderCount.toLocaleString('ko-KR')}건` : '—'}</small><small>{current && comparison ? adminStatsChange(current.orderCount, comparison.orderCount) : '집계 마감까지 완료된 시간대가 없습니다.'}</small></div>
    </div>
    <details className="admin-sales-hourly-definitions"><summary>집계 기준 확인</summary><ul>
      <li>현재 진행 중인 시간을 제외한 한국시간 정시 구간입니다. 비교일도 같은 완료 시간까지만 집계합니다. 00시에는 오늘 완료된 시간대가 없으며 직전 1시간은 전날 23시부터 오늘 00시 직전입니다.</li>
      <li>주문수는 상품 주문서 수, 주문매출은 배송비·할인·적립금을 반영한 주문 총액입니다. 주문 생성시각으로 나누며 카드 승인시각 기준이 아닙니다. 티켓 예매는 포함하지 않습니다.</li>
      <li>조회 시점에 결제완료·발주확인·배송중·배송완료·거래확정인 주문만 포함합니다. 취소되면 이후 조회의 과거 시간 값도 달라질 수 있습니다.</li>
      <li>상품금액은 주문 당시 수량×단가에서 복수구매 할인을 뺀 금액입니다. 혼합 IP 주문의 총액을 IP별로 나누지 않으며 IP 조건은 상품 TOP10에만 적용합니다. 비교값은 현재 순위에 오른 같은 상품의 값입니다.</li>
      <li>시간별 값·요약·순위·비교값은 같은 조회 시점입니다. 갱신은 새로운 조회이며 이전 시점의 주문 상태를 재현하지 않습니다.</li>
    </ul></details>
    <StatsSalesHourlyTrend report={report} />
  </section>;
}
