import { expect, it } from 'vitest';
import { parseCategoryTemplateChanges, parseCategoryTemplatePage, selectedCategoryPath, usableTemplateCategory } from './category-templates';
import type { AdminCategoryNode } from './category';
const id = '94700000-0000-4000-8000-000000000101';
it('normalizes a batch and rejects duplicate or unbounded revisions before writes', () => {
  expect(parseCategoryTemplateChanges([{ categoryId: id.toUpperCase(), revision: 0, ignored: 'not sent' }])).toEqual([{ categoryId: id, revision: 0 }]);
  expect(parseCategoryTemplateChanges([{ categoryId: id, revision: 0 }, { categoryId: id, revision: 1 }])).toBeNull();
  expect(parseCategoryTemplateChanges([{ categoryId: id, revision: -1 }])).toBeNull();
  expect(parseCategoryTemplateChanges(Array.from({ length: 101 }, () => ({ categoryId: id, revision: 0 })))).toBeNull();
});
it('does not accept malformed, oversized or duplicated template pages', () => {
  const row = { categoryId: id, code: 'stationery', name: '문구', path: ['굿즈', '문구'], usable: true, archived: false, revision: 1, createdAt: '2026-10-14T00:00:00Z' };
  const page = { rows: [row], total: 1, page: 1, pageSize: 20 };
  expect(parseCategoryTemplatePage(page)).toEqual(page);
  for (const changed of [{ ...page, rows: [row, row], total: 2 }, { ...page, rows: [{ ...row, path: [] }] }, { ...page, rows: [{ ...row, createdAt: 'bad' }] }, { ...page, total: 0 }]) expect(parseCategoryTemplatePage(changed)).toBeNull();
});
it('a saved template remains unusable if its leaf or an ancestor was archived or acquired children', () => {
  const node = (id: string, parentId: string | null, childCount = 0): AdminCategoryNode => ({ id, parentId, childCount, name: id, code: id, depth: parentId ? 2 : 1, archivedAt: null, sortOrder: 0, assignedGoodCount: 0, updatedAt: '' });
  const tree = [node('root', null, 1), node('leaf', 'root')];
  expect(selectedCategoryPath(tree, 'leaf').map(row => row.id)).toEqual(['root', 'leaf']);
  expect(usableTemplateCategory(tree, 'leaf')).toBe(true);
  expect(usableTemplateCategory(tree, 'root')).toBe(false);
  expect(usableTemplateCategory([{ ...tree[0], archivedAt: '2026-10-14' }, tree[1]], 'leaf')).toBe(false);
  expect(usableTemplateCategory([tree[0], { ...tree[1], childCount: 1 }], 'leaf')).toBe(false);
  expect(usableTemplateCategory([tree[1]], 'leaf')).toBe(false);
});
