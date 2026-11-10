import { expect, it } from 'vitest';
import { planErpCategorySuggestion } from './goods-erp-suggestion';

const categories = [
  { id: 'root', name: '문구', parentId: null, archivedAt: null, childCount: 1 },
  { id: 'leaf', name: '노트', parentId: 'root', archivedAt: null, childCount: 0 },
  { id: 'other', name: '키링', parentId: null, archivedAt: null, childCount: 0 },
  { id: 'old', name: '보관 분류', parentId: null, archivedAt: '2026-09-01', childCount: 0 },
];

it('대표 카테고리가 비어 있을 때만 ERP 연결 카테고리를 채우고, 이미 있으면 바꾸기만 제안한다', () => {
  const item = { category: 'ERP 문구', mappedCategoryId: 'leaf' };
  expect(planErpCategorySuggestion(item, '', categories)).toEqual({ kind: 'filled', categoryId: 'leaf', path: '문구 > 노트' });
  expect(planErpCategorySuggestion(item, 'other', categories)).toEqual({ kind: 'offer', categoryId: 'leaf', path: '문구 > 노트' });
  expect(planErpCategorySuggestion(item, 'leaf', categories)).toEqual({ kind: 'same', path: '문구 > 노트' });
});

it('연결이 없거나 쓸 수 없는 카테고리는 채우지 않고 ERP 원문만 안내한다', () => {
  expect(planErpCategorySuggestion({ category: ' ERP 문구 ', mappedCategoryId: null }, '', categories)).toEqual({ kind: 'unmapped', erpCategory: 'ERP 문구' });
  expect(planErpCategorySuggestion({ category: null, mappedCategoryId: null }, '', categories)).toBeNull();
  for (const mappedCategoryId of ['root', 'old', 'missing']) {
    expect(planErpCategorySuggestion({ category: 'ERP 문구', mappedCategoryId }, '', categories)).toEqual({ kind: 'unavailable', erpCategory: 'ERP 문구' });
  }
});
