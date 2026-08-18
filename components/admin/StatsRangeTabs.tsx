import Link from 'next/link';
import {
  ADMIN_STATS_RANGE_DAYS,
  adminStatsHref,
  type AdminStatsFilters,
} from '@/lib/admin/stats';

/**
 * 기간 프리셋. 임의 기간과 CSV는 후속이다(#258) — v1에서 필요한 판단은
 * "이번 주/이번 달/분기가 어땠나"이고, 그 셋은 프리셋으로 충분하다.
 */
export function StatsRangeTabs({
  base,
  filters,
}: {
  base: string;
  filters: AdminStatsFilters;
}) {
  return (
    <nav className="admin-console-chips" aria-label="조회 기간">
      {ADMIN_STATS_RANGE_DAYS.map((days) => (
        <Link
          aria-current={days === filters.days ? 'true' : undefined}
          className="admin-console-chip"
          href={adminStatsHref(base, { ...filters, days })}
          key={days}
        >
          <span className="admin-console-chip-label">최근 {days}일</span>
        </Link>
      ))}
    </nav>
  );
}
