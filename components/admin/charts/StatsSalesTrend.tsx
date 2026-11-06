'use client';

import { useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AdminSalesDailyRow } from '@/lib/admin/stats';
import { STATS_SEGMENTED, STATS_SEGMENT_BUTTON } from '../StatsSummary';
import { CHART_AXIS_TICK, CHART_GRID_STROKE, CHART_TOOLTIP_STYLE } from './chart-theme';

const METRICS = { revenue: { label: '매출', unit: '원' }, orderCount: { label: '주문수', unit: '건' }, averageOrderValue: { label: '객단가', unit: '원' } } as const;
export function StatsSalesTrend({ rows }: { rows: AdminSalesDailyRow[] }) {
  const [metric, setMetric] = useState<keyof typeof METRICS>('revenue');
  return <section aria-label="판매 추이" className="min-w-0 rounded-xl border bg-card text-card-foreground" data-stats-trend="">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3"><h3 className="text-base font-medium">판매 추이</h3><div aria-label="차트 지표" className={STATS_SEGMENTED} role="group">{Object.entries(METRICS).map(([key, value]) => <button aria-pressed={metric === key} className={STATS_SEGMENT_BUTTON} key={key} onClick={() => setMetric(key as keyof typeof METRICS)} type="button">{value.label}</button>)}</div></header>
    <div className="h-64 px-2 pt-4 pb-1 sm:h-80 sm:px-3"><ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{ top: 12, right: 20, bottom: 10, left: 10 }}>
      <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
      <XAxis axisLine={{ stroke: CHART_GRID_STROKE }} dataKey="date" tick={CHART_AXIS_TICK} tickLine={false} minTickGap={24} />
      <YAxis tick={CHART_AXIS_TICK} tickFormatter={value => Number(value).toLocaleString('ko-KR')} width={80} axisLine={false} tickLine={false} />
      <Tooltip formatter={value => [`${Number(value).toLocaleString('ko-KR')}${METRICS[metric].unit}`, METRICS[metric].label]} contentStyle={CHART_TOOLTIP_STYLE.content} itemStyle={CHART_TOOLTIP_STYLE.item} labelStyle={CHART_TOOLTIP_STYLE.label} />
      <Line dataKey={metric} stroke="var(--chart-4)" strokeWidth={2} dot={rows.length <= 31} isAnimationActive={false} />
    </LineChart></ResponsiveContainer></div>
  </section>;
}
