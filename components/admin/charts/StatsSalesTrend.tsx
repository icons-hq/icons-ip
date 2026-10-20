'use client';

import { useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AdminSalesDailyRow } from '@/lib/admin/stats';

const METRICS = { revenue: { label: '매출', unit: '원' }, orderCount: { label: '주문수', unit: '건' }, averageOrderValue: { label: '객단가', unit: '원' } } as const;
export function StatsSalesTrend({ rows }: { rows: AdminSalesDailyRow[] }) {
  const [metric, setMetric] = useState<keyof typeof METRICS>('revenue');
  return <section className="admin-stats-trend" aria-label="판매 추이">
    <header><h3>판매 추이</h3><div role="group" aria-label="차트 지표">{Object.entries(METRICS).map(([key, value]) => <button aria-pressed={metric === key} key={key} onClick={() => setMetric(key as keyof typeof METRICS)} type="button">{value.label}</button>)}</div></header>
    <div className="admin-stats-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{ top: 12, right: 20, bottom: 10, left: 10 }}>
      <CartesianGrid stroke="var(--wc-hairline)" vertical={false} />
      <XAxis dataKey="date" tick={{ fontSize: 12, fill: 'var(--wc-ink-tertiary)' }} tickLine={false} minTickGap={24} />
      <YAxis tick={{ fontSize: 12, fill: 'var(--wc-ink-tertiary)' }} tickFormatter={value => Number(value).toLocaleString('ko-KR')} width={80} axisLine={false} tickLine={false} />
      <Tooltip formatter={value => [`${Number(value).toLocaleString('ko-KR')}${METRICS[metric].unit}`, METRICS[metric].label]} contentStyle={{ background: 'var(--wc-surface)', border: '1px solid var(--wc-line-control)', borderRadius: 0 }} />
      <Line dataKey={metric} stroke="var(--wc-info)" strokeWidth={2} dot={rows.length <= 31} isAnimationActive={false} />
    </LineChart></ResponsiveContainer></div>
  </section>;
}
