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
 * 고객 카테고리 트리. 한 줄은 이름(고칠 항목 고르기)과 오른쪽의 상품 수 링크로 항상 같은 모양이다. 단계는 들여쓰기가 보여 주고, 코드는 말풍선과 오른쪽 입력칸에 있다.
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
            <button aria-current={active ? 'true' : undefined} className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 rounded text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50" data-slot="button" onClick={() => onSelect?.(category)} title={`코드 ${category.code} · ${category.depth}단계`} type="button">
              <strong className={`text-sm font-medium ${active ? 'text-primary-soft-foreground' : ''}`}>{category.name}</strong>
              {/* SHEET-003: 이 카테고리에 연결한 상품 유형. 없으면 상위를 따른다. */}
              {category.goodType ? <span className="text-xs text-muted-foreground" data-category-good-type="">· {category.goodType}</span> : null}
              {category.archivedAt ? <AdminStatusBadge tone={statusTone('publication', 'archived')}>보관</AdminStatusBadge> : null}
            </button>
            <Link aria-label={`상품 ${category.assignedGoodCount.toLocaleString('ko-KR')}개 · ${category.name} 상품 목록`} className="shrink-0 text-xs whitespace-nowrap text-muted-foreground tabular-nums underline-offset-4 hover:text-foreground hover:underline" href={goodsListHref(normalizeGoodsListFilters({ categoryId: category.id }))} title="이 카테고리에 직접 연결된 상품 수입니다. 누르면 하위 카테고리 상품까지 함께 봅니다.">상품 {category.assignedGoodCount.toLocaleString('ko-KR')}개</Link>
          </div>
          {branch(category.id, depth + 1)}
        </li>;
      })}
    </ul>;
  }

  return <div aria-label="고객 카테고리 트리">{branch(null) ?? <p className="text-sm text-muted-foreground">등록된 카테고리가 없습니다.</p>}</div>;
}
