'use client';

import Link from 'next/link';
import { goodsListHref, normalizeGoodsListFilters } from '@/lib/admin/goods-list';
import type { AdminCategoryNode } from '@/lib/admin/category';
import { AdminStatusBadge } from './console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';

const byTreeOrder = (left: AdminCategoryNode, right: AdminCategoryNode) => left.sortOrder - right.sortOrder || left.code.localeCompare(right.code);

/** 트리 맨 위 항목. 화면을 처음 열었을 때 오른쪽에서 고칠 항목이다. */
export function firstCategoryInTree(categories: AdminCategoryNode[]): AdminCategoryNode | null {
  return [...categories].filter((category) => category.parentId === null).sort(byTreeOrder)[0] ?? categories[0] ?? null;
}

/**
 * 고객 카테고리 트리. 한 줄은 이름(고칠 항목 고르기)과 그 아래 코드·단계·상품 수, 오른쪽 상품 목록 링크로 항상 같은 모양이다.
 * 지금 오른쪽에서 고치는 항목은 주 색으로 표시한다.
 */
export function CategoryTree({ categories, activeId, onSelect }: { categories: AdminCategoryNode[]; activeId?: string | null; onSelect?: (category: AdminCategoryNode) => void }) {
  const children = new Map<string | null, AdminCategoryNode[]>();
  for (const category of categories) {
    const list = children.get(category.parentId) ?? [];
    list.push(category);
    children.set(category.parentId, list);
  }
  for (const list of children.values()) list.sort(byTreeOrder);

  function branch(parentId: string | null, depth = 0): React.ReactNode {
    const entries = children.get(parentId) ?? [];
    if (!entries.length) return null;
    return <ul className={`m-0 grid list-none gap-0.5 p-0${depth ? ' mt-0.5 ml-3 border-l pl-2' : ''}`}>
      {entries.map((category) => {
        const active = activeId === category.id;
        return <li key={category.id}>
          <div className={`flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 transition-colors ${active ? 'bg-primary-soft' : 'hover:bg-muted'}`} data-category-tree="row">
            <button aria-current={active ? 'true' : undefined} className="flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50" data-slot="button" onClick={() => onSelect?.(category)} type="button">
              <span className="flex max-w-full flex-wrap items-center gap-1.5">
                <strong className={`text-sm font-medium ${active ? 'text-primary-soft-foreground' : ''}`}>{category.name}</strong>
                {category.archivedAt ? <AdminStatusBadge tone={statusTone('publication', 'archived')}>보관</AdminStatusBadge> : null}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums"><span className="font-mono">{category.code}</span> · {category.depth}/4 · 직접 연결 상품 {category.assignedGoodCount}개</span>
            </button>
            <Link aria-label={`${category.name} 상품 목록`} className="shrink-0 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href={goodsListHref(normalizeGoodsListFilters({ categoryId: category.id }))}>상품 목록</Link>
          </div>
          {branch(category.id, depth + 1)}
        </li>;
      })}
    </ul>;
  }

  return <div aria-label="고객 카테고리 트리">{branch(null) ?? <p className="text-sm text-muted-foreground">등록된 카테고리가 없습니다.</p>}</div>;
}
