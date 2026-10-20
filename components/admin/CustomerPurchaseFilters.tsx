'use client';

import { useState, type MouseEvent } from 'react';
import { customerPurchaseHref, customerPurchaseLatestPeriod, customerPurchasePreviousPeriod, type CustomerPurchaseFilters as Filters, type CustomerPurchaseGrain } from '@/lib/admin/customer-purchase-report';

export function CustomerPurchaseFilters({ filters, now }: { filters: Filters; now: string }) {
  const [grain, setGrain] = useState(filters.grain);
  const [from, setFrom] = useState(filters.from); const [to, setTo] = useState(filters.to);
  const [compare, setCompare] = useState(filters.compare);
  const [compareFrom, setCompareFrom] = useState(filters.compareFrom); const [compareTo, setCompareTo] = useState(filters.compareTo);
  const latest = customerPurchaseLatestPeriod(grain, new Date(now));
  function chooseGrain(next: CustomerPurchaseGrain) {
    const range = customerPurchaseLatestPeriod(next, new Date(now));
    const previous = customerPurchasePreviousPeriod(range.from, range.to, next);
    setGrain(next); setFrom(range.from); setTo(range.to); setCompareFrom(previous.from); setCompareTo(previous.to);
  }
  function previous(event: MouseEvent<HTMLButtonElement>) {
    // Native date controls can commit on blur. Use the same current form values
    // that submission will send, including a change immediately before this click.
    const form = event.currentTarget.form;
    const values = form ? new FormData(form) : null;
    const currentFrom = String(values?.get('from') ?? from);
    const currentTo = String(values?.get('to') ?? to);
    const range = customerPurchasePreviousPeriod(currentFrom, currentTo, grain);
    setFrom(currentFrom); setTo(currentTo);
    setCompareFrom(range.from); setCompareTo(range.to);
  }
  return <div className="admin-stats-controls">
    <form method="get" action="/admin/stats/customers">
      <input type="hidden" name="view" value="purchase" />
      <div className="admin-stats-range-row"><span>조회 기간</span>
        <label>단위<select name="grain" value={grain} onChange={e => chooseGrain(e.target.value as CustomerPurchaseGrain)}><option value="week">주간</option><option value="month">월간</option></select></label>
        <label>시작일<input name="from" type="date" min="2010-01-01" max={latest.to} required value={from} onInput={e => setFrom(e.currentTarget.value)} onChange={e => setFrom(e.target.value)} /></label>
        <span>~</span><label>종료일<input name="to" type="date" min="2010-01-01" max={latest.to} required value={to} onInput={e => setTo(e.currentTarget.value)} onChange={e => setTo(e.target.value)} /></label>
      </div>
      <div className="admin-stats-range-row"><span>비교 기간</span>
        <label><input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} />비교하기</label>
        <input type="hidden" name="compare" value={compare ? 'on' : 'off'} />
        {compare ? <><label>비교 시작일<input name="compareFrom" type="date" min="2010-01-01" max={latest.to} required value={compareFrom} onInput={e => setCompareFrom(e.currentTarget.value)} onChange={e => setCompareFrom(e.target.value)} /></label>
          <span>~</span><label>비교 종료일<input name="compareTo" type="date" min="2010-01-01" max={latest.to} required value={compareTo} onInput={e => setCompareTo(e.currentTarget.value)} onChange={e => setCompareTo(e.target.value)} /></label>
          <button type="button" className="wc-admin-kit__button" onClick={previous}>직전 동일 기간</button></> : null}
      </div>
      <div className="admin-stats-range-note"><p>한국시간 기준 · 마감된 월요일~일요일 / 월 첫날~말일 · 각 기간 최대 366일</p>
        <button type="submit" className="wc-admin-kit__button wc-admin-kit__button--primary">조회</button>
        <a className="wc-admin-kit__button" href="/admin/stats/customers?view=purchase">초기화</a></div>
    </form>
    <div className="admin-stats-range-note"><p>기간·단위 변경 후 조회하면 결과에 적용됩니다.</p>
      {!filters.error ? <a className="wc-admin-kit__button" href={customerPurchaseHref(filters, '/api/admin/customer-purchase-workbook')}>엑셀 다운로드</a> : null}</div>
    {filters.error ? <p className="admin-note" role="alert">{filters.error}</p> : null}
  </div>;
}
