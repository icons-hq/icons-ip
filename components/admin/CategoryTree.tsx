'use client';

import Link from 'next/link';
import { goodsListHref, normalizeGoodsListFilters } from '@/lib/admin/goods-list';
import type { AdminCategoryNode } from '@/lib/admin/category';
import { AdminStatusBadge } from './console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';

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
    return <ul className={`m-0 grid list-none gap-2 p-0${depth ? ' mt-2 ml-4 border-l pl-3' : ''}`}>
      {entries.map((category) => <li key={category.id}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <strong className="font-medium">{category.name}</strong>
          <code className="rounded bg-muted px-1 py-0.5 text-xs">{category.code}</code>
          <Link className="underline-offset-4 hover:underline" href={goodsListHref(normalizeGoodsListFilters({ categoryId: category.id }))}>{category.name} 상품 목록</Link>
          <span className="text-xs text-muted-foreground">{category.depth}/4 · 직접 연결 상품 {category.assignedGoodCount}개</span>
          {category.archivedAt ? <AdminStatusBadge tone={statusTone('publication', 'archived')}>보관</AdminStatusBadge> : null}
        </div>
        {branch(category.id, depth + 1)}
      </li>)}
    </ul>;
  }

  return <div aria-label="고객 카테고리 트리">{branch(null) ?? <p className="text-sm text-muted-foreground">등록된 카테고리가 없습니다.</p>}</div>;
}
