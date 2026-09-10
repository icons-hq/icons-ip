export interface CatalogCategory {
  id: string; code: string; name: string; parentId: string | null; depth: number; sortOrder: number;
}

export function categoryAncestorIds(categories: readonly CatalogCategory[], id: string): string[] {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const result: string[] = [];
  let current: string | null = id;
  while (current && result.length < 4 && !result.includes(current)) {
    const category = byId.get(current);
    if (!category) return [];
    result.push(current);
    current = category.parentId;
  }
  return current ? [] : result.reverse();
}

export function orderedCatalogCategories(categories: readonly CatalogCategory[]): CatalogCategory[] {
  const result: CatalogCategory[] = [];
  const walk = (parentId: string | null, depth: number) => {
    if (depth > 4) return;
    const children = categories.filter((category) => category.parentId === parentId)
      .sort((left, right) => left.sortOrder - right.sortOrder || left.code.localeCompare(right.code));
    for (const category of children) { result.push(category); walk(category.id, depth + 1); }
  };
  walk(null, 1);
  return result;
}
