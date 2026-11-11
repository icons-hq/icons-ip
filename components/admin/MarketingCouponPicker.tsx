'use client';
import { useRef, useState, useTransition } from 'react';
import { searchMarketingCouponsAction } from '@/app/admin/marketing-attachment-actions';
import { marketingCouponBenefit, type MarketingCoupon } from '@/lib/admin/marketing-coupons';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
/* 메시지에 붙일 쿠폰 선택(템플릿 룩, ADR-0028). 조회 결과는 고르는 카드 버튼이다. */
const CHOICE = 'h-auto flex-col items-start justify-start gap-1 p-3 text-left font-normal whitespace-normal';
export function MarketingCouponPicker({ selected, code, disabled, onChange }: { selected: MarketingCoupon | null; code: string | null; disabled: boolean; onChange: (value: MarketingCoupon | null) => void }) {
  const [query, setQuery] = useState(''), [rows, setRows] = useState<MarketingCoupon[] | null>(null), [page, setPage] = useState(1), [total, setTotal] = useState(0), [error, setError] = useState('');
  const [pending, start] = useTransition(), sequence = useRef(0);
  function search(next: number) { const current = ++sequence.current; start(async () => {
    const result = await searchMarketingCouponsAction(query, next); if (current !== sequence.current) return;
    if ('rows' in result && result.rows) { setRows(result.rows); setPage(result.page); setTotal(result.total); setError(''); } else setError(result.error ?? '쿠폰을 조회하지 못했습니다.');
  }); }
  return <fieldset className="grid min-w-0 gap-3 text-sm" disabled={disabled}><legend className="mb-1 text-sm font-medium">쿠폰 첨부 <small className="text-xs font-normal text-muted-foreground">선택 · 1개</small></legend>
    <p className="text-muted-foreground">고객이 알림을 열고 ‘쿠폰 받기’를 누르면 발급 조건을 확인합니다. 메시지 등록만으로 쿠폰을 발급하지 않습니다.</p>
    {code ? <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1"><strong className="font-medium">{selected?.name ?? code}</strong> · {selected ? marketingCouponBenefit(selected) : '현재 쿠폰 확인 필요'} <Button type="button" variant="outline" size="xs" onClick={() => onChange(null)}>첨부 해제</Button></p> : null}
    <div className="flex flex-wrap items-end gap-2.5"><label className="flex min-w-0 flex-1 basis-60 flex-col gap-1.5 font-medium">첨부 쿠폰 이름·코드<Input value={query} maxLength={100} onChange={event => { setQuery(event.target.value); sequence.current++; }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); search(1); } }} /></label><Button type="button" variant="outline" disabled={pending} onClick={() => search(1)}>쿠폰 조회</Button></div>
    {rows ? <div className="grid max-h-[370px] gap-1.5 overflow-y-auto rounded-lg border p-3"><p className="text-muted-foreground">총 {total.toLocaleString('ko-KR')}개</p>{rows.map(row => <Button className={CHOICE} type="button" variant="outline" key={row.code} disabled={pending || code === row.code} onClick={() => onChange(row)}><strong className="font-medium">{row.name}</strong><span className="text-xs text-muted-foreground">{row.code} · {marketingCouponBenefit(row)}</span><small className="text-xs text-muted-foreground">{row.available ? '현재 발급 가능' : '발급 기간·한도 확인 필요'}</small></Button>)}<ConsolePagination className="pt-2" label="첨부 쿠폰 목록 페이지" page={page} pageSize={20} total={total} unit="개" disabled={pending} onPageChange={search} /></div> : null}
    {error ? <p className="text-destructive" role="alert">{error}</p> : null}
  </fieldset>;
}
