'use client';
import { useRef, useState, useTransition } from 'react';
import { searchMarketingCouponsAction } from '@/app/admin/marketing-attachment-actions';
import { marketingCouponBenefit, type MarketingCoupon } from '@/lib/admin/marketing-coupons';
export function MarketingCouponPicker({ selected, code, disabled, onChange }: { selected: MarketingCoupon | null; code: string | null; disabled: boolean; onChange: (value: MarketingCoupon | null) => void }) {
  const [query, setQuery] = useState(''), [rows, setRows] = useState<MarketingCoupon[] | null>(null), [page, setPage] = useState(1), [total, setTotal] = useState(0), [error, setError] = useState('');
  const [pending, start] = useTransition(), sequence = useRef(0);
  function search(next: number) { const current = ++sequence.current; start(async () => {
    const result = await searchMarketingCouponsAction(query, next); if (current !== sequence.current) return;
    if ('rows' in result && result.rows) { setRows(result.rows); setPage(result.page); setTotal(result.total); setError(''); } else setError(result.error ?? '쿠폰을 조회하지 못했습니다.');
  }); }
  return <fieldset className="wc-admin-marketing__picker" disabled={disabled}><legend>쿠폰 첨부 <small>선택 · 1개</small></legend>
    <p>고객이 알림을 열고 ‘쿠폰 받기’를 누르면 발급 조건을 확인합니다. 메시지 등록만으로 쿠폰을 발급하지 않습니다.</p>
    {code ? <p><strong>{selected?.name ?? code}</strong> · {selected ? marketingCouponBenefit(selected) : '현재 쿠폰 확인 필요'} <button type="button" className="wc-admin-kit__button" onClick={() => onChange(null)}>첨부 해제</button></p> : null}
    <div className="wc-admin-marketing__picker-search"><label>첨부 쿠폰 이름·코드<input value={query} maxLength={100} onChange={event => { setQuery(event.target.value); sequence.current++; }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); search(1); } }} /></label><button type="button" className="wc-admin-kit__button" disabled={pending} onClick={() => search(1)}>쿠폰 조회</button></div>
    {rows ? <div className="wc-admin-marketing__choices"><p>총 {total.toLocaleString('ko-KR')}개</p>{rows.map(row => <button type="button" key={row.code} disabled={pending || code === row.code} onClick={() => onChange(row)}><strong>{row.name}</strong><span>{row.code} · {marketingCouponBenefit(row)}</span><small>{row.available ? '현재 발급 가능' : '발급 기간·한도 확인 필요'}</small></button>)}<div><button type="button" disabled={pending || page <= 1} onClick={() => search(page - 1)}>이전 쿠폰</button><span>{page} / {Math.max(1, Math.ceil(total / 20))}</span><button type="button" disabled={pending || page * 20 >= total} onClick={() => search(page + 1)}>다음 쿠폰</button></div></div> : null}
    {error ? <p role="alert">{error}</p> : null}
  </fieldset>;
}
