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
  it('같은 상위 아래 카테고리가 이어지도록 상위 → 하위, 노출 순서 → 코드 순으로 낸다(받은 순서를 따르지 않는다)', () => {
    const at = (id: string, parentId: string | null, sortOrder: number, code = `${id}-code`): AdminCategoryNode => ({ ...node(id, parentId), sortOrder, code });
    // 서버는 노출 순서만으로 정렬해 준다 — 단계가 다른 카테고리가 뒤섞여 온다.
    const received = [at('toy', null, 1), at('doll', 'toy', 2), at('stationery', null, 2), at('key-ring', 'toy', 1), at('sticker', 'stationery', 1), at('memo', 'stationery', 1, 'a-code')];
    expect(categoryCodeChoices(received).map(row => row.path)).toEqual(['toy > key-ring', 'toy > doll', 'stationery > memo', 'stationery > sticker']);
  });
});
