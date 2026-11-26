import type { AdminCategoryNode } from './category';

export interface CategoryCodeChoice { id: string; code: string; path: string }

/**
 * 같은 상위 아래의 카테고리가 이어 보이도록 카테고리 관리와 같은 순서로 센다(상위 → 하위, 같은 단계는 노출 순서 → 코드).
 * 맨 위 단계에서 이어지지 않는 카테고리는 순서에 들지 않는다.
 */
function categoryTreeOrder(categories: readonly AdminCategoryNode[]): Map<string, number> {
  const children = new Map<string | null, AdminCategoryNode[]>();
  for (const row of categories) children.set(row.parentId, [...(children.get(row.parentId) ?? []), row]);
  const order = new Map<string, number>();
  const visit = (parent: string | null) => {
    for (const row of [...(children.get(parent) ?? [])].sort((left, right) => left.sortOrder - right.sortOrder || left.code.localeCompare(right.code))) {
      if (order.has(row.id)) continue;
      order.set(row.id, order.size);
      visit(row.id);
    }
  };
  visit(null);
  return order;
}

/** Only complete, active leaf paths can be used for new workbook assignments. 카테고리 관리와 같은 순서로 낸다. */
export function categoryCodeChoices(categories: readonly AdminCategoryNode[]): CategoryCodeChoice[] {
  const byId = new Map(categories.map(row => [row.id, row]));
  const parents = new Set(categories.filter(row => !row.archivedAt && row.parentId).map(row => row.parentId));
  const choices: CategoryCodeChoice[] = [];
  for (const leaf of categories) {
    if (leaf.archivedAt || parents.has(leaf.id)) continue;
    const path: string[] = [], seen = new Set<string>();
    let current: AdminCategoryNode | undefined = leaf, complete = false;
    while (current && !current.archivedAt && !seen.has(current.id) && path.length < 4) {
      seen.add(current.id); path.unshift(current.name);
      if (current.parentId === null) { complete = true; break; }
      current = byId.get(current.parentId);
    }
    if (complete) choices.push({ id: leaf.id, code: leaf.code, path: path.join(' > ') });
  }
  const order = categoryTreeOrder(categories);
  return choices.sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
}
