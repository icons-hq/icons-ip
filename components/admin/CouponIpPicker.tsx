'use client';

import { useState, useTransition } from 'react';
import { searchCouponIpsAction, type CouponIpSearch } from '@/app/admin/coupon-target-actions';
import { AdminField } from '@/components/admin/console/AdminKit';
import type { CouponTargetIp } from '@/lib/coupon-targeting';

const IP_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;

/* IP 쿠폰 대상 선택기 (S22). 카테고리 선택기와 같은 계약: 선택 목록은 hidden JSON으로
   제출하고, 대상 판정은 서버가 각 굿즈의 현재 IP로 한다(나중에 추가된 굿즈 포함). */
export function CouponIpPicker({ active, targetIds, ips, error }: {
  active: boolean; targetIds: string; ips: CouponTargetIp[]; error?: string;
}) {
  const [selected, setSelected] = useState<CouponTargetIp[]>(() => {
    try {
      const ids: unknown = JSON.parse(targetIds);
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && IP_ID.test(id)).map(id => ips.find(ip => ip.id === id) ?? { id, title: '정보 미확인', blocked: true }) : [];
    } catch { return []; }
  });
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<CouponIpSearch | null>(null);
  const [pending, start] = useTransition();
  function search(page = 1) { start(async () => setResult(await searchCouponIpsAction(query, page))); }
  return <div hidden={!active} className="admin-coupon-category-picker admin-coupon-ip-picker">
    <input type="hidden" name="targetIpIds" value={JSON.stringify(active ? selected.map(ip => ip.id) : [])} />
    <AdminField inputId="coupon-ip-query" label="대상 IP 검색" error={error}>
      <input id="coupon-ip-query" type="search" maxLength={100} value={query} onChange={event => setQuery(event.target.value)} />
    </AdminField>
    <div className="admin-coupon-category-picker__body">
    <button type="button" className="wc-admin-kit__button" disabled={pending} onClick={() => search()}>IP 찾기</button>
    <p>선택 {selected.length}개 · 이 IP 상품의 소계에만 최소금액과 할인을 적용합니다. 나중에 이 IP에 등록되거나 이 IP로 옮긴 상품도 포함하며, 보관한 IP는 새로 지정할 수 없습니다.</p>
    {selected.length ? <ul aria-label="선택한 IP">{selected.map(ip => <li key={ip.id}><span>{ip.title}{ip.blocked ? ' (현재 적용 불가)' : ''}</span> <button type="button" className="wc-admin-kit__button" aria-label={`${ip.title} 제외`} onClick={() => setSelected(items => items.filter(item => item.id !== ip.id))}>제외</button></li>)}</ul> : null}
    {result?.ok ? <>
      <p role="status">검색 결과 전체 {result.total}개 · {result.page}페이지</p>
      <ul aria-label="IP 검색 결과">{result.items.map(ip => <li key={ip.id}><span>{ip.title}</span> <button type="button" className="wc-admin-kit__button" aria-label={`${ip.title} 선택`} disabled={selected.some(item => item.id === ip.id) || selected.length >= 100} onClick={() => setSelected(items => [...items, ip])}>선택</button></li>)}</ul>
      <div className="wc-admin-kit__actions"><button type="button" disabled={pending || result.page <= 1} onClick={() => search(result.page - 1)}>이전</button><button type="button" disabled={pending || result.page * result.pageSize >= result.total} onClick={() => search(result.page + 1)}>다음</button></div>
    </> : result ? <p role="alert">{result.error}</p> : null}
    </div>
  </div>;
}
