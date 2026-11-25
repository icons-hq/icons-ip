import { describe, expect, it } from 'vitest';
import {
  CATEGORY_MAX_DEPTH,
  categoriesInTreeOrder,
  categoryArchiveConfirm,
  categoryAutoCode,
  categoryDepthMap,
  categoryDescendantIds,
  categoryMoveOrder,
  categoryParentOptions,
  categoryPath,
  categorySiblings,
  categorySubtreeHeight,
  isCategoryLeaf,
  nextCategorySortOrder,
  normalizeCategoryForm,
  validateCategoryMove,
  type AdminCategoryNode,
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
  });

  /* 오류는 어느 칸이 왜 안 되는지와 고칠 방법을 함께 말한다. 순서는 운영자가 적는 칸이 없으므로 새로고침을 안내한다. */
  it('names the field and the fix in validation messages', () => {
    const result = normalizeCategoryForm({ code: '한글', name: '문구', sortOrder: -1 });
    expect(result).toMatchObject({ ok: false, errors: {
      invalid_code: '카테고리 코드는 영문 소문자·숫자·하이픈(-)만 쓰고, 영문이나 숫자로 시작해야 합니다. 80자까지 쓸 수 있습니다.',
      invalid_sort_order: '카테고리 순서를 읽지 못했습니다. 새로고침한 뒤 다시 저장해주세요.',
    } });
  });
});

/* 화면 규칙 2: 저장할 때 거절되는 상위 카테고리는 선택창에 넣지 않는다. DB의 판정(private.category_validate_parent·guard_category_tree)과 같아야 한다. */
describe('상위 카테고리로 고를 수 있는 카테고리', () => {
  const node = (id: string, parentId: string | null, extra: Partial<AdminCategoryNode> = {}): AdminCategoryNode => ({
    id, code: id, name: id, parentId, depth: 1, sortOrder: 0, archivedAt: null, updatedAt: '', childCount: 0, assignedGoodCount: 0, ...extra,
  });
  const ids = (list: AdminCategoryNode[]) => list.map((item) => item.id);

  it('새 카테고리: 4단계·상품이 연결된 카테고리·보관했거나 보관한 상위 아래의 카테고리를 뺀다', () => {
    const tree = [
      node('a', null), node('a1', 'a'), node('a2', 'a1'), node('a3', 'a2'),
      node('goods', null, { assignedGoodCount: 2 }),
      node('old', null, { archivedAt: '2026-10-01T00:00:00Z' }), node('old-child', 'old'),
    ];
    expect(ids(categoryParentOptions(tree, null))).toEqual(['a', 'a1', 'a2']);
  });

  it('고치는 카테고리: 자기와 하위를 빼고, 하위를 데리고 가도 4단계를 넘지 않는 곳만 남긴다', () => {
    const tree = [node('a', null), node('a1', 'a'), node('a2', 'a1'), node('b', null), node('b1', 'b'), node('b2', 'b1'), node('c', null)];
    /* b는 아래로 두 단계(b1 > b2)를 데리고 간다: 1단계 카테고리 아래로만 갈 수 있다. */
    expect(categorySubtreeHeight(tree, 'b')).toBe(2);
    expect(categorySubtreeHeight(tree, 'c')).toBe(0);
    expect(ids(categoryParentOptions(tree, 'b'))).toEqual(['a', 'c']);
    expect(ids(categoryParentOptions(tree, 'c'))).toEqual(['a', 'a1', 'a2', 'b', 'b1', 'b2']);
  });

  it('지금의 상위는 상품이 연결돼 있어도 남긴다(상위를 바꾸지 않는 저장은 거절되지 않는다)', () => {
    const tree = [node('p', null, { assignedGoodCount: 1 }), node('child', 'p', { archivedAt: '2026-10-01T00:00:00Z' }), node('q', null, { assignedGoodCount: 1 })];
    expect(ids(categoryParentOptions(tree, 'child'))).toEqual(['p']);
  });

  it('목록 순서는 상위 아래에 하위, 같은 단계는 순서 값 → 코드다', () => {
    const tree = [node('z', null, { sortOrder: 0 }), node('m', null, { sortOrder: 1 }), node('m-b', 'm', { sortOrder: 1 }), node('m-a', 'm', { sortOrder: 1 }), node('z-1', 'z')];
    expect(ids(categoriesInTreeOrder(tree))).toEqual(['z', 'z-1', 'm', 'm-a', 'm-b']);
    expect(ids(categorySiblings(tree, 'm'))).toEqual(['m-a', 'm-b']);
    expect(ids(categorySiblings(tree, null))).toEqual(['z', 'm']);
  });
});

describe('카테고리 순서', () => {
  const node = (id: string, parentId: string | null, sortOrder: number, extra: Partial<AdminCategoryNode> = {}): AdminCategoryNode => ({
    id, code: id, name: id, parentId, depth: 1, sortOrder, archivedAt: null, updatedAt: '', childCount: 0, assignedGoodCount: 0, ...extra,
  });
  /* 직접 만든 카테고리는 순서 값이 모두 0이다. 두 줄의 값만 맞바꾸면 아무 일도 일어나지 않으므로 같은 상위 아래 전체를 새 순서로 보낸다. */
  const tree = [node('root', null, 0), node('a', 'root', 0), node('b', 'root', 0), node('c', 'root', 0, { archivedAt: '2026-10-01T00:00:00Z' }), node('other', null, 1)];

  it('[위로]·[아래로]는 같은 상위 아래의 카테고리 전체(보관 포함)를 새 순서로 돌려준다', () => {
    expect(categoryMoveOrder(tree, 'b', 'up')).toEqual({ parentId: 'root', orderedIds: ['b', 'a', 'c'] });
    expect(categoryMoveOrder(tree, 'b', 'down')).toEqual({ parentId: 'root', orderedIds: ['a', 'c', 'b'] });
    expect(categoryMoveOrder(tree, 'root', 'down')).toEqual({ parentId: null, orderedIds: ['other', 'root'] });
  });

  it('맨 위에서 위로, 맨 아래에서 아래로, 없는 카테고리는 옮길 곳이 없다', () => {
    expect(categoryMoveOrder(tree, 'a', 'up')).toBeNull();
    expect(categoryMoveOrder(tree, 'c', 'down')).toBeNull();
    expect(categoryMoveOrder(tree, 'missing', 'up')).toBeNull();
  });

  it('새로 넣거나 다른 상위로 옮긴 카테고리는 그 상위 아래 맨 끝에 놓는다', () => {
    expect(nextCategorySortOrder(tree, 'root')).toBe(1);
    expect(nextCategorySortOrder(tree, null)).toBe(2);
    expect(nextCategorySortOrder(tree, 'a')).toBe(0);
    /* 자기 자신은 세지 않는다(같은 상위에 다시 놓일 때). */
    expect(nextCategorySortOrder(tree, null, 'other')).toBe(1);
  });
});

describe('카테고리 자동 코드와 보관 확인', () => {
  it('자동 코드는 작업 번호에서 만들어 같은 저장을 다시 보내도 같고, 코드 규칙에 맞는다', () => {
    const code = categoryAutoCode('1A2B3C4D-5E6F-4000-8000-000000000001');
    expect(code).toBe('c-1a2b3c4d5e');
    expect(categoryAutoCode('1A2B3C4D-5E6F-4000-8000-000000000001')).toBe(code);
    expect(normalizeCategoryForm({ code, name: '문구', sortOrder: 0 })).toMatchObject({ ok: true });
  });

  it('보관 확인창은 연결된 상품 수와 고객 화면에서 달라지는 것을 적는다', () => {
    const linked = categoryArchiveConfirm({ name: '문구', assignedGoodCount: 1234 });
    expect(linked.title).toBe("'문구' 카테고리를 보관할까요?");
    expect(linked.message).toContain('연결된 상품 1,234개는 그대로 판매됩니다.');
    expect(linked.message).toContain('고객 화면의 카테고리 목록에 이 카테고리로는 나오지 않고');
    expect(linked.message).toContain('쿠폰도 이 카테고리로는 적용되지 않습니다.');
    expect(linked.message).toContain('[복원]을 누르면 되돌아옵니다.');
    expect(linked.confirmLabel).toBe('보관');
    const empty = categoryArchiveConfirm({ name: '문구', assignedGoodCount: 0 });
    expect(empty.message).toContain('연결된 상품은 없습니다.');
    expect(empty.message).not.toContain('쿠폰');
  });
});

/* ADR-0044: 상품 유형 연결은 없다. 폼에 옛 goodType 값이 와도 읽지도 거절하지도 않는다. */
describe('category form without good type', () => {
  it('ignores a legacy goodType input and no longer reports invalid_good_type', () => {
    const base = { code: 'paper', name: '문구', parentId: null, sortOrder: '0' };
    for (const goodType of [undefined, '', '피규어', '포스터']) {
      const result = normalizeCategoryForm({ ...base, goodType } as Parameters<typeof normalizeCategoryForm>[0]);
      expect(result).toMatchObject({ ok: true });
      expect((result as { value: object }).value).not.toHaveProperty('goodType');
    }
  });
});
