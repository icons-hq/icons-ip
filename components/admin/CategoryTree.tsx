'use client';

import type { AdminCategoryNode } from '@/lib/admin/category';

export function CategoryTree({ categories }: { categories: AdminCategoryNode[] }) {
  const children = new Map<string | null, AdminCategoryNode[]>();
  for (const category of categories) {
    const list = children.get(category.parentId) ?? [];
    list.push(category);
    children.set(category.parentId, list);
  }
  for (const list of children.values()) list.sort((left, right) => left.sortOrder - right.sortOrder || left.code.localeCompare(right.code));

  function branch(parentId: string | null, depth = 0): React.ReactNode {
    const entries = children.get(parentId) ?? [];
    if (!entries.length) return null;
    return <ul style={{ display: 'grid', gap: 8, listStyle: 'none', margin: depth ? '8px 0 0 18px' : 0, padding: 0 }}>
      {entries.map((category) => <li key={category.id}>
        <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <strong>{category.name}</strong>
          <code>{category.code}</code>
          <span className="muted">{category.depth}/4 · 굿즈 {category.assignedGoodCount}개</span>
          {category.archivedAt ? <span className="muted">보관</span> : null}
        </div>
        {branch(category.id, depth + 1)}
      </li>)}
    </ul>;
  }

  return <div aria-label="고객 카테고리 트리">{branch(null) ?? <p className="muted">등록된 카테고리가 없습니다.</p>}</div>;
}
