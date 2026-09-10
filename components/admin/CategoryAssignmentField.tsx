'use client';

import type { AdminCategoryNode } from '@/lib/admin/category';

export function CategoryAssignmentField({
  categories,
  value = '',
  error,
}: {
  categories: AdminCategoryNode[];
  value?: string;
  error?: string;
}) {
  const activeLeaves = categories.filter((category) => !category.archivedAt && category.childCount === 0);
  const selectedArchived = value
    ? categories.find((category) => category.id === value && category.archivedAt && category.childCount === 0)
    : undefined;
  const leaves = selectedArchived ? [selectedArchived, ...activeLeaves] : activeLeaves;
  return (
    <label className="col" htmlFor="category-assignment" style={{ gap: 7 }}>
      <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>기본 고객 카테고리</span>
      <select aria-describedby="category-assignment-hint" aria-invalid={error ? 'true' : undefined} className="admin-field-control" defaultValue={value} id="category-assignment" name="categoryId">
        <option value="">미분류 · 기존 유형/전체 목록 유지</option>
        {leaves.map((category) => <option aria-disabled={category.archivedAt ? 'true' : undefined} key={category.id} value={category.id}>{category.archivedAt ? '보관됨 · ' : ''}{'　'.repeat(Math.max(0, category.depth - 1))}{category.name} ({category.code})</option>)}
      </select>
      <span className="muted" id="category-assignment-hint" style={{ fontSize: 12 }}>
        말단 카테고리 하나만 연결합니다. 보관된 현재 값은 명시적으로 미분류를 선택해야 해제됩니다. 비워도 기존 유형과 전체 상품 판매는 유지됩니다.
      </span>
      {error ? <span role="alert" style={{ color: 'var(--pink)', fontSize: 12 }}>{error}</span> : null}
    </label>
  );
}
