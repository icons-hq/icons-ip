'use client';

import { useState } from 'react';
import { CUSTOMER_PURCHASE_METRIC_LABEL, customerPurchaseValue, type CustomerPurchaseGrain, type CustomerPurchaseMetric, type CustomerPurchasePeriod, type CustomerPurchaseRow } from '@/lib/admin/customer-purchase-report';

/** Grouped bars keep overlapping customer counts separate. Every value is also in the table. */
export function CustomerPurchaseTrend({ periods, grain }: { periods: CustomerPurchasePeriod[]; grain: CustomerPurchaseGrain }) {
  const [metric, setMetric] = useState<CustomerPurchaseMetric>('customerCount');
  const [newVisible, setNewVisible] = useState(true); const [repeatVisible, setRepeatVisible] = useState(true);
  const max = Math.max(1, ...periods.flatMap(p => p.rows.filter(r => r.group !== 'all').map(r => r[metric] ?? 0)));
  const unit = metric === 'customerCount' ? '명' : metric === 'orderCount' ? '건' : '원';
  const label = (period: CustomerPurchasePeriod, row: CustomerPurchaseRow) => `${period.from} ~ ${period.to} ${row.group === 'new' ? '신규' : '재구매'} ${row[metric] === null ? row.monetaryIssueOrderCount > 0 ? '금액 확인 필요' : '결제고객 없음' : `${customerPurchaseValue(row[metric], 2)}${unit}`}`;
  const trendLabel = grain === 'week' ? '최근 13주 주간 추이' : '최근 13개월 월간 추이';
  return <section className="admin-stats-trend admin-customer-purchase-trend" data-grain={grain} aria-label={trendLabel}>
    <header><h3>신규/재구매 · {trendLabel}</h3>
      <label>분석 지표 <select value={metric} onChange={e => setMetric(e.target.value as CustomerPurchaseMetric)}>{Object.entries(CUSTOMER_PURCHASE_METRIC_LABEL).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <div className="admin-customer-purchase-legend"><label><input type="checkbox" checked={newVisible} onChange={e => setNewVisible(e.target.checked)} />신규</label><label><input type="checkbox" checked={repeatVisible} onChange={e => setRepeatVisible(e.target.checked)} />재구매</label></div>
    </header>
    <div className="admin-customer-purchase-chart" tabIndex={0} role="region" aria-label={`${CUSTOMER_PURCHASE_METRIC_LABEL[metric]} 차트, 가로 스크롤 가능`}>
      <div className="admin-customer-purchase-bars">{periods.map(period => <div className="admin-customer-purchase-month" key={period.from}>
        <div className="admin-customer-purchase-pair">{period.rows.filter(row => (row.group === 'new' && newVisible) || (row.group === 'repeat' && repeatVisible)).map(row => <div key={row.group} className={`admin-customer-purchase-bar ${row.group}`} style={{ height: `${row[metric] === null ? 0 : Math.max(0, row[metric] / max * 100)}%` }} title={label(period, row)}><span className="sr-only">{label(period, row)}</span></div>)}</div>
        <span>{period.from.slice(2, grain === 'week' ? 10 : 7).replaceAll('-', '.')}</span>
      </div>)}</div>
    </div>
    <p className="admin-note">조회 종료일을 기준으로 마감된 13개 {grain === 'week' ? '주를' : '월을'} 표시합니다. 막대의 정확한 값은 아래 데이터 표에서 확인할 수 있습니다. 금액 미확인 또는 결제고객이 없어 계산할 수 없는 값은 막대에서 제외합니다.</p>
  </section>;
}
