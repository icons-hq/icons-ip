'use client';

import { useState } from 'react';
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { ConsoleGrid, type ConsoleGridColumn } from '@/components/admin/console';
import { adminSalesHourRange, adminSalesHourState, adminSalesHourlyTime, type AdminSalesHourlyReport } from '@/lib/admin/stats-hourly';
import { krw } from '@/lib/format';

const columns: ConsoleGridColumn[] = [
  { key: 'hour', label: '시간대(KST)', width: '150px' }, { key: 'state', label: '집계 상태', width: '110px' },
  { key: 'orders', label: '오늘 주문수', width: '130px', align: 'end' }, { key: 'revenue', label: '오늘 주문매출', width: '150px', align: 'end' },
  { key: 'comparisonOrders', label: '비교일 주문수', width: '130px', align: 'end' }, { key: 'comparisonRevenue', label: '비교일 주문매출', width: '150px', align: 'end' },
];
const count = (value: number | null) => value === null ? '—' : `${value.toLocaleString('ko-KR')}건`;
const money = (value: number | null) => value === null ? '—' : krw(value);
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
    <section className="admin-stats-trend admin-sales-hourly-trend" aria-label="시간대별 판매 추이">
      <header><h3>오늘과 비교일의 판매 추이</h3>
        <div role="group" aria-label="시간대 차트 지표"><button type="button" aria-pressed={metric === 'revenue'} onClick={() => setMetric('revenue')}>주문매출</button><button type="button" aria-pressed={metric === 'orderCount'} onClick={() => setMetric('orderCount')}>주문수</button></div>
        <div role="group" aria-label="시간대 표시 방식"><button type="button" aria-pressed={!cumulative} onClick={() => setMode('hourly')}>시간대별</button><button type="button" aria-pressed={cumulative} onClick={() => setMode('cumulative')}>누적</button></div>
      </header>
      {report.completedHours === 0 ? <p className="admin-note">집계 마감까지 완료된 시간대가 없습니다. 최신 현황을 조회해주세요.</p> : null}
      <div className="admin-stats-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={rows} margin={{ top: 12, right: 20, bottom: 10, left: 10 }}>
        <CartesianGrid stroke="var(--wc-hairline)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'var(--wc-ink-tertiary)' }} tickLine={false} minTickGap={24} />
        <YAxis tick={{ fontSize: 12, fill: 'var(--wc-ink-tertiary)' }} tickFormatter={value => Number(value).toLocaleString('ko-KR')} width={80} axisLine={false} tickLine={false} />
        <Tooltip formatter={(value, name) => [value === undefined || value === null ? '미집계' : `${Number(value).toLocaleString('ko-KR')}${metric === 'revenue' ? '원' : '건'}`, name]} contentStyle={{ background: 'var(--wc-surface)', border: '1px solid var(--wc-line-control)', borderRadius: 0 }} />
        <Legend />
        <Line name={`오늘 ${report.date}`} dataKey="current" stroke="var(--wc-info)" strokeWidth={2} dot connectNulls={false} isAnimationActive={false} />
        <Line name={`비교일 ${report.comparisonDate}`} dataKey="comparison" stroke="var(--wc-ink-tertiary)" strokeWidth={2} strokeDasharray="5 4" dot connectNulls={false} isAnimationActive={false} />
      </LineChart></ResponsiveContainer></div>
      <p className="admin-note">{cumulative ? '누적값은 완료된 시간대만 합산합니다. ' : ''}집계 마감 이후 값은 아직 관측하지 않았으며, 주문이 없었던 완료 시간의 0과 구분합니다.</p>
    </section>
    <section className="admin-sales-hourly-table" aria-label="시간대별 판매 표">
      <ConsoleGrid caption={cumulative ? '시간대별 누적 판매' : '시간대별 판매'} preferencesKey="stats-sales-hourly" columns={columns}
        rows={report.hours.map(row => ({ id: String(row.hour), cells: [adminSalesHourRange(row.hour), adminSalesHourState(row.hour, report),
          count(cumulative ? row.cumulativeOrderCount : row.orderCount), money(cumulative ? row.cumulativeRevenue : row.revenue),
          count(cumulative ? row.comparisonCumulativeOrderCount : row.comparisonOrderCount), money(cumulative ? row.comparisonCumulativeRevenue : row.comparisonRevenue)] }))} />
    </section>
    <section className="admin-stats-trend admin-sales-hourly-ranking" aria-label="상품별 금액 TOP10">
      <header><h3>상품별 금액 TOP10</h3><div role="group" aria-label="상품 순위 시간 범위"><button type="button" aria-pressed={ranking === 'today'} onClick={() => setRanking('today')}>오늘</button><button type="button" aria-pressed={ranking === 'lastHour'} onClick={() => setRanking('lastHour')}>직전 1시간</button></div></header>
      <div className="admin-sales-hourly-ranking-note">{ranking === 'today' && report.completedHours === 0 ? <p>오늘과 비교일에 같은 기준으로 집계할 완료 시간 구간이 없습니다.</p> : <><p>조회 구간(KST): {currentFrom} ~ {adminSalesHourlyTime(report.cutoff)} 직전</p><p>비교 구간(KST): {comparisonFrom} ~ {adminSalesHourlyTime(report.comparisonCutoff)} 직전</p></>}<p>IP 조건: {report.ipId || '전체'} · 이 상품 순위에만 적용됩니다. 상품금액은 수량×단가−복수구매 할인이며 주문매출과 다릅니다. 순위는 현재 구간 기준이고 비교값은 같은 상품입니다.</p></div>
      <ConsoleGrid caption="상품별 금액 TOP10" preferencesKey="stats-sales-hourly-goods" columns={[
        { key: 'rank', label: '순위', width: '70px' }, { key: 'good', label: '상품·상품코드', width: '260px' }, { key: 'ip', label: '주문 당시 IP', width: '160px' },
        { key: 'qty', label: '판매수량', width: '110px', align: 'end' }, { key: 'revenue', label: '상품금액', width: '150px', align: 'end' },
        { key: 'comparisonQty', label: '비교일 수량', width: '110px', align: 'end' }, { key: 'comparisonRevenue', label: '비교일 상품금액', width: '150px', align: 'end' },
      ]} rows={goods.map(row => ({ id: row.goodId, cells: [row.rank, <span key="good">{row.name}<small>{row.goodId}</small></span>, row.ipId, row.qty.toLocaleString('ko-KR'), krw(row.revenue), row.comparisonQty.toLocaleString('ko-KR'), krw(row.comparisonRevenue)] }))}
        emptyLabel={ranking === 'today' && !report.completedHours ? '집계 마감까지 완료된 시간대가 없습니다.' : '이 구간과 IP 조건에 집계된 상품이 없습니다.'} />
    </section>
  </>;
}
