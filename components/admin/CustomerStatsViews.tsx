import Link from 'next/link';

export function CustomerStatsViews({ view }: { view: 'status' | 'purchase' | 'demographics' }) {
  return <nav className="admin-customer-stats-views" aria-label="고객 통계 종류">
    <Link href="/admin/stats/customers" aria-current={view === 'status' ? 'page' : undefined}>고객현황</Link>
    <Link href="/admin/stats/customers?view=purchase" aria-current={view === 'purchase' ? 'page' : undefined}>신규/재구매 분석</Link>
    <Link href="/admin/stats/customers?view=demographics" aria-current={view === 'demographics' ? 'page' : undefined}>성별·연령별 분석</Link>
  </nav>;
}
