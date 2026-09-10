import { describe, expect, it } from 'vitest';
import {
  CATEGORY_MAX_DEPTH,
  categoryActivationLabel,
  categoryDepthMap,
  categoryDescendantIds,
  categoryParentOptions,
  categoryPath,
  isCategoryLeaf,
  normalizeCategoryForm,
  validateCategoryMove,
} from './category';

const nodes = [
  { id: '00000000-0000-4000-8000-000000000001', parentId: null, name: '생활', depth: 1, sortOrder: 1, archivedAt: null, updatedAt: '2026-09-10T00:00:00Z', childCount: 1, assignedGoodCount: 0, code: 'life' },
  { id: '00000000-0000-4000-8000-000000000002', parentId: '00000000-0000-4000-8000-000000000001', name: '문구', depth: 2, sortOrder: 1, archivedAt: null, updatedAt: '2026-09-10T00:00:00Z', childCount: 1, assignedGoodCount: 0, code: 'paper' },
  { id: '00000000-0000-4000-8000-000000000003', parentId: '00000000-0000-4000-8000-000000000002', name: '노트', depth: 3, sortOrder: 1, archivedAt: null, updatedAt: '2026-09-10T00:00:00Z', childCount: 1, assignedGoodCount: 0, code: 'notebook' },
  { id: '00000000-0000-4000-8000-000000000004', parentId: '00000000-0000-4000-8000-000000000003', name: '한정판', depth: 4, sortOrder: 1, archivedAt: null, updatedAt: '2026-09-10T00:00:00Z', childCount: 0, assignedGoodCount: 0, code: 'limited' },
];

describe('category domain contract', () => {
  it('accepts up to four levels and builds paths', () => {
    const depth = categoryDepthMap(nodes);
    expect(depth.get(nodes[3].id)).toBe(CATEGORY_MAX_DEPTH);
    expect(categoryPath(nodes, nodes[3].id)).toEqual(['생활', '문구', '노트', '한정판']);
  });

  it('rejects cycles and fifth-level moves while allowing a leaf to move', () => {
    expect(validateCategoryMove(nodes, nodes[3].id, nodes[1].id)).toBeNull();
    expect(validateCategoryMove(nodes, nodes[0].id, nodes[3].id)).toBe('category_cycle');
    const five = [...nodes, {
      id: '00000000-0000-4000-8000-000000000005',
      parentId: nodes[3].id,
      name: '다섯째',
    }];
    expect(validateCategoryMove(five, nodes[3].id, nodes[2].id)).toBe('category_depth_exceeded');
  });

  it('keeps descendants out of parent choices and distinguishes leaves', () => {
    const enriched = nodes.map((node) => ({ ...node, archivedAt: null }));
    expect(categoryDescendantIds(enriched, nodes[0].id)).toEqual(new Set([nodes[1].id, nodes[2].id, nodes[3].id]));
    expect(categoryParentOptions(enriched, nodes[1].id).map((node) => node.id)).toEqual([nodes[0].id]);
    expect(isCategoryLeaf(enriched, nodes[2].id)).toBe(false);
    expect(isCategoryLeaf(enriched, nodes[3].id)).toBe(true);
  });

  it('validates names/codes without inventing ERP or category values', () => {
    expect(normalizeCategoryForm({ code: 'goods-paper', name: '문구', sortOrder: 0 })).toMatchObject({ ok: true });
    expect(normalizeCategoryForm({ code: '한글', name: '', sortOrder: -1 })).toMatchObject({
      ok: false,
      errors: { invalid_code: expect.any(String), invalid_name: expect.any(String), invalid_sort_order: expect.any(String) },
    });
    expect(categoryActivationLabel({ customerEnabled: true, erpEnabled: false, customerEvidence: null, erpEvidence: null, updatedAt: null }))
      .toContain('ERP 미설정');
  });
});
