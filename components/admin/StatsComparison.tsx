import { adminStatsChange, adminStatsComparisonFilters, adminStatsComparisonLabel, adminStatsDateInputs, type AdminStatsFilters } from '@/lib/admin/stats';

export function StatsComparison({ filters, rows, now = new Date() }: { filters: AdminStatsFilters; rows: { label: string; current: number; previous: number; unit?: string }[]; now?: Date }) {
  const comparison = adminStatsComparisonFilters(filters, now);
  if (!comparison) return null;
  const dates = adminStatsDateInputs(comparison, now);
  const label = adminStatsComparisonLabel(filters);
  return <section aria-label={label} className="admin-stats-comparison">
    <h3>{label} <small>{dates.from} ~ {dates.to}</small></h3>
    <dl>{rows.map(row => <div key={row.label}><dt>{row.label}</dt><dd><strong>{adminStatsChange(row.current, row.previous)}</strong><span>{row.previous.toLocaleString('ko-KR')}{row.unit} → {row.current.toLocaleString('ko-KR')}{row.unit}</span></dd></div>)}</dl>
  </section>;
}
