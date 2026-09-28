import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { CategoryAssignmentField } from './CategoryAssignmentField';
const categories = [
  { id: 'primary', name: '문구', code: 'paper', parentId: null, depth: 1, childCount: 0, sortOrder: 0, archivedAt: null, updatedAt: '', assignedGoodCount: 1 },
  { id: 'extra', name: '신학기', code: 'school', parentId: null, depth: 1, childCount: 0, sortOrder: 0, archivedAt: '2026-09-01', updatedAt: '', assignedGoodCount: 1 },
];
it('대표와 추가 분류를 구분하고 보관된 기존 연결은 해제 가능한 값으로 보존한다', () => {
  const html = renderToStaticMarkup(<CategoryAssignmentField categories={categories} value="primary" additionalValue='["extra"]' />);
  expect(html).toContain('대표 카테고리');
  expect(html).toContain('추가 카테고리');
  expect(html).toContain('name="additionalCategoryIds"');
  expect(html).toContain('신학기 추가 분류 해제');
  expect(html).toContain('보관됨');
  expect(html).toContain('ERP');
});
