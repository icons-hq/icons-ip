'use client';

import { useState, useTransition } from 'react';
import { searchCouponCategoriesAction, type CouponCategorySearch } from '@/app/admin/coupon-target-actions';
import { AdminField } from '@/components/admin/console/AdminKit';
import { isUuid } from '@/lib/uuid';
import type { CouponTargetCategory } from '@/lib/coupon-targeting';

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
  return <div hidden={!active} className="admin-coupon-category-picker">
    <input type="hidden" name="targetCategoryIds" value={JSON.stringify(active ? selected.map(category => category.id) : [])} />
    <AdminField inputId="coupon-category-query" label="대상 카테고리 검색" error={error}>
      <input id="coupon-category-query" type="search" maxLength={100} value={query} onChange={event => setQuery(event.target.value)} />
    </AdminField>
    <div className="admin-coupon-category-picker__body">
    <button type="button" className="wc-admin-kit__button" disabled={pending} onClick={() => search()}>카테고리 찾기</button>
    <p>선택 {selected.length}개 · 대표·추가 카테고리와 하위 분류에 속한 상품에 적용합니다. 나중에 등록되거나 이 분류로 이동한 상품도 포함하며, 보관한 분류는 제외합니다.</p>
    {selected.length ? <ul aria-label="선택한 카테고리">{selected.map(category => <li key={category.id}><span>{category.path}{category.blocked ? ' (현재 적용 불가)' : ''}</span> <button type="button" className="wc-admin-kit__button" aria-label={`${category.path} 제외`} onClick={() => setSelected(items => items.filter(item => item.id !== category.id))}>제외</button></li>)}</ul> : null}
    {result?.ok ? <>
      <p role="status">검색 결과 전체 {result.total}개 · {result.page}페이지</p>
      <ul aria-label="카테고리 검색 결과">{result.items.map(category => <li key={category.id}><span>{category.path}</span> <button type="button" className="wc-admin-kit__button" aria-label={`${category.path} 선택`} disabled={selected.some(item => item.id === category.id) || selected.length >= 100} onClick={() => setSelected(items => [...items, category])}>선택</button></li>)}</ul>
      <div className="wc-admin-kit__actions"><button type="button" disabled={pending || result.page <= 1} onClick={() => search(result.page - 1)}>이전</button><button type="button" disabled={pending || result.page * result.pageSize >= result.total} onClick={() => search(result.page + 1)}>다음</button></div>
    </> : result ? <p role="alert">{result.error}</p> : null}
    </div>
  </div>;
}
