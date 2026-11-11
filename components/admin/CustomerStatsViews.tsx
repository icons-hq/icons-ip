import Link from 'next/link';
import { STATS_SEGMENTED, STATS_SEGMENT_LINK } from './StatsSummary';

export function CustomerStatsViews({ view }: { view: 'status' | 'purchase' | 'demographics' }) {
  return <nav aria-label="고객 통계 종류" className={`${STATS_SEGMENTED} mb-4`} data-stats-views="customers">
    <Link aria-current={view === 'status' ? 'page' : undefined} className={STATS_SEGMENT_LINK} href="/admin/stats/customers">고객현황</Link>
    <Link aria-current={view === 'purchase' ? 'page' : undefined} className={STATS_SEGMENT_LINK} href="/admin/stats/customers?view=purchase">신규/재구매 분석</Link>
    <Link aria-current={view === 'demographics' ? 'page' : undefined} className={STATS_SEGMENT_LINK} href="/admin/stats/customers?view=demographics">성별·연령별 분석</Link>
  </nav>;
}
