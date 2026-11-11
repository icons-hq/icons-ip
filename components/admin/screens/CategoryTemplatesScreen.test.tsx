import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { AdminCategoryNode } from '@/lib/admin/category';
import { CategoryTemplatesScreen, categoryTemplateOptions, categoryTemplateSavedMessage } from './CategoryTemplatesScreen';

it('uses a search region with non-submit buttons when embedded in a product picker', () => {
  const picker = renderToStaticMarkup(<CategoryTemplatesScreen onSelect={() => {}} />);
  expect(picker).not.toContain('<form');
  expect(picker).toContain('role="search"');
  expect(picker).toContain('type="button"');
  expect(picker).toMatch(/<button(?=[^>]*type="button")[^>]*>검색<\/button>/);
  expect(picker).not.toContain('자주 쓰는 카테고리 등록');
  const management = renderToStaticMarkup(<CategoryTemplatesScreen />);
  expect(management).toContain('<form');
  // 관리 화면의 검색은 폼 제출이다(kit 버튼의 기본 type은 button).
  expect(management).toMatch(/<button(?=[^>]*type="submit")[^>]*>검색<\/button>/);
  expect(management).toContain('자주 쓰는 카테고리 등록');
});

/* 운영 책임자 피드백(2026-11-10): '카테고리 템플릿'이 무엇인지 화면만 보고는 알 수 없었다. */
it('읽는 말은 자주 쓰는 카테고리이고, 무엇을 하는 메뉴인지 머리 설명에 드러난다', () => {
  const management = renderToStaticMarkup(<CategoryTemplatesScreen />);
  expect(management).toContain('자주 쓰는 마지막 단계 카테고리를 등록해 두면 상품 등록에서 검색 없이 목록에서 바로 고를 수 있습니다');
  expect(management).not.toContain('말단');
  expect(management).toContain('자주 쓰는 카테고리 관리');
  const picker = renderToStaticMarkup(<CategoryTemplatesScreen onSelect={() => {}} />);
  expect(picker).toContain('등록해 둔 카테고리를 고르면 대표 카테고리에 바로 채워집니다');
  for (const html of [management, picker]) expect(html).not.toContain('카테고리 템플릿');
});

/* 사람 눈 시험(2026-11-10): 복구한 적 없는데 등록할 때마다 '등록·복구했습니다'로 나왔다. */
it('저장 완료 문구는 등록·복구·보관을 실제 동작대로 말한다', () => {
  expect(categoryTemplateSavedMessage([{ categoryId: 'a', revision: 0 }], false, 1)).toBe('자주 쓰는 카테고리 1개를 등록했습니다.');
  expect(categoryTemplateSavedMessage([{ categoryId: 'a', revision: 3 }, { categoryId: 'b', revision: 2 }], false, 2)).toBe('자주 쓰는 카테고리 2개를 복구했습니다.');
  expect(categoryTemplateSavedMessage([{ categoryId: 'a', revision: 1 }], true, 1)).toBe('자주 쓰는 카테고리 1개를 보관했습니다.');
});

it('등록 창의 선택지는 지금 쓸 수 있는 마지막 단계 카테고리를 경로 순으로 주고 코드로도 찾게 한다', () => {
  const node = (id: string, name: string, parentId: string | null, extra: Partial<AdminCategoryNode> = {}): AdminCategoryNode => ({ id, code: `code-${id}`, name, parentId, depth: parentId ? 2 : 1, sortOrder: 0, archivedAt: null, updatedAt: '', childCount: 0, assignedGoodCount: 0, ...extra });
  const options = categoryTemplateOptions([
    node('living', '리빙', null, { childCount: 1 }), node('cup', '머그', 'living'),
    node('paper', '문구', null, { childCount: 2 }), node('note', '노트', 'paper'), node('old', '단종', 'paper', { archivedAt: '2026-10-01T00:00:00Z' }),
  ]);
  expect(options).toEqual([
    { value: 'cup', label: '리빙 > 머그', keywords: '리빙>머그 code-cup' },
    { value: 'note', label: '문구 > 노트', keywords: '문구>노트 code-note' },
  ]);
});
