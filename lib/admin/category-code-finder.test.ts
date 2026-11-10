import { describe, expect, it } from 'vitest';
import { categoryCodeChoices } from './category-code-finder';
import type { AdminCategoryNode } from './category';

function node(id: string, parentId: string | null = null, archivedAt: string | null = null): AdminCategoryNode {
  return { id, parentId, archivedAt, name: id, code: `${id}-code`, depth: 1, sortOrder: 0, updatedAt: '', childCount: 0, assignedGoodCount: 0 };
}
describe('category code choices', () => {
  it('excludes parents and archived ancestors while preserving complete active paths', () => {
    expect(categoryCodeChoices([node('root'), node('leaf', 'root'), node('archived', null, '2026-10-14'), node('hidden-child', 'archived'), node('missing', 'absent')]))
      .toEqual([{ id: 'leaf', code: 'leaf-code', path: 'root > leaf' }]);
  });
  it('ignores archived children and refuses cycles and paths deeper than four levels', () => {
    expect(categoryCodeChoices([node('leaf'), node('archived-child', 'leaf', '2026-10-14'), node('cycle-a', 'cycle-b'), node('cycle-b', 'cycle-a'), node('one'), node('two', 'one'), node('three', 'two'), node('four', 'three'), node('five', 'four')]))
      .toEqual([{ id: 'leaf', code: 'leaf-code', path: 'leaf' }]);
  });
});
