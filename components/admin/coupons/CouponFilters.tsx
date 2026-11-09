'use client';
import { useState } from 'react';
import Link from 'next/link';
import { consoleDatePresets, kstToday, shiftKstMonth } from '@/components/admin/console/date-presets';
import { ConsoleFilterField } from '@/components/admin/console/ConsoleFilterPanel';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { NativeSelect } from '@/components/admin/kit/ui/native-select';
import { ADMIN_COUPON_LIST_PATH, COUPON_PHASES, COUPON_SEGMENTS, type AdminCouponFilters } from '@/lib/admin/coupons';

/* 혜택 조회 조건(템플릿 룩, ADR-0028). 콘솔 조회 조건 카드와 같은 모양이고 조회 키(q·discountType·segment·phase·dateField·from·to)는 그대로다.
   기간 빠른 선택은 6개월·1년·전체가 더 있어 폼 안에서 날짜 칸만 채운다. */
const PRESET = 'h-7 rounded-md px-2.5 text-[0.8rem] text-muted-foreground hover:bg-transparent hover:text-foreground aria-pressed:bg-background aria-pressed:text-primary-soft-foreground aria-pressed:shadow-sm';
const SELECT = 'w-full sm:w-44';

function Choices({ id, name, value, options }: { id: string; name: string; value: string; options: readonly { value: string; label: string }[] }) {
  return <NativeSelect className={SELECT} defaultValue={value} id={id} name={name}>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</NativeSelect>;
}

export function CouponFilters({ filters }: { filters: AdminCouponFilters }) {
  const [range, setRange] = useState({ from: filters.from ?? '', to: filters.to ?? '' });
  const today = kstToday();
  const presets = [...consoleDatePresets(['today', 'week', 'month', 'quarter']),
    { id: 'half', label: '6개월', range: { from: shiftKstMonth(today, -6), to: today } },
    { id: 'year', label: '1년', range: { from: shiftKstMonth(today, -12), to: today } },
    { id: 'all', label: '전체', range: { from: '', to: '' } }];
  return <form action={ADMIN_COUPON_LIST_PATH} method="get" className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground print:hidden" data-console-filters="">
    <h2 className="text-base font-semibold">혜택 조회</h2>
    <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
      <ConsoleFilterField className="min-w-[min(100%,18rem)] flex-1" label="혜택 이름·코드" htmlFor="coupon-query"><Input id="coupon-query" type="search" name="q" maxLength={100} defaultValue={filters.query} placeholder="혜택 이름 또는 쿠폰 코드를 입력하세요" /></ConsoleFilterField>
      <ConsoleFilterField label="할인설정" htmlFor="coupon-discount-type"><Choices id="coupon-discount-type" name="discountType" value={filters.discountType ?? 'all'} options={[{ value: 'all', label: '전체' }, { value: 'fixed', label: '정액 할인' }, { value: 'percent', label: '정률 할인' }]} /></ConsoleFilterField>
      <ConsoleFilterField label="타겟팅 대상" htmlFor="coupon-segment"><Choices id="coupon-segment" name="segment" value={filters.segment ?? 'any'} options={[{ value: 'any', label: '타겟팅 대상 전체' }, ...COUPON_SEGMENTS, { value: 'targeted', label: '지정 고객' }, { value: 'grade', label: '등급 혜택' }]} /></ConsoleFilterField>
      <ConsoleFilterField label="혜택상태" htmlFor="coupon-phase"><Choices id="coupon-phase" name="phase" value={filters.phase ?? (filters.status === 'archived' ? 'stopped' : 'all')} options={COUPON_PHASES} /></ConsoleFilterField>
    </div>
    {/* 조회 버튼을 기간 줄 오른쪽 끝에 둔다 — 버튼 줄을 따로 두면 목록이 그만큼 밀린다. */}
    <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-3">
    <ConsoleFilterField label="조회기간" htmlFor="coupon-date-field"><div className="flex flex-wrap items-center gap-2"><NativeSelect className="w-full sm:w-32" defaultValue={filters.dateField ?? 'created'} id="coupon-date-field" name="dateField"><option value="created">등록일</option><option value="starts">사용 시작일</option></NativeSelect>
      <div className="inline-flex max-w-full flex-wrap rounded-lg bg-muted p-0.5" aria-label="혜택 조회기간 빠른 선택" role="group">{presets.map(preset => <Button aria-pressed={range.from === preset.range.from && range.to === preset.range.to} className={PRESET} key={preset.id} onClick={() => setRange(preset.range)} size="sm" type="button" variant="ghost">{preset.label}</Button>)}</div>
      <div className="flex items-center gap-1.5"><Input aria-label="조회 시작일" className="w-36" type="date" name="from" value={range.from} onChange={event => setRange({ ...range, from: event.target.value })} /><span aria-hidden="true" className="text-muted-foreground">~</span><Input aria-label="조회 종료일" className="w-36" type="date" name="to" value={range.to} onChange={event => setRange({ ...range, to: event.target.value })} /></div>
    </div></ConsoleFilterField>
    <div className="ml-auto flex items-center gap-2"><Link className={buttonVariants({ variant: 'ghost' })} data-slot="button" href={ADMIN_COUPON_LIST_PATH}>초기화</Link><Button type="submit" variant="soft">검색</Button></div>
    </div>
  </form>;
}
