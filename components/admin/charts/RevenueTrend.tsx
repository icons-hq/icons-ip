'use client';

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AdminDailyRevenue } from '@/lib/admin/insights.server';
import { Card, CardAction, CardContent, CardDescription, CardHeader } from '@/components/admin/kit/ui/card';
import { formatKrw } from '../format';
import { CHART_AXIS_TICK, CHART_GRID_STROKE, CHART_TOOLTIP_STYLE } from './chart-theme';

/* 상품·티켓은 비교가 아니라 범주다 — 범주색을 앞번호부터 쓰고 범례·툴팁이 이름을 붙인다(ADR-0029). */
const GOODS_COLOR = 'var(--chart-1)';
const TICKETS_COLOR = 'var(--chart-2)';

function dayLabel(date: string) {
  const [, month, day] = date.split('-');
  return `${Number(month)}.${Number(day)}`;
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground">
      <span aria-hidden="true" className="size-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}

export function RevenueTrend({ data, days = 30 }: { data: AdminDailyRevenue[]; days?: number }) {
  const hasRevenue = data.some(day => day.goods !== 0 || day.tickets !== 0);
  return (
    <Card className="min-w-0">
      <CardHeader>
        <h3 className="text-base leading-snug font-medium">매출 추이</h3>
        <CardDescription>최근 {days}일 · 결제 완료 기준</CardDescription>
        <CardAction className="flex flex-wrap items-center gap-3 pt-0.5">
          <LegendDot color={GOODS_COLOR} label="상품" />
          <LegendDot color={TICKETS_COLOR} label="티켓" />
        </CardAction>
      </CardHeader>
      <CardContent>
        {hasRevenue ? <div className="h-60 w-full min-w-0 sm:h-72">
          <ResponsiveContainer height="100%" width="100%">
            <AreaChart data={data} margin={{ bottom: 0, left: 0, right: 8, top: 8 }}>
              <defs>
                <linearGradient id="adminGoodsRevenue" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={GOODS_COLOR} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={GOODS_COLOR} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="adminTicketRevenue" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={TICKETS_COLOR} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={TICKETS_COLOR} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={CHART_GRID_STROKE} strokeDasharray="3 3" vertical={false} />
              <XAxis
                axisLine={false}
                dataKey="date"
                dy={8}
                minTickGap={28}
                tick={CHART_AXIS_TICK}
                tickFormatter={dayLabel}
                tickLine={false}
              />
              <YAxis
                axisLine={false}
                dx={-6}
                tick={CHART_AXIS_TICK}
                tickFormatter={(value: number) => (value ? formatKrw(value) : '0')}
                tickLine={false}
                width={64}
              />
              <Tooltip
                contentStyle={CHART_TOOLTIP_STYLE.content}
                formatter={(value, name) => [formatKrw(Number(value)), name === 'goods' ? '상품' : '티켓']}
                itemStyle={CHART_TOOLTIP_STYLE.item}
                labelFormatter={(label) => dayLabel(String(label))}
                labelStyle={CHART_TOOLTIP_STYLE.label}
              />
              {/* 캡처/헤드리스 환경에서 rAF 클록이 얼면 마운트 애니메이션 clip이 프레임 0에 멈춘다 — 정적 렌더 */}
              <Area dataKey="tickets" fill="url(#adminTicketRevenue)" isAnimationActive={false} stroke={TICKETS_COLOR} strokeWidth={2} type="monotone" />
              <Area dataKey="goods" fill="url(#adminGoodsRevenue)" isAnimationActive={false} stroke={GOODS_COLOR} strokeWidth={2} type="monotone" />
            </AreaChart>
          </ResponsiveContainer>
        </div> : <div className="flex min-h-60 flex-col items-center justify-center gap-2 rounded-lg bg-muted/50 p-6 text-center sm:min-h-72" role="status">
          <strong className="text-sm font-medium">최근 {days}일 결제 완료 매출이 없습니다.</strong>
          <p className="text-sm text-muted-foreground">결제가 완료되면 날짜별 매출이 여기에 표시됩니다.</p>
        </div>}
      </CardContent>
    </Card>
  );
}
