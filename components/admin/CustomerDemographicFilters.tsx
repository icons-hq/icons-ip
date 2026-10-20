'use client';
import { useState } from 'react';
import { customerPurchaseLatestPeriod, type CustomerPurchaseGrain } from '@/lib/admin/customer-purchase-report';
import type { DemographicFilters, DemographicScope } from '@/lib/admin/customer-demographics';

export function CustomerDemographicFilters({ filters, now }: { filters: DemographicFilters; now: string }) {
  const [scope, setScope] = useState(filters.scope), [grain, setGrain] = useState(filters.grain);
  const [from, setFrom] = useState(filters.from), [to, setTo] = useState(filters.to);
  const purchases = scope === 'purchasers';
  const latest = customerPurchaseLatestPeriod(grain, new Date(now));
  function chooseGrain(next: CustomerPurchaseGrain) {
    const range = customerPurchaseLatestPeriod(next, new Date(now));
    setGrain(next); setFrom(range.from); setTo(range.to);
  }
  return <form className="admin-customer-demographics__filters" method="get" action="/admin/stats/customers">
    <input type="hidden" name="view" value="demographics" />
    <label>고객 범위<select aria-label="고객 범위" name="scope" value={scope} onChange={event => setScope(event.target.value as DemographicScope)}><option value="members">현재 가입 회원</option><option value="purchasers">기간 내 결제 고객</option></select></label>
    <label>결제 집계 단위<select aria-label="결제 집계 단위" name="grain" disabled={!purchases} value={grain} onChange={event => chooseGrain(event.target.value as CustomerPurchaseGrain)}><option value="month">월간</option><option value="week">주간</option></select></label>
    <label>결제 시작일<input type="date" name="from" disabled={!purchases} min="2010-01-01" max={latest.to} value={from} onChange={event => setFrom(event.target.value)} required={purchases} /></label>
    <label>결제 종료일<input type="date" name="to" disabled={!purchases} min="2010-01-01" max={latest.to} value={to} onChange={event => setTo(event.target.value)} required={purchases} /></label>
    <button className="wc-admin-kit__button wc-admin-kit__button--primary" type="submit">조회</button>
  </form>;
}
