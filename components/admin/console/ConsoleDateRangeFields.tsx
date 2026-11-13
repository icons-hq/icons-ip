'use client';

import { useState } from 'react';
import { Input } from '@/components/admin/kit/ui/input';
import { isConsoleDateRangeActive, type ConsoleDatePreset } from './date-presets';

const PRESET_CLASS = 'inline-flex h-7 items-center rounded-md px-2.5 text-[0.8rem] font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:bg-background aria-pressed:text-primary-soft-foreground aria-pressed:shadow-sm';

/**
 * 조회기간 빠른 선택 + 날짜 입력(조회 조건 카드).
 *
 * 빠른 선택은 링크가 아니라 날짜 칸만 채운다. 조건을 바꾸는 것만으로 조회하지 않고 [검색]을 눌러야 조회된다
 * (ADM-016 #13, 주문 조회와 같은 방식). 날짜 칸은 폼 안의 입력이라 [검색]을 누르면 URL 계약(from·to)으로 간다.
 */
export function ConsoleDateRangeFields({
  from,
  fromName,
  idPrefix,
  label,
  labelId,
  presets,
  to,
  toName,
}: {
  from: string | null;
  fromName: string;
  idPrefix: string;
  label: string;
  labelId: string;
  presets: readonly ConsoleDatePreset[];
  to: string | null;
  toName: string;
}) {
  const [range, setRange] = useState({ from: from ?? '', to: to ?? '' });
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-console-filter="period">
      <span className="text-sm leading-none font-medium" id={labelId}>{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <div aria-labelledby={labelId} className="inline-flex rounded-lg bg-muted p-0.5" role="group">
          {presets.map((preset) => (
            <button
              aria-pressed={isConsoleDateRangeActive(preset.range, range)}
              className={PRESET_CLASS}
              data-slot="button"
              key={preset.id}
              onClick={() => setRange(preset.range)}
              type="button"
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="sr-only" htmlFor={`${idPrefix}-from`}>시작일</label>
          <Input className="w-36" data-admin-query="" id={`${idPrefix}-from`} name={fromName} onChange={(event) => setRange({ ...range, from: event.target.value })} type="date" value={range.from} />
          <span aria-hidden="true" className="text-muted-foreground">~</span>
          <label className="sr-only" htmlFor={`${idPrefix}-to`}>종료일</label>
          <Input className="w-36" data-admin-query="" id={`${idPrefix}-to`} name={toName} onChange={(event) => setRange({ ...range, to: event.target.value })} type="date" value={range.to} />
        </div>
      </div>
    </div>
  );
}
