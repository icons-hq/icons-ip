import { categoryPath, type AdminCategoryNode } from './category';
import type { ErpItemMatch } from './erp-items';

/**
 * 옵션에서 ERP 품목을 고른 뒤 대표 고객 카테고리를 어떻게 다룰지.
 * 대표가 비어 있을 때만 자동으로 채우고, 이미 고른 카테고리는 덮어쓰지 않는다.
 */
export type ErpCategorySuggestion =
  | { kind: 'filled'; categoryId: string; path: string }
  | { kind: 'offer'; categoryId: string; path: string }
  | { kind: 'same'; path: string }
  | { kind: 'unavailable'; erpCategory: string | null }
  | { kind: 'unmapped'; erpCategory: string };

type CategoryNode = Pick<AdminCategoryNode, 'id' | 'parentId' | 'name' | 'archivedAt' | 'childCount'>;

export function planErpCategorySuggestion(
  item: Pick<ErpItemMatch, 'category' | 'mappedCategoryId'>,
  currentCategoryId: string,
  categories: readonly CategoryNode[],
): ErpCategorySuggestion | null {
  const erpCategory = item.category?.trim() || null;
  if (!item.mappedCategoryId) return erpCategory ? { kind: 'unmapped', erpCategory } : null;
  const target = categories.find((category) => category.id === item.mappedCategoryId);
  /* 상품에는 보관되지 않은 말단만 새로 연결할 수 있다(CategoryAssignmentField와 같은 규칙). */
  if (!target || target.archivedAt || target.childCount > 0) return { kind: 'unavailable', erpCategory };
  const path = categoryPath(categories, target.id).join(' > ');
  if (!currentCategoryId) return { kind: 'filled', categoryId: target.id, path };
  if (currentCategoryId === target.id) return { kind: 'same', path };
  return { kind: 'offer', categoryId: target.id, path };
}
