'use client';
import { useId, useState } from 'react';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { customerPurchaseLatestPeriod, type CustomerPurchaseGrain } from '@/lib/admin/customer-purchase-report';
import type { DemographicFilters, DemographicScope } from '@/lib/admin/customer-demographics';

const LABEL = 'text-sm leading-none font-medium';

export function CustomerDemographicFilters({ filters, now }: { filters: DemographicFilters; now: string }) {
  const [scope, setScope] = useState(filters.scope), [grain, setGrain] = useState(filters.grain);
  const [from, setFrom] = useState(filters.from), [to, setTo] = useState(filters.to);
  const id = useId();
  const purchases = scope === 'purchasers';
  const latest = customerPurchaseLatestPeriod(grain, new Date(now));
  function chooseGrain(next: CustomerPurchaseGrain) {
    const range = customerPurchaseLatestPeriod(next, new Date(now));
    setGrain(next); setFrom(range.from); setTo(range.to);
  }
  return <form action="/admin/stats/customers" className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border bg-card p-4 text-card-foreground" data-demographic-filters="" method="get">
    <input type="hidden" name="view" value="demographics" />
    <div className="flex min-w-0 flex-col gap-1.5"><label className={LABEL} htmlFor={`${id}-scope`}>고객 범위</label><NativeSelect aria-label="고객 범위" id={`${id}-scope`} name="scope" value={scope} onChange={event => setScope(event.target.value as DemographicScope)}><option value="members">현재 가입 회원</option><option value="purchasers">기간 내 결제 고객</option></NativeSelect></div>
    <div className="flex min-w-0 flex-col gap-1.5"><label className={LABEL} htmlFor={`${id}-grain`}>결제 집계 단위</label><NativeSelect aria-label="결제 집계 단위" id={`${id}-grain`} name="grain" disabled={!purchases} value={grain} onChange={event => chooseGrain(event.target.value as CustomerPurchaseGrain)}><option value="month">월간</option><option value="week">주간</option></NativeSelect></div>
    <div className="flex min-w-0 flex-col gap-1.5"><label className={LABEL} htmlFor={`${id}-from`}>결제 시작일</label><Input className="w-40" id={`${id}-from`} type="date" name="from" disabled={!purchases} min="2010-01-01" max={latest.to} value={from} onChange={event => setFrom(event.target.value)} required={purchases} /></div>
    <div className="flex min-w-0 flex-col gap-1.5"><label className={LABEL} htmlFor={`${id}-to`}>결제 종료일</label><Input className="w-40" id={`${id}-to`} type="date" name="to" disabled={!purchases} min="2010-01-01" max={latest.to} value={to} onChange={event => setTo(event.target.value)} required={purchases} /></div>
    <button className={buttonVariants()} data-slot="button" type="submit">조회</button>
  </form>;
}
