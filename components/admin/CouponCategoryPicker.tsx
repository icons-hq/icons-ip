'use client';

import { useState, useTransition } from 'react';
import { searchCouponCategoriesAction, type CouponCategorySearch } from '@/app/admin/coupon-target-actions';
import { AdminField } from '@/components/admin/console/AdminKit';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { isUuid } from '@/lib/uuid';
import type { CouponTargetCategory } from '@/lib/coupon-targeting';
import { Button } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';

const ROW = 'flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-xs';

export function CouponCategoryPicker({ active, targetIds, categories, error }: {
  active: boolean; targetIds: string; categories: CouponTargetCategory[]; error?: string;
}) {
  const [selected, setSelected] = useState<CouponTargetCategory[]>(() => {
    try {
      const ids: unknown = JSON.parse(targetIds);
      return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string' && isUuid(id)).map(id => categories.find(category => category.id === id) ?? { id, name: '정보 미확인', path: id, blocked: true }) : [];
    } catch { return []; }
  });
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<CouponCategorySearch | null>(null);
  const [pending, start] = useTransition();
  function search(page = 1) { start(async () => setResult(await searchCouponCategoriesAction(query, page))); }
  /* 카테고리 대상 선택(템플릿 룩, ADR-0028). 고른 목록은 숨은 JSON 값으로 제출하고 판정은 서버가 한다. */
  return <div hidden={!active} className="flex min-w-0 flex-col gap-3">
    <input type="hidden" name="targetCategoryIds" value={JSON.stringify(active ? selected.map(category => category.id) : [])} />
    <AdminField inputId="coupon-category-query" label="대상 카테고리 검색" error={error}>
      <Input id="coupon-category-query" type="search" maxLength={100} value={query} onChange={event => setQuery(event.target.value)} />
    </AdminField>
    <div className="flex min-w-0 flex-col gap-3 sm:max-w-[650px]">
    <Button className="self-start" type="button" variant="outline" disabled={pending} onClick={() => search()}>카테고리 찾기</Button>
    <p className="text-xs leading-relaxed text-muted-foreground">선택 {selected.length}개 · 대표·추가 카테고리와 하위 분류에 속한 상품에 적용합니다. 나중에 등록되거나 이 분류로 이동한 상품도 포함하며, 보관한 분류는 제외합니다.</p>
    {selected.length ? <ul className="grid gap-2" aria-label="선택한 카테고리">{selected.map(category => <li className={ROW} key={category.id}><span className="min-w-0 [overflow-wrap:anywhere]">{category.path}{category.blocked ? ' (현재 적용 불가)' : ''}</span> <Button className="shrink-0" type="button" size="xs" variant="outline" aria-label={`${category.path} 제외`} onClick={() => setSelected(items => items.filter(item => item.id !== category.id))}>제외</Button></li>)}</ul> : null}
    {result?.ok ? <>
      <p className="text-xs text-muted-foreground" role="status">검색 결과 전체 {result.total}개 · {result.page}페이지{selected.length >= 100 ? ' · 카테고리는 100개까지 고를 수 있습니다.' : ''}</p>
      <ul className="grid gap-2" aria-label="카테고리 검색 결과">{result.items.map(category => <li className={ROW} key={category.id}><span className="min-w-0 [overflow-wrap:anywhere]">{category.path}</span> <Button className="shrink-0" type="button" size="xs" variant="outline" aria-label={`${category.path} ${selected.some(item => item.id === category.id) ? '선택됨' : '선택'}`} disabled={selected.some(item => item.id === category.id) || selected.length >= 100} onClick={() => setSelected(items => [...items, category])}>{selected.some(item => item.id === category.id) ? '선택됨' : '선택'}</Button></li>)}</ul>
      <ConsolePagination label="카테고리 검색 결과 페이지" page={result.page} pageSize={result.pageSize} total={result.total} unit="개" disabled={pending} onPageChange={search} />
    </> : result ? <p className="text-sm text-destructive" role="alert">{result.error}</p> : null}
    </div>
  </div>;
}
