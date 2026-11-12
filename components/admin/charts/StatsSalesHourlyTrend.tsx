'use client';

import { useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ConsoleGrid, type ConsoleGridColumn } from '@/components/admin/console';
import { adminSalesHourRange, adminSalesHourState, adminSalesHourlyTime, type AdminSalesHourlyReport } from '@/lib/admin/stats-hourly';
import { krw } from '@/lib/format';
import { STATS_SEGMENTED, STATS_SEGMENT_BUTTON, statsDateLabel } from '../StatsSummary';
import { CHART_AXIS_TICK, CHART_COMPARISON, CHART_CURRENT, CHART_GRID_STROKE, CHART_TOOLTIP_STYLE } from './chart-theme';

const columns: ConsoleGridColumn[] = [
  { key: 'hour', label: '시간대(KST)', width: '150px' }, { key: 'state', label: '집계 상태', width: '110px' },
  { key: 'orders', label: '오늘 주문수', width: '130px', align: 'end' }, { key: 'revenue', label: '오늘 주문매출', width: '150px', align: 'end' },
  { key: 'comparisonOrders', label: '비교일 주문수', width: '130px', align: 'end' }, { key: 'comparisonRevenue', label: '비교일 주문매출', width: '150px', align: 'end' },
];
const count = (value: number | null) => value === null ? '—' : `${value.toLocaleString('ko-KR')}건`;
const money = (value: number | null) => value === null ? '—' : krw(value);
const CARD = 'min-w-0 rounded-xl border bg-card text-card-foreground';
const CARD_HEADER = 'flex flex-wrap items-center gap-3 border-b px-4 py-3';
const CARD_NOTE = 'px-4 py-3 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]';

export function StatsSalesHourlyTrend({ report }: { report: AdminSalesHourlyReport }) {
  const [mode, setMode] = useState<'hourly' | 'cumulative'>('hourly');
  const [metric, setMetric] = useState<'revenue' | 'orderCount'>('revenue');
  const [ranking, setRanking] = useState<'today' | 'lastHour'>('today');
  const cumulative = mode === 'cumulative';
  const rows = report.hours.map(row => ({ ...row, label: `${String(row.hour).padStart(2, '0')}시`,
    current: metric === 'revenue' ? cumulative ? row.cumulativeRevenue : row.revenue : cumulative ? row.cumulativeOrderCount : row.orderCount,
    comparison: metric === 'revenue' ? cumulative ? row.comparisonCumulativeRevenue : row.comparisonRevenue : cumulative ? row.comparisonCumulativeOrderCount : row.comparisonOrderCount,
  }));
  const goods = ranking === 'today' ? report.todayGoods : report.lastHourGoods;
  const currentFrom = ranking === 'today' ? `${report.date} 00:00:00` : adminSalesHourlyTime(report.lastHourFrom);
  const comparisonFrom = ranking === 'today' ? `${report.comparisonDate} 00:00:00` : adminSalesHourlyTime(report.comparisonLastHourFrom);
  return <>
    <section aria-label="시간대별 판매 추이" className={CARD} data-stats-trend="hourly">
      <header className={CARD_HEADER}><h2 className="mr-auto text-base font-medium">오늘과 비교일의 판매 추이</h2>
        <div aria-label="시간대 차트 지표" className={STATS_SEGMENTED} role="group"><button aria-pressed={metric === 'revenue'} className={STATS_SEGMENT_BUTTON} onClick={() => setMetric('revenue')} type="button">주문매출</button><button aria-pressed={metric === 'orderCount'} className={STATS_SEGMENT_BUTTON} onClick={() => setMetric('orderCount')} type="button">주문수</button></div>
        <div aria-label="시간대 표시 방식" className={STATS_SEGMENTED} role="group"><button aria-pressed={!cumulative} className={STATS_SEGMENT_BUTTON} onClick={() => setMode('hourly')} type="button">시간대별</button><button aria-pressed={cumulative} className={STATS_SEGMENT_BUTTON} onClick={() => setMode('cumulative')} type="button">누적</button></div>
      </header>
      {report.completedHours === 0 ? <p className={`${CARD_NOTE} border-b`}>집계 마감까지 완료된 시간대가 없습니다. 최신 현황을 조회해주세요.</p> : null}
      <div aria-label="시간대별 판매 추이 차트. 같은 값은 아래 시간대별 판매 표에서 읽을 수 있습니다." className="h-64 px-2 pt-4 pb-1 sm:h-80 sm:px-3" role="img"><ResponsiveContainer width="100%" height="100%"><LineChart accessibilityLayer={false} data={rows} margin={{ top: 12, right: 20, bottom: 10, left: 10 }}>
        <CartesianGrid stroke={CHART_GRID_STROKE} vertical={false} />
        <XAxis axisLine={{ stroke: CHART_GRID_STROKE }} dataKey="label" tick={CHART_AXIS_TICK} tickLine={false} minTickGap={24} />
        <YAxis tick={CHART_AXIS_TICK} tickFormatter={value => metric === 'revenue' ? krw(Number(value)) : `${Number(value).toLocaleString('ko-KR')}건`} width={92} axisLine={false} tickLine={false} />
        <Tooltip formatter={(value, name) => [value === undefined || value === null ? '미집계' : metric === 'revenue' ? krw(Number(value)) : `${Number(value).toLocaleString('ko-KR')}건`, name]} contentStyle={CHART_TOOLTIP_STYLE.content} itemStyle={CHART_TOOLTIP_STYLE.item} labelStyle={CHART_TOOLTIP_STYLE.label} />
        <Legend formatter={(value) => <span style={{ color: 'var(--muted-foreground)' }}>{value}</span>} wrapperStyle={{ fontSize: 12 }} />
        <Line name={`오늘 ${statsDateLabel(report.date)}`} dataKey="current" stroke={CHART_CURRENT} strokeWidth={2} dot connectNulls={false} isAnimationActive={false} />
        <Line name={`비교일 ${statsDateLabel(report.comparisonDate)}`} dataKey="comparison" stroke={CHART_COMPARISON} strokeWidth={2} strokeDasharray="5 4" dot connectNulls={false} isAnimationActive={false} />
      </LineChart></ResponsiveContainer></div>
      <p className={`${CARD_NOTE} border-t`}>{cumulative ? '누적값은 완료된 시간대만 합산합니다. ' : ''}집계 마감 이후 값은 아직 관측하지 않았으며, 주문이 없었던 완료 시간의 0과 구분합니다.</p>
    </section>
    <section aria-label="시간대별 판매 표" className="min-w-0">
      <ConsoleGrid caption={cumulative ? '시간대별 누적 판매' : '시간대별 판매'} className="[&_table]:min-w-[51rem]" preferencesKey="stats-sales-hourly" columns={columns}
        rows={report.hours.map(row => ({ id: String(row.hour), cells: [adminSalesHourRange(row.hour), adminSalesHourState(row.hour, report),
          count(cumulative ? row.cumulativeOrderCount : row.orderCount), money(cumulative ? row.cumulativeRevenue : row.revenue),
          count(cumulative ? row.comparisonCumulativeOrderCount : row.comparisonOrderCount), money(cumulative ? row.comparisonCumulativeRevenue : row.comparisonRevenue)] }))} />
    </section>
    <section aria-label="상품별 금액 TOP10" className={CARD} data-stats-ranking="">
      <header className={CARD_HEADER}><h2 className="mr-auto text-base font-medium">상품별 금액 TOP10</h2><div aria-label="상품 순위 시간 범위" className={STATS_SEGMENTED} role="group"><button aria-pressed={ranking === 'today'} className={STATS_SEGMENT_BUTTON} onClick={() => setRanking('today')} type="button">오늘</button><button aria-pressed={ranking === 'lastHour'} className={STATS_SEGMENT_BUTTON} onClick={() => setRanking('lastHour')} type="button">직전 1시간</button></div></header>
      <div className={CARD_NOTE}>{ranking === 'today' && report.completedHours === 0 ? <p>오늘과 비교일에 같은 기준으로 집계할 완료 시간 구간이 없습니다.</p> : <><p>조회 구간(KST): {currentFrom} ~ {adminSalesHourlyTime(report.cutoff)} 직전</p><p>비교 구간(KST): {comparisonFrom} ~ {adminSalesHourlyTime(report.comparisonCutoff)} 직전</p></>}<p>IP 조건: {report.ipId || '전체'} · 이 상품 순위에만 적용됩니다. 상품금액은 수량×단가−복수구매 할인이며 주문매출과 다릅니다. 순위는 현재 구간 기준이고 비교값은 같은 상품입니다.</p></div>
      <div className="px-4 pb-4">
        <ConsoleGrid caption="상품별 금액 TOP10" className="[&_table]:min-w-[69rem]" preferencesKey="stats-sales-hourly-goods" columns={[
          { key: 'rank', label: '순위', width: '70px' }, { key: 'good', label: '상품·판매자상품코드', width: '260px' }, { key: 'ip', label: '주문 당시 IP', width: '160px' },
          { key: 'qty', label: '판매수량', width: '110px', align: 'end' }, { key: 'revenue', label: '상품금액', width: '150px', align: 'end' },
          { key: 'comparisonQty', label: '비교일 수량', width: '110px', align: 'end' }, { key: 'comparisonRevenue', label: '비교일 상품금액', width: '150px', align: 'end' },
        ]} rows={goods.map(row => ({ id: row.goodId, cells: [row.rank, <span className="flex flex-col" key="good">{row.name}<small className="mt-0.5 text-xs text-muted-foreground">{row.goodId}</small></span>, row.ipId, row.qty.toLocaleString('ko-KR'), krw(row.revenue), row.comparisonQty.toLocaleString('ko-KR'), krw(row.comparisonRevenue)] }))}
          emptyLabel={ranking === 'today' && !report.completedHours ? '집계 마감까지 완료된 시간대가 없습니다.' : '이 구간과 IP 조건에 집계된 상품이 없습니다.'} />
      </div>
    </section>
  </>;
}
