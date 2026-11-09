import Link from 'next/link';
import type { ReactNode } from 'react';
import { Download } from 'lucide-react';
import { ConsoleFilterActions } from '@/components/admin/console/ConsoleFilterPanel';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { ADMIN_STATS_RANGE_DAYS, ADMIN_STATS_YEAR_COMPARISON_NOTE, adminStatsComparisonMode, adminStatsDateInputs, adminStatsHref, type AdminStatsFilters } from '@/lib/admin/stats';
import { STATS_SEGMENTED, STATS_SEGMENT_LINK } from './StatsSummary';

/** 조회 조건 한 줄(스마트스토어식 행 라벨 + 조건). */
export function StatsFilterRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid min-w-0 gap-2 sm:grid-cols-[6.5rem_minmax(0,1fr)] sm:items-center" data-stats-filter-row="">
    <span className="text-sm font-medium">{label}</span>
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">{children}</div>
  </div>;
}

/** 줄 안의 조건 하나(작은 라벨 + 입력). */
export function StatsFilterControl({ htmlFor, label, children }: { htmlFor: string; label: string; children: ReactNode }) {
  return <div className="flex min-w-0 flex-wrap items-center gap-2">
    <label className="text-sm whitespace-nowrap text-muted-foreground" htmlFor={htmlFor}>{label}</label>
    {children}
  </div>;
}

export function StatsRangeTabs({ base, filters, now = new Date(), exportDisabledReason }: { base: string; filters: AdminStatsFilters; now?: Date; exportDisabledReason?: string }) {
  const dates = adminStatsDateInputs(filters, now);
  const comparisonMode = adminStatsComparisonMode(filters);
  const screen = base.split('/').at(-1);
  const exportHref = adminStatsHref('/api/admin/stats-workbook', { ...filters, from: dates.from, to: dates.to });
  const idPrefix = `admin-stats-${screen}`;
  return <div className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground" data-stats-controls="">
    <form action={base} className="flex min-w-0 flex-col gap-3" method="get">
      <StatsFilterRow label="조회기간">
        <nav aria-label="조회 기간" className={STATS_SEGMENTED}>{ADMIN_STATS_RANGE_DAYS.map(days => <Link key={days}
          aria-current={!filters.from && days === filters.days ? 'true' : undefined}
          className={STATS_SEGMENT_LINK}
          href={adminStatsHref(base, { ...filters, days, from: null, to: null })}>최근 {days}일</Link>)}</nav>
        <div className="flex items-center gap-1.5">
          <Input aria-label="조회 시작일" className="w-36" defaultValue={dates.from} name="from" required type="date" />
          <span aria-hidden="true" className="text-muted-foreground">~</span>
          <Input aria-label="조회 종료일" className="w-36" defaultValue={dates.to} name="to" required type="date" />
        </div>
      </StatsFilterRow>
      <StatsFilterRow label="조회기준">
        {screen !== 'claims' ? <StatsFilterControl htmlFor={`${idPrefix}-bucket`} label="단위"><NativeSelect defaultValue={filters.bucket ?? 'day'} id={`${idPrefix}-bucket`} name="bucket"><option value="day">일별</option><option value="week">주별</option><option value="month">월별</option></NativeSelect></StatsFilterControl> : null}
        <StatsFilterControl htmlFor={`${idPrefix}-compare`} label="비교"><NativeSelect defaultValue={comparisonMode} id={`${idPrefix}-compare`} name="compare"><option value="none">비교 없음</option><option value="previous">직전 동일 기간</option><option value="year">전년 동일 날짜</option></NativeSelect></StatsFilterControl>
        {screen === 'sales' ? <StatsFilterControl htmlFor={`${idPrefix}-ip`} label="IP 필터 (상품 순위)"><Input className="w-40" defaultValue={filters.ipId} id={`${idPrefix}-ip`} maxLength={64} name="ip" placeholder="IP 코드" /></StatsFilterControl> : null}
      </StatsFilterRow>
      {/* 조회 카드 바닥 줄(콘솔 조회 카드와 같다): 왼쪽에 집계 기준·내보내기, 오른쪽에 [초기화][조회]. */}
      <ConsoleFilterActions start={<>
        <div className="flex flex-col gap-0.5 text-xs text-muted-foreground"><p>한국시간 기준 · 최대 366일 · 주별은 월요일 시작</p>
          {comparisonMode === 'year' ? <p>{ADMIN_STATS_YEAR_COMPARISON_NOTE}</p> : null}</div>
        {!filters.rangeError ? exportDisabledReason ? <p className="text-sm text-muted-foreground" role="status">{exportDisabledReason}</p> : <a className={buttonVariants({ variant: 'outline', size: 'sm' })} data-slot="button" href={`${exportHref}${exportHref.includes('?') ? '&' : '?'}report=${screen}`}><Download aria-hidden="true" />엑셀 다운로드</a> : null}
      </>}>
        <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={base}>초기화</Link>
        <button className={buttonVariants()} data-slot="button" type="submit">조회</button>
      </ConsoleFilterActions>
    </form>
  </div>;
}
