'use client';
import { useState } from 'react';
import Link from 'next/link';
import { consoleDatePresets, kstToday, shiftKstMonth } from '@/components/admin/console/date-presets';
import { SalesFilterField, SalesSelect } from '@/components/admin/sales/SalesConsole';
import { ADMIN_COUPON_LIST_PATH, COUPON_PHASES, COUPON_SEGMENTS, type AdminCouponFilters } from '@/lib/admin/coupons';

export function CouponFilters({ filters }: { filters: AdminCouponFilters }) {
  const [range, setRange] = useState({ from: filters.from ?? '', to: filters.to ?? '' });
  const today = kstToday();
  const presets = [...consoleDatePresets(['today', 'week', 'month', 'quarter']),
    { id: 'half', label: '6개월', range: { from: shiftKstMonth(today, -6), to: today } },
    { id: 'year', label: '1년', range: { from: shiftKstMonth(today, -12), to: today } },
    { id: 'all', label: '전체', range: { from: '', to: '' } }];
  return <form action={ADMIN_COUPON_LIST_PATH} method="get" className="admin-sales-filters admin-coupon-filters">
    <h2>혜택 조회</h2>
    <div className="admin-sales-filter-rows">
      <SalesFilterField label="혜택 이름·코드" htmlFor="coupon-query"><input id="coupon-query" type="search" name="q" maxLength={100} defaultValue={filters.query} placeholder="혜택 이름 또는 쿠폰 코드를 입력하세요" /></SalesFilterField>
      <SalesFilterField label="할인설정" htmlFor="coupon-discount-type"><SalesSelect id="coupon-discount-type" name="discountType" value={filters.discountType ?? 'all'} options={[{ value: 'all', label: '전체' }, { value: 'fixed', label: '정액 할인' }, { value: 'percent', label: '정률 할인' }]} /></SalesFilterField>
      <SalesFilterField label="타겟팅 대상" htmlFor="coupon-segment"><SalesSelect id="coupon-segment" name="segment" value={filters.segment ?? 'any'} options={[{ value: 'any', label: '타겟팅 대상 전체' }, ...COUPON_SEGMENTS, { value: 'targeted', label: '지정 고객' }, { value: 'grade', label: '등급 혜택' }]} /></SalesFilterField>
      <SalesFilterField label="혜택상태" htmlFor="coupon-phase"><SalesSelect id="coupon-phase" name="phase" value={filters.phase ?? (filters.status === 'archived' ? 'stopped' : 'all')} options={COUPON_PHASES} /></SalesFilterField>
      <SalesFilterField label="조회기간" htmlFor="coupon-date-field"><SalesSelect id="coupon-date-field" name="dateField" value={filters.dateField ?? 'created'} options={[{ value: 'created', label: '등록일' }, { value: 'starts', label: '사용 시작일' }]} />
        <div className="admin-sales-date-presets" aria-label="혜택 조회기간 빠른 선택">{presets.map(preset => <button aria-pressed={range.from === preset.range.from && range.to === preset.range.to} key={preset.id} onClick={() => setRange(preset.range)} type="button">{preset.label}</button>)}</div>
        <div className="admin-sales-date-range"><input aria-label="조회 시작일" type="date" name="from" value={range.from} onChange={event => setRange({ ...range, from: event.target.value })} /><span>~</span><input aria-label="조회 종료일" type="date" name="to" value={range.to} onChange={event => setRange({ ...range, to: event.target.value })} /></div>
      </SalesFilterField>
    </div>
    <div className="admin-sales-filter-actions"><button type="submit">조회</button><Link href={ADMIN_COUPON_LIST_PATH}>초기화</Link></div>
  </form>;
}
