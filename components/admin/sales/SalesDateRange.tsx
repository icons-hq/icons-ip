'use client';

import { useState } from 'react';
import { consoleDatePresets, isConsoleDateRangeActive } from '@/components/admin/console/date-presets';
import { Input } from '@/components/admin/kit/ui/input';

/* 기간 프리셋은 kit 조회 조건의 구분 선택 모양(ConsoleFilterPanel과 같다)이고, 링크가 아니라 입력값만 고친다. */
const PRESET_CLASS = 'inline-flex h-7 items-center rounded-md px-2 text-[0.8rem] font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-[pressed=true]:bg-background aria-[pressed=true]:text-foreground aria-[pressed=true]:shadow-sm';

/** Presets edit the current form, so an unsubmitted date basis/search value is never discarded. */
export function SalesDateRange({ id, from, to, now }: { id: string; from: string | null; to: string | null; now?: Date }) {
  const [range, setRange] = useState({ from: from ?? '', to: to ?? '' });
  const presets = consoleDatePresets(['today', 'week', 'month', 'quarter'], now);
  const invalid = Boolean(range.from && range.to && range.from > range.to);
  const errorId = `${id}-range-error`;
  return <>
    <div className="inline-flex rounded-lg bg-muted p-0.5" data-sales-date-presets="" role="group" aria-label="조회기간 빠른 선택">
      {presets.map((preset) => <button className={PRESET_CLASS} data-slot="button" type="button" key={preset.id}
        aria-pressed={isConsoleDateRangeActive(preset.range, range)}
        onClick={() => setRange(preset.range)}>{preset.label}</button>)}
    </div>
    <div className="flex flex-wrap items-center gap-1.5">
      {/* 말풍선 대신 아래 빨간 문구 하나로 알린다. 제약이 남아 있어 잘못된 기간은 제출되지 않는다. */}
      <Input className="w-32" aria-label="시작일" aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined}
        id={`${id}-from`} name="from" type="date" max={range.to || undefined} value={range.from} onChange={event => setRange({ ...range, from: event.target.value })} onInvalid={event => event.preventDefault()} />
      <span aria-hidden="true" className="text-muted-foreground">~</span>
      <Input className="w-32" aria-label="종료일" aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined}
        id={`${id}-to`} name="to" type="date" min={range.from || undefined} value={range.to} onChange={event => setRange({ ...range, to: event.target.value })} onInvalid={event => event.preventDefault()} />
    </div>
    {invalid ? <small className="basis-full text-xs text-destructive" id={errorId} role="alert">시작일은 종료일보다 늦을 수 없습니다.</small> : null}
  </>;
}
