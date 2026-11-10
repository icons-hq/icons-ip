'use client';

import { useState, useTransition } from 'react';
import { searchCouponIpsAction, type CouponIpSearch } from '@/app/admin/coupon-target-actions';
import { AdminField } from '@/components/admin/console/AdminKit';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import type { CouponTargetIp } from '@/lib/coupon-targeting';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';

const IP_ID = /^[a-z0-9][a-z0-9-]{0,99}$/;
const ROW = 'flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-xs';

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
  return <div hidden={!active} className="flex min-w-0 flex-col gap-3">
    <input type="hidden" name="targetIpIds" value={JSON.stringify(active ? selected.map(ip => ip.id) : [])} />
    <AdminField inputId="coupon-ip-query" label="대상 IP 검색" error={error}>
      <Input id="coupon-ip-query" type="search" maxLength={100} value={query} onChange={event => setQuery(event.target.value)} />
    </AdminField>
    <div className="flex min-w-0 flex-col gap-3 sm:max-w-[650px]">
    <Button className="self-start" type="button" variant="outline" disabled={pending} onClick={() => search()}>IP 찾기</Button>
    <p className="text-xs leading-relaxed text-muted-foreground">선택 {selected.length}개 · 이 IP 상품의 소계에만 최소금액과 할인을 적용합니다. 나중에 이 IP에 등록되거나 이 IP로 옮긴 상품도 포함하며, 보관한 IP는 새로 지정할 수 없습니다.</p>
    {selected.length ? <ul className="grid gap-2" aria-label="선택한 IP">{selected.map(ip => <li className={ROW} key={ip.id}><span className="min-w-0 [overflow-wrap:anywhere]">{ip.title}{ip.blocked ? ' (현재 적용 불가)' : ''}</span> <Button className="shrink-0" type="button" size="xs" variant="outline" aria-label={`${ip.title} 제외`} onClick={() => setSelected(items => items.filter(item => item.id !== ip.id))}>제외</Button></li>)}</ul> : null}
    {result?.ok ? <>
      <p className="text-xs text-muted-foreground" role="status">검색 결과 전체 {result.total}개 · {result.page}페이지</p>
      <ul className="grid gap-2" aria-label="IP 검색 결과">{result.items.map(ip => <li className={ROW} key={ip.id}><span className="min-w-0 [overflow-wrap:anywhere]">{ip.title}</span> <Button className="shrink-0" type="button" size="xs" variant="outline" aria-label={`${ip.title} 선택`} disabled={selected.some(item => item.id === ip.id) || selected.length >= 100} onClick={() => setSelected(items => [...items, ip])}>선택</Button></li>)}</ul>
      <ConsolePagination label="IP 검색 결과 페이지" page={result.page} pageSize={result.pageSize} total={result.total} unit="개" disabled={pending} onPageChange={search} />
    </> : result ? <p className="text-sm text-destructive" role="alert">{result.error}</p> : null}
    </div>
  </div>;
}
