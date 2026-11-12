'use client';

import { useState } from 'react';
import { consoleDatePresets, isConsoleDateRangeActive } from '../console/date-presets';
import { Input } from '../kit/ui/input';

const PRESET = 'inline-flex h-7 items-center rounded-md px-2.5 text-[0.8rem] font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:bg-background aria-pressed:text-primary-soft-foreground aria-pressed:shadow-sm';

/**
 * 상품 조회 조건의 기간 빠른 선택·날짜 칸. 빠른 선택은 링크가 아니라 날짜 칸만 채운다 — 조건을 바꾸는 것만으로
 * 조회하지 않고 [검색]을 눌러야 조회된다(ADM-016 #13). `전체`는 기간을 비운다.
 */
export function GoodsListDateRange({ from, to }: { from: string | null | undefined; to: string | null | undefined }) {
  const [range, setRange] = useState({ from: from ?? '', to: to ?? '' });
  return <>
    <div aria-label="조회기간 빠른 선택" className="inline-flex flex-wrap rounded-lg bg-muted p-0.5" role="group">
      {consoleDatePresets().map(preset => <button aria-pressed={isConsoleDateRangeActive(preset.range, range)} className={PRESET} data-slot="button" key={preset.id} onClick={() => setRange(preset.range)} type="button">{preset.label}</button>)}
      <button aria-pressed={!range.from && !range.to} className={PRESET} data-slot="button" onClick={() => setRange({ from: '', to: '' })} type="button">전체</button>
    </div>
    <div className="flex min-w-0 items-center gap-1.5">
      <label><span className="sr-only">시작일</span><Input className="w-36" name="from" onChange={event => setRange({ ...range, from: event.target.value })} type="date" value={range.from} /></label>
      <span aria-hidden="true" className="text-muted-foreground">~</span>
      <label><span className="sr-only">종료일</span><Input className="w-36" name="to" onChange={event => setRange({ ...range, to: event.target.value })} type="date" value={range.to} /></label>
    </div>
  </>;
}
