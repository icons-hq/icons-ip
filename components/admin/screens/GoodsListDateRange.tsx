'use client';

import { useState } from 'react';
import { consoleDatePresets, isConsoleDateRangeActive } from '../console/date-presets';
import { Input } from '../kit/ui/input';
import { goodsListDateRangeFromEnd, goodsListDateRangeFromStart } from '@/lib/admin/goods-list';

const PRESET = 'inline-flex h-7 items-center rounded-md px-2.5 text-[0.8rem] font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:bg-background aria-pressed:text-primary-soft-foreground aria-pressed:shadow-sm';

/**
 * 상품 조회 조건의 기간 빠른 선택·날짜 칸. 빠른 선택은 링크가 아니라 날짜 칸만 채운다 — 조건을 바꾸는 것만으로
 * 조회하지 않고 [검색]을 눌러야 조회된다(ADM-016 #13). `전체`는 기간을 비운다.
 *
 * 시작일이 종료일보다 늦은 기간은 여기서 만들 수 없게 한다(예전에는 그대로 조회하면 기간 조건이 말없이 빠졌다).
 * - 종료일 달력은 시작일보다 앞을 고를 수 없다(`min`).
 * - 시작일을 종료일 뒤로 옮기면 종료일이 같은 날로 따라온다. 손대지 않은 종료일 때문에 [검색]이 막히지 않는다.
 * - 종료일을 글자로 시작일보다 앞서게 적으면 칸을 떠날 때 시작일이 그날로 따라온다. 적는 도중의 값(연도 한 자리씩)에는 맞추지 않는다.
 *   상세검색을 접은 채 [검색]을 눌러도 보이지 않는 칸 때문에 조회가 멈추지 않는다.
 * 주소를 직접 고쳐 뒤바뀐 날짜는 서버가 바로잡는다(`normalizeGoodsListFilters`).
 */
export function GoodsListDateRange({ from, to }: { from: string | null | undefined; to: string | null | undefined }) {
  const [range, setRange] = useState({ from: from ?? '', to: to ?? '' });
  return <>
    <div aria-label="조회기간 빠른 선택" className="inline-flex flex-wrap rounded-lg bg-muted p-0.5" role="group">
      {consoleDatePresets().map(preset => <button aria-pressed={isConsoleDateRangeActive(preset.range, range)} className={PRESET} data-slot="button" key={preset.id} onClick={() => setRange(preset.range)} type="button">{preset.label}</button>)}
      <button aria-pressed={!range.from && !range.to} className={PRESET} data-slot="button" onClick={() => setRange({ from: '', to: '' })} type="button">전체</button>
    </div>
    <div className="flex min-w-0 items-center gap-1.5">
      <label><span className="sr-only">시작일</span><Input className="w-36" name="from" onChange={event => setRange(goodsListDateRangeFromStart(range, event.target.value))} type="date" value={range.from} /></label>
      <span aria-hidden="true" className="text-muted-foreground">~</span>
      <label><span className="sr-only">종료일</span><Input className="w-36" min={range.from || undefined} name="to" onBlur={() => setRange(goodsListDateRangeFromEnd(range))} onChange={event => setRange({ ...range, to: event.target.value })} type="date" value={range.to} /></label>
    </div>
  </>;
}
