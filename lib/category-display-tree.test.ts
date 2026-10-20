import { describe, expect, it } from 'vitest';
import { categoryDisplayParentChoices, parseCategoryDisplayDirectory, parseCategoryDisplayTreeChange } from './category-display';
const id = (n: number) => `94931000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const node = (n: number, parent: number | null, depth: number, archivedAt: string | null = null) => ({ id: id(n), name: `전시 ${n}`, parentId: parent === null ? null : id(parent), depth, sortOrder: n, publicEnabled: archivedAt === null, archivedAt, legacyCategoryId: null });
const source = { id: id(99), name: '실제 상품분류', parentId: null, depth: 1, sortOrder: 0, publicEnabled: true };
const directory = { categories: [node(1, null, 1), node(2, 1, 2), node(3, 2, 3), node(4, 3, 4), node(5, null, 1, '2026-10-14T00:00:00Z'), node(6, 5, 2)], sourceCategories: [source], revision: 9, checkedAt: '2026-10-14T00:00:00Z' };
describe('독립 전시분류 계약', () => {
  it('기존 4단계는 보존하며 상품분류는 별도 목록으로 받는다', () => {
    expect(parseCategoryDisplayDirectory(directory)).toEqual(directory);
    expect(parseCategoryDisplayDirectory({ ...directory, categories: [...directory.categories, node(1, null, 1)] })).toBeNull();
    expect(parseCategoryDisplayDirectory({ ...directory, categories: [node(2, 1, 2)] })).toBeNull();
    expect(parseCategoryDisplayDirectory({ ...directory, categories: [node(1, null, 2)] })).toBeNull();
    expect(parseCategoryDisplayDirectory({ ...directory, sourceCategories: [source, source] })).toBeNull();
    expect(parseCategoryDisplayDirectory({ ...directory, revision: -1 })).toBeNull();
  });
  it('상위 후보에서 자기 자신·자손·보관 조상·3단계 이상을 뺀다', () => {
    expect(categoryDisplayParentChoices(directory, id(2)).map(item => item.id)).toEqual([id(1)]);
    expect(categoryDisplayParentChoices(directory, null).map(item => item.id)).toEqual([id(1), id(2)]);
  });
  it('생성·수정·보관 명령을 정확히 검증하며 원본을 변경하지 않는다', () => {
    const change = { action: 'create', id: id(10), name: '홍실 퀘스트', parentId: null, position: 0 };
    expect(parseCategoryDisplayTreeChange(change)).toEqual(change);
    for (const invalid of [{ ...change, name: '가'.repeat(21) }, { ...change, name: ' 앞뒤 공백 ' }, { ...change, name: '금지\n줄바꿈' }, { ...change, parentId: id(10) }, { ...change, position: 1.5 }, { ...change, extra: true }]) expect(parseCategoryDisplayTreeChange(invalid)).toBeNull();
    expect(parseCategoryDisplayTreeChange({ action: 'archive', id: id(1) })).toEqual({ action: 'archive', id: id(1) });
    expect(parseCategoryDisplayTreeChange({ action: 'restore', id: id(1), name: '불필요' })).toBeNull();
  });
});
