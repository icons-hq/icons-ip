'use client';

import { useState } from 'react';
import { consoleDatePresets, isConsoleDateRangeActive } from '@/components/admin/console/date-presets';

/** Presets edit the current form, so an unsubmitted date basis/search value is never discarded. */
export function SalesDateRange({ id, from, to, now }: { id: string; from: string | null; to: string | null; now?: Date }) {
  const [range, setRange] = useState({ from: from ?? '', to: to ?? '' });
  const presets = consoleDatePresets(['today', 'week', 'month', 'quarter'], now);
  const invalid = Boolean(range.from && range.to && range.from > range.to);
  const errorId = `${id}-range-error`;
  return <>
    <div className="admin-sales-date-presets" aria-label="조회기간 빠른 선택">
      {presets.map((preset) => <button type="button" key={preset.id}
        aria-pressed={isConsoleDateRangeActive(preset.range, range)}
        onClick={() => setRange(preset.range)}>{preset.label}</button>)}
    </div>
    <div className="admin-sales-date-range">
      <input aria-label="시작일" aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined}
        id={`${id}-from`} name="from" type="date" max={range.to || undefined} value={range.from} onChange={event => setRange({ ...range, from: event.target.value })} />
      <span aria-hidden="true">~</span>
      <input aria-label="종료일" aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined}
        id={`${id}-to`} name="to" type="date" min={range.from || undefined} value={range.to} onChange={event => setRange({ ...range, to: event.target.value })} />
    </div>
    {invalid ? <small className="wc-admin-kit__error" id={errorId} role="alert">시작일은 종료일보다 늦을 수 없습니다.</small> : null}
  </>;
}
