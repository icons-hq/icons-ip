import Link from 'next/link';
import { ADMIN_STATS_RANGE_DAYS, ADMIN_STATS_YEAR_COMPARISON_NOTE, adminStatsComparisonMode, adminStatsDateInputs, adminStatsHref, type AdminStatsFilters } from '@/lib/admin/stats';

export function StatsRangeTabs({ base, filters, now = new Date(), exportDisabledReason }: { base: string; filters: AdminStatsFilters; now?: Date; exportDisabledReason?: string }) {
  const dates = adminStatsDateInputs(filters, now);
  const comparisonMode = adminStatsComparisonMode(filters);
  const screen = base.split('/').at(-1);
  const exportHref = adminStatsHref('/api/admin/stats-workbook', { ...filters, from: dates.from, to: dates.to });
  return <div className="admin-stats-controls">
    <form action={base} method="get">
      <div className="admin-stats-range-row">
        <span>조회기간</span>
        <nav aria-label="조회 기간">{ADMIN_STATS_RANGE_DAYS.map(days => <Link key={days}
          aria-current={!filters.from && days === filters.days ? 'true' : undefined}
          href={adminStatsHref(base, { ...filters, days, from: null, to: null })}>최근 {days}일</Link>)}</nav>
        <label><input aria-label="조회 시작일" defaultValue={dates.from} name="from" required type="date" /></label>
        <span>~</span>
        <label><input aria-label="조회 종료일" defaultValue={dates.to} name="to" required type="date" /></label>
        <button className="btn admin-stats-search" type="submit">조회</button>
      </div>
      <div className="admin-stats-range-row">
        <span>조회기준</span>
        {screen !== 'claims' ? <label>단위 <select defaultValue={filters.bucket ?? 'day'} name="bucket"><option value="day">일별</option><option value="week">주별</option><option value="month">월별</option></select></label> : null}
        <label className="admin-stats-compare">비교 <select defaultValue={comparisonMode} name="compare"><option value="none">비교 없음</option><option value="previous">직전 동일 기간</option><option value="year">전년 동일 날짜</option></select></label>
        {screen === 'sales' ? <label>IP 필터 (상품 순위)<input defaultValue={filters.ipId} maxLength={64} name="ip" placeholder="IP 코드" /></label> : null}
      </div>
    </form>
    <div className="admin-stats-range-note"><div><p>한국시간 기준 · 최대 366일 · 주별은 월요일 시작</p>
      {comparisonMode === 'year' ? <p>{ADMIN_STATS_YEAR_COMPARISON_NOTE}</p> : null}</div>
      {!filters.rangeError ? exportDisabledReason ? <p role="status">{exportDisabledReason}</p> : <a className="btn btn-sm btn-ghost" href={`${exportHref}${exportHref.includes('?') ? '&' : '?'}report=${screen}`}>엑셀 다운로드</a> : null}</div>
  </div>;
}
