'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AdminDailyRevenue } from '@/lib/admin/insights.server';
import { formatKrw } from '../format';

function dayLabel(date: string) {
  const [, month, day] = date.split('-');
  return `${Number(month)}.${Number(day)}`;
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="admin-overview-legend__item">
      <span className="admin-overview-legend__dot" style={{ background: color }} />
      {label}
    </span>
  );
}

export function RevenueTrend({ data }: { data: AdminDailyRevenue[] }) {
  const hasRevenue = data.some(day => day.goods !== 0 || day.tickets !== 0);
  return (
    <div className="card wc-admin-kit wc-admin-kit__card admin-overview-panel">
      <header className="admin-overview-panel__heading">
        <div>
          <h3 className="admin-overview-panel__title">매출 추이</h3>
          <p className="admin-overview-panel__description">최근 30일 · 결제 완료 기준</p>
        </div>
        <div className="admin-overview-legend">
          <LegendDot color="var(--wc-info)" label="상품" />
          <LegendDot color="var(--wc-success)" label="티켓" />
        </div>
      </header>
      {hasRevenue ? <div className="admin-revenue-chart">
        <ResponsiveContainer height="100%" width="100%">
          <AreaChart data={data} margin={{ bottom: 0, left: 0, right: 8, top: 8 }}>
            <defs>
              <linearGradient id="adminGoodsRevenue" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--wc-info)" stopOpacity={0.4} />
                <stop offset="100%" stopColor="var(--wc-info)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="adminTicketRevenue" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--wc-success)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--wc-success)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--wc-hairline)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="date"
              dy={8}
              minTickGap={28}
              tick={{ fill: 'var(--wc-ink-tertiary)', fontSize: 11 }}
              tickFormatter={dayLabel}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              dx={-6}
              tick={{ fill: 'var(--wc-ink-tertiary)', fontSize: 11 }}
              tickFormatter={(value: number) => (value ? formatKrw(value) : '0')}
              tickLine={false}
              width={64}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--wc-surface)',
                border: '1px solid var(--wc-line-control)',
                borderRadius: 'var(--wc-radius-form)',
                fontSize: 12,
              }}
              formatter={(value, name) => [formatKrw(Number(value)), name === 'goods' ? '상품' : '티켓']}
              itemStyle={{ color: 'var(--wc-ink-tertiary)' }}
              labelFormatter={(label) => dayLabel(String(label))}
              labelStyle={{ color: 'var(--wc-ink)', fontWeight: 600 }}
            />
            {/* 캡처/헤드리스 환경에서 rAF 클록이 얼면 마운트 애니메이션 clip이 프레임 0에 멈춘다 — 정적 렌더 */}
            <Area dataKey="tickets" fill="url(#adminTicketRevenue)" isAnimationActive={false} stroke="var(--wc-success)" strokeWidth={2} type="monotone" />
            <Area dataKey="goods" fill="url(#adminGoodsRevenue)" isAnimationActive={false} stroke="var(--wc-info)" strokeWidth={2} type="monotone" />
          </AreaChart>
        </ResponsiveContainer>
      </div> : <div className="admin-revenue-empty" role="status">
        <strong>최근 30일 결제 완료 매출이 없습니다.</strong>
        <p>결제가 완료되면 날짜별 매출이 여기에 표시됩니다.</p>
      </div>}
    </div>
  );
}
