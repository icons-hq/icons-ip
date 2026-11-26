import { describe, expect, it } from 'vitest';
import { CATEGORY_TEMPLATE_ALREADY_EXISTS, CATEGORY_TEMPLATE_CHECK_LABEL, CATEGORY_TEMPLATE_UNCERTAIN, categoryTemplateError, categoryTemplateText, parseCategoryTemplateChanges, parseCategoryTemplatePage, registrableTemplateCategories, selectedCategoryPath, usableTemplateCategory } from './category-templates';
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

const node = (id: string, name: string, parentId: string | null, extra: Partial<AdminCategoryNode> = {}): AdminCategoryNode => ({ id, code: `code-${id}`, name, parentId, depth: parentId ? 2 : 1, sortOrder: 0, archivedAt: null, updatedAt: '', childCount: 0, assignedGoodCount: 0, ...extra });

describe('등록 창에 올릴 카테고리', () => {
  const tree = [
    node('living', '리빙', null, { childCount: 2 }), node('mug', '머그', 'living'), node('cup', '컵', 'living'),
    node('paper', '문구', null, { childCount: 3 }), node('note', '노트', 'paper'), node('pen', '펜', 'paper'), node('old', '단종', 'paper', { archivedAt: '2026-10-01T00:00:00Z' }),
    node('gone', '옛 분류', null, { childCount: 1, archivedAt: '2026-09-01T00:00:00Z' }), node('under-gone', '아래', 'gone'),
    node('misc', '잡화', null),
  ];

  it('지금 쓸 수 있는 마지막 단계 카테고리만, 경로 순으로 준다 — 보관했거나 하위가 있거나 보관한 상위 아래에 있는 것은 뺀다', () => {
    const rows = registrableTemplateCategories(tree, new Set());
    expect(rows.map(row => row.id)).toEqual(['mug', 'cup', 'note', 'pen', 'misc']);
    expect(rows.map(row => row.path)).toEqual(['리빙 > 머그', '리빙 > 컵', '문구 > 노트', '문구 > 펜', '잡화']);
  });

  it('이미 등록한 카테고리는 보관한 것까지 목록에서 뺀다', () => {
    const rows = registrableTemplateCategories(tree, new Set(['note', 'mug']));
    expect(rows.map(row => row.id)).toEqual(['cup', 'pen', 'misc']);
    expect(registrableTemplateCategories(tree, new Set(tree.map(row => row.id)))).toEqual([]);
  });

  it('줄에는 경로와 코드, 찾는 글자(경로·붙여 쓴 경로·코드)가 담긴다', () => {
    const [row] = registrableTemplateCategories(tree, new Set(['cup', 'pen', 'note', 'misc']));
    expect(row).toEqual({ id: 'mug', path: '리빙 > 머그', code: 'code-mug', text: '리빙 > 머그 리빙>머그 code-mug' });
  });
});

it('고르는 창의 줄도 경로·붙여 쓴 경로·코드로 찾는다', () => {
  const row = { categoryId: id, code: 'mug', name: '머그', path: ['리빙', '머그'], usable: true, archived: false, revision: 1, createdAt: '2026-10-14T00:00:00Z' };
  expect(categoryTemplateText(row)).toBe('리빙 > 머그 리빙>머그 mug');
});

describe('화면에 보이는 말', () => {
  it('결과를 모를 때의 문장은 낱말 표의 [저장됐는지 확인]을 쓴다', () => {
    expect(CATEGORY_TEMPLATE_CHECK_LABEL).toBe('저장됐는지 확인');
    expect(CATEGORY_TEMPLATE_UNCERTAIN).toBe('저장됐는지 확인하지 못했습니다. [저장됐는지 확인]을 누르면 같은 내용이 두 번 저장되지 않습니다.');
  });

  it('쓰지 않는 말(복구·충돌·버전·요청)이 없다', () => {
    const messages = [CATEGORY_TEMPLATE_ALREADY_EXISTS, CATEGORY_TEMPLATE_UNCERTAIN, ...['category_templates_changed', 'operation_conflict', 'category_not_usable', 'category_not_found', 'operator_capability_required', undefined].map(categoryTemplateError)];
    for (const message of messages) expect(message).not.toMatch(/복구|충돌|버전|요청|사용 불가/);
  });

  it('다른 사람이 먼저 바꾼 경우는 다음에 누를 버튼 이름까지 말한다', () => {
    expect(categoryTemplateError('category_templates_changed')).toBe('다른 사람이 먼저 바꿨습니다. 고른 항목은 그대로 두었습니다. [최신 목록 다시 조회]를 누른 뒤 다시 저장해주세요.');
    expect(categoryTemplateError('category_not_usable')).toContain('등록·복원');
  });
});
