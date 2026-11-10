import type { AdminCategoryNode } from './category';

export interface CategoryCodeChoice { id: string; code: string; path: string }

/** Only complete, active leaf paths can be used for new workbook assignments. */
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
  return choices;
}
