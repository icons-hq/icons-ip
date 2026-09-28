'use client';

import { useState } from 'react';
import { categoryPath, type AdminCategoryNode } from '@/lib/admin/category';

export function CategoryAssignmentField({
  categories,
  value = '',
  error,
  additionalValue,
  additionalError,
}: {
  categories: AdminCategoryNode[];
  value?: string;
  error?: string;
  additionalValue?: string;
  additionalError?: string;
}) {
  const [primary, setPrimary] = useState(value);
  const [additional, setAdditional] = useState<string[]>(() => {
    try {
      const values: unknown = JSON.parse(additionalValue ?? '[]');
      return Array.isArray(values) ? values.filter((id): id is string => typeof id === 'string' && id !== value) : [];
    } catch { return []; }
  });
  const activeLeaves = categories.filter((category) => !category.archivedAt && category.childCount === 0);
  const selectedArchived = primary
    ? categories.find((category) => category.id === primary && category.archivedAt && category.childCount === 0)
    : undefined;
  const leaves = selectedArchived ? [selectedArchived, ...activeLeaves] : activeLeaves;
  return (
    <div className="col" style={{ gap: 7 }}>
      <label className="mono" htmlFor="category-assignment" style={{ color: 'var(--dim)', fontSize: 11 }}>대표 카테고리</label>
      <select aria-describedby="category-assignment-hint" aria-invalid={error ? 'true' : undefined} className="admin-field-control" value={primary} id="category-assignment" name="categoryId" onChange={(event) => {
        setPrimary(event.target.value);
        setAdditional(current => current.filter(id => id !== event.target.value));
      }}>
        <option value="">미분류</option>
        {leaves.map((category) => <option aria-disabled={category.archivedAt ? 'true' : undefined} key={category.id} value={category.id}>{category.archivedAt ? '보관됨 · ' : ''}{categoryPath(categories, category.id).join(' > ')} ({category.code})</option>)}
      </select>
      <span className="muted" id="category-assignment-hint" style={{ fontSize: 12 }}>
        대표 말단 하나를 고릅니다. ERP 분류는 대표 카테고리를 사용합니다. 보관된 현재 값은 명시적으로 미분류를 선택해야 해제됩니다. 비워도 기존 유형과 전체 상품 판매는 유지됩니다.
      </span>
      {error ? <span role="alert" style={{ color: 'var(--pink)', fontSize: 12 }}>{error}</span> : null}
      {additionalValue !== undefined && <>
        <input name="additionalCategoryIds" type="hidden" value={JSON.stringify(additional)} />
        <label className="mono" htmlFor="additional-category-assignment">추가 카테고리 (선택)</label>
        <select className="admin-field-control" id="additional-category-assignment" aria-describedby="additional-category-hint" aria-invalid={additionalError ? 'true' : undefined} value="" onChange={(event) => {
          const id = event.target.value;
          if (id) setAdditional(current => [...new Set([...current, id])]);
        }}>
          <option value="">추가할 말단 선택</option>
          {activeLeaves.filter(category => category.id !== primary && !additional.includes(category.id)).map(category =>
            <option key={category.id} value={category.id}>{categoryPath(categories, category.id).join(' > ')} ({category.code})</option>)}
        </select>
        {additional.map(id => {
          const category = categories.find(category => category.id === id);
          return <div className="row" key={id} style={{ flexWrap: 'wrap', gap: 8 }}>
            <span>{category?.archivedAt ? '보관됨 · ' : ''}{category ? categoryPath(categories, id).join(' > ') : id}</span>
            <button type="button" className="wc-admin-kit__button" aria-label={`${category?.name ?? id} 추가 분류 해제`} onClick={() => setAdditional(current => current.filter(value => value !== id))}>해제</button>
          </div>;
        })}
        <span className="muted" id="additional-category-hint">관리자 목록에서 대표·추가 분류와 하위 분류로 찾을 수 있습니다. 기본 상품 저장으로 반영합니다.</span>
        {additionalError && <span role="alert">{additionalError}</span>}
      </>}
    </div>
  );
}
