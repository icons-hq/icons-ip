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
    <span className="row" style={{ fontSize: 12, color: 'var(--dim)', gap: 6 }}>
      <span style={{ background: color, borderRadius: 999, height: 9, width: 9 }} />
      {label}
    </span>
  );
}

export function RevenueTrend({ data }: { data: AdminDailyRevenue[] }) {
  return (
    <div className="card col" style={{ borderRadius: 10, minWidth: 0, padding: 18 }}>
      <div className="between" style={{ marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>매출 추이</h2>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>최근 30일 · 결제 완료 기준</div>
        </div>
        <div className="row" style={{ gap: 14 }}>
          <LegendDot color="var(--violet)" label="굿즈" />
          <LegendDot color="var(--mint)" label="티켓" />
        </div>
      </div>
      <div style={{ height: 260, width: '100%' }}>
        <ResponsiveContainer height="100%" width="100%">
          <AreaChart data={data} margin={{ bottom: 0, left: 0, right: 8, top: 8 }}>
            <defs>
              <linearGradient id="adminGoodsRevenue" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--violet)" stopOpacity={0.4} />
                <stop offset="100%" stopColor="var(--violet)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="adminTicketRevenue" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--mint)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--mint)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="rgba(255,255,255,.07)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              axisLine={false}
              dataKey="date"
              dy={8}
              minTickGap={28}
              tick={{ fill: 'var(--faint)', fontSize: 11 }}
              tickFormatter={dayLabel}
              tickLine={false}
            />
            <YAxis
              axisLine={false}
              dx={-6}
              tick={{ fill: 'var(--faint)', fontSize: 11 }}
              tickFormatter={(value: number) => (value ? formatKrw(value) : '0')}
              tickLine={false}
              width={64}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--line-2)',
                borderRadius: 10,
                fontSize: 12,
              }}
              formatter={(value, name) => [formatKrw(Number(value)), name === 'goods' ? '굿즈' : '티켓']}
              itemStyle={{ color: 'var(--dim)' }}
              labelFormatter={(label) => dayLabel(String(label))}
              labelStyle={{ color: 'var(--text)', fontWeight: 600 }}
            />
            {/* 캡처/헤드리스 환경에서 rAF 클록이 얼면 마운트 애니메이션 clip이 프레임 0에 멈춘다 — 정적 렌더 */}
            <Area dataKey="tickets" fill="url(#adminTicketRevenue)" isAnimationActive={false} stroke="var(--mint)" strokeWidth={2} type="monotone" />
            <Area dataKey="goods" fill="url(#adminGoodsRevenue)" isAnimationActive={false} stroke="var(--violet)" strokeWidth={2} type="monotone" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
