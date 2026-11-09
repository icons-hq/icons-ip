'use client';

import { useState, type MouseEvent } from 'react';
import { Download } from 'lucide-react';
import { AdminSelect } from '@/components/admin/console/AdminSelect';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { FIELD_LABEL_CLASS, KIT_INPUT_CLASS } from '@/components/admin/screens/cs-kit-classes';
import { customerPurchaseHref, customerPurchaseLatestPeriod, customerPurchasePreviousPeriod, type CustomerPurchaseFilters as Filters, type CustomerPurchaseGrain } from '@/lib/admin/customer-purchase-report';

const ROW_CLASS = 'flex flex-wrap items-end gap-x-3 gap-y-3';
const ROW_TITLE_CLASS = 'w-full text-sm font-medium text-foreground sm:w-24 sm:self-center';
const LABEL_CLASS = 'flex min-w-0 flex-col gap-1.5';
const DATE_CLASS = `${KIT_INPUT_CLASS} w-40 max-w-full`;

/* 템플릿 룩(ADR-0028). 날짜 입력은 네이티브 그대로다 — 비교 토글 직전에 바뀐 값(onInput)과 제출 값이 같아야 한다. */
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
  return <div className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground" data-customer-purchase-filters="">
    <form className="flex flex-col gap-3" method="get" action="/admin/stats/customers">
      <input type="hidden" name="view" value="purchase" />
      <div className={ROW_CLASS}><span className={ROW_TITLE_CLASS}>조회 기간</span>
        <label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>단위</span><AdminSelect name="grain" value={grain} onChange={e => chooseGrain(e.target.value as CustomerPurchaseGrain)} wrapperClassName="w-28"><option value="week">주간</option><option value="month">월간</option></AdminSelect></label>
        <label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>시작일</span><input className={DATE_CLASS} data-slot="input" name="from" type="date" min="2010-01-01" max={latest.to} required value={from} onInput={e => setFrom(e.currentTarget.value)} onChange={e => setFrom(e.target.value)} /></label>
        <span aria-hidden="true" className="pb-1.5 text-muted-foreground">~</span><label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>종료일</span><input className={DATE_CLASS} data-slot="input" name="to" type="date" min="2010-01-01" max={latest.to} required value={to} onInput={e => setTo(e.currentTarget.value)} onChange={e => setTo(e.target.value)} /></label>
      </div>
      <div className={`${ROW_CLASS} border-t pt-3`}><span className={ROW_TITLE_CLASS}>비교 기간</span>
        <label className="flex h-8 items-center gap-2 text-sm"><input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} />비교하기</label>
        <input type="hidden" name="compare" value={compare ? 'on' : 'off'} />
        {compare ? <><label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>비교 시작일</span><input className={DATE_CLASS} data-slot="input" name="compareFrom" type="date" min="2010-01-01" max={latest.to} required value={compareFrom} onInput={e => setCompareFrom(e.currentTarget.value)} onChange={e => setCompareFrom(e.target.value)} /></label>
          <span aria-hidden="true" className="pb-1.5 text-muted-foreground">~</span><label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>비교 종료일</span><input className={DATE_CLASS} data-slot="input" name="compareTo" type="date" min="2010-01-01" max={latest.to} required value={compareTo} onInput={e => setCompareTo(e.currentTarget.value)} onChange={e => setCompareTo(e.target.value)} /></label>
          <Button onClick={previous} type="button" variant="outline">직전 동일 기간</Button></> : null}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"><p className="text-xs text-muted-foreground">한국시간 기준 · 마감된 월요일~일요일 / 월 첫날~말일 · 각 기간 최대 366일</p>
        <div className="flex gap-2"><a className={buttonVariants({ variant: 'outline' })} data-slot="button" href="/admin/stats/customers?view=purchase">초기화</a>
          <Button type="submit" variant="soft">조회</Button></div></div>
    </form>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"><p className="text-xs text-muted-foreground">기간·단위 변경 후 조회하면 결과에 적용됩니다.</p>
      {!filters.error ? <a className={buttonVariants({ size: 'sm', variant: 'outline' })} data-slot="button" href={customerPurchaseHref(filters, '/api/admin/customer-purchase-workbook')}><Download aria-hidden="true" />엑셀 다운로드</a> : null}</div>
    {filters.error ? <p className="bg-transparent text-sm text-destructive" role="alert">{filters.error}</p> : null}
  </div>;
}
