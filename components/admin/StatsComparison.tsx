import { adminStatsChange, adminStatsComparisonFilters, adminStatsComparisonLabel, adminStatsDateInputs, type AdminStatsFilters } from '@/lib/admin/stats';

export function StatsComparison({ filters, rows, now = new Date() }: { filters: AdminStatsFilters; rows: { label: string; current: number; previous: number; unit?: string }[]; now?: Date }) {
  const comparison = adminStatsComparisonFilters(filters, now);
  if (!comparison) return null;
  const dates = adminStatsDateInputs(comparison, now);
  const label = adminStatsComparisonLabel(filters);
  return <section aria-label={label} className="min-w-0 rounded-xl border bg-card text-card-foreground" data-stats-comparison="">
    <h3 className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b px-4 py-3 text-base font-medium">{label} <small className="text-xs font-normal text-muted-foreground tabular-nums">{dates.from} ~ {dates.to}</small></h3>
    <dl className="grid grid-cols-1 gap-4 p-4 min-[420px]:grid-cols-2 md:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]">{rows.map(row => <div className="min-w-0" key={row.label}><dt className="text-sm text-muted-foreground">{row.label}</dt><dd className="mt-1 flex flex-col gap-0.5"><strong className="text-xl font-semibold tabular-nums">{adminStatsChange(row.current, row.previous)}</strong><span className="text-xs text-muted-foreground tabular-nums">{row.previous.toLocaleString('ko-KR')}{row.unit} → {row.current.toLocaleString('ko-KR')}{row.unit}</span></dd></div>)}</dl>
  </section>;
}
