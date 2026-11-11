'use client';

import { useState } from 'react';
import { AdminSelect } from '@/components/admin/console/AdminSelect';
import { CUSTOMER_PURCHASE_METRIC_LABEL, customerPurchaseValue, type CustomerPurchaseGrain, type CustomerPurchaseMetric, type CustomerPurchasePeriod, type CustomerPurchaseRow } from '@/lib/admin/customer-purchase-report';

/* 범주색은 --chart-1부터 표시 순서대로 쓴다(신규·재구매는 비교 계열이 아니라 두 범주다, ADR-0029). 범례 칸이 같은 색을 보여 주고, 정확한 값은 막대 제목과 데이터 표에 있다. */
const BAR_CLASS = { new: 'relative w-[42%] rounded-t-sm bg-chart-1', repeat: 'relative w-[42%] rounded-t-sm bg-chart-2' } as const;
const SWATCH_CLASS = { new: 'size-2.5 shrink-0 rounded-sm bg-chart-1', repeat: 'size-2.5 shrink-0 rounded-sm bg-chart-2' } as const;

/** Grouped bars keep overlapping customer counts separate. Every value is also in the table. */
export function CustomerPurchaseTrend({ periods, grain }: { periods: CustomerPurchasePeriod[]; grain: CustomerPurchaseGrain }) {
  const [metric, setMetric] = useState<CustomerPurchaseMetric>('customerCount');
  const [newVisible, setNewVisible] = useState(true); const [repeatVisible, setRepeatVisible] = useState(true);
  const max = Math.max(1, ...periods.flatMap(p => p.rows.filter(r => r.group !== 'all').map(r => r[metric] ?? 0)));
  const unit = metric === 'customerCount' ? '명' : metric === 'orderCount' ? '건' : '원';
  const label = (period: CustomerPurchasePeriod, row: CustomerPurchaseRow) => `${period.from} ~ ${period.to} ${row.group === 'new' ? '신규' : '재구매'} ${row[metric] === null ? row.monetaryIssueOrderCount > 0 ? '금액 확인 필요' : '결제고객 없음' : `${customerPurchaseValue(row[metric], 2)}${unit}`}`;
  const trendLabel = grain === 'week' ? '최근 13주 주간 추이' : '최근 13개월 월간 추이';
  return <section className="flex min-w-0 flex-col rounded-xl border bg-card text-card-foreground" data-grain={grain} aria-label={trendLabel}>
    <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3"><h3 className="text-base font-semibold text-foreground">신규/재구매 · {trendLabel}</h3>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-sm">분석 지표 <AdminSelect value={metric} onChange={e => setMetric(e.target.value as CustomerPurchaseMetric)} wrapperClassName="w-40">{Object.entries(CUSTOMER_PURCHASE_METRIC_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</AdminSelect></label>
        <div className="flex gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" checked={newVisible} onChange={e => setNewVisible(e.target.checked)} /><span aria-hidden="true" className={SWATCH_CLASS.new} />신규</label><label className="flex items-center gap-2"><input type="checkbox" checked={repeatVisible} onChange={e => setRepeatVisible(e.target.checked)} /><span aria-hidden="true" className={SWATCH_CLASS.repeat} />재구매</label></div>
      </div>
    </header>
    <div className="max-w-full overflow-x-auto px-5 pt-7 pb-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50" tabIndex={0} role="region" aria-label={`${CUSTOMER_PURCHASE_METRIC_LABEL[metric]} 차트, 가로 스크롤 가능`}>
      <div className={grain === 'week' ? 'flex h-60 min-w-220 gap-4.5' : 'flex h-60 min-w-180 gap-4.5'}>{periods.map(period => <div className="flex min-w-9 flex-1 flex-col justify-end gap-2.5 text-center text-xs text-muted-foreground" key={period.from}>
        <div className="flex h-52.5 items-end justify-center gap-0.75 border-b">{period.rows.filter(row => (row.group === 'new' && newVisible) || (row.group === 'repeat' && repeatVisible)).map(row => <div key={row.group} className={row.group === 'new' ? BAR_CLASS.new : BAR_CLASS.repeat} style={{ height: `${row[metric] === null ? 0 : Math.max(0, row[metric] / max * 100)}%` }} title={label(period, row)}><span className="sr-only">{label(period, row)}</span></div>)}</div>
        <span className="tabular-nums">{period.from.slice(2, grain === 'week' ? 10 : 7).replaceAll('-', '.')}</span>
      </div>)}</div>
    </div>
    <p className="px-5 pb-4 text-xs leading-relaxed text-muted-foreground">조회 종료일을 기준으로 마감된 13개 {grain === 'week' ? '주를' : '월을'} 표시합니다. 막대의 정확한 값은 아래 데이터 표에서 확인할 수 있습니다. 금액 미확인 또는 결제고객이 없어 계산할 수 없는 값은 막대에서 제외합니다.</p>
  </section>;
}
