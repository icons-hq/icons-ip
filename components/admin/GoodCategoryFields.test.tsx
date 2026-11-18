import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminCategoryNode } from '@/lib/admin/category';
import { GoodCategoryField } from './GoodCategoryFields';
import { CategoryTemplatesAvailableProvider } from './CategoryTemplatesAvailability';

const categories: AdminCategoryNode[] = [
  { id: 'root', code: 'stationery', name: '문구', parentId: null, depth: 1, sortOrder: 0, archivedAt: null, updatedAt: '', childCount: 1, assignedGoodCount: 0 },
  { id: 'note', code: 'note', name: '노트', parentId: 'root', depth: 2, sortOrder: 0, archivedAt: null, updatedAt: '', childCount: 0, assignedGoodCount: 0 },
];
const field = <GoodCategoryField categories={categories} onPrimaryChange={() => {}} primary="note" />;

describe('상품 등록 대표 카테고리', () => {
  /* 운영 책임자 피드백(2026-11-10): 오른쪽 '카테고리 템플릿' 버튼이 무엇인지 몰랐고, 등록 0건이라 누르면 빈 창이었다. */
  it('등록된 자주 쓰는 카테고리가 없으면 버튼 없이 검색만 둔다', () => {
    const html = renderToStaticMarkup(field);
    expect(html).toContain('id="good-category-search"');
    expect(html).not.toContain('자주 쓰는 카테고리');
    expect(html).not.toContain('카테고리 템플릿');
  });

  it('있으면 뜻이 드러나는 이름의 버튼을 검색 옆에 보인다', () => {
    const html = renderToStaticMarkup(<CategoryTemplatesAvailableProvider available>{field}</CategoryTemplatesAvailableProvider>);
    expect(html).toMatch(/<button[^>]*>자주 쓰는 카테고리<\/button>/);
    expect(html).not.toContain('카테고리 템플릿');
  });

  it('닫혀 있을 때는 목록을 그리지 않는 combobox다', () => {
    const html = renderToStaticMarkup(field);
    expect(html).toMatch(/<input[^>]*role="combobox"/);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).not.toContain('role="listbox"');
  });

  /* ADR-0044: 상품 유형은 없다. 대표 카테고리가 있어야 공개할 수 있다고 안내한다. */
  it('카테고리 안내는 대표 카테고리가 있어야 공개할 수 있다고 말하고 상품 유형을 말하지 않는다', () => {
    const html = renderToStaticMarkup(field);
    expect(html).toContain('마지막 단계 카테고리를 하나 고릅니다. 대표 카테고리가 있어야 공개할 수 있습니다.');
    expect(html).not.toContain('상품 유형');
    expect(html).not.toContain('비워도 판매할 수 있습니다');
  });

  it('값이 없다고 알려 온 화면도 버튼을 그리지 않는다', () => {
    expect(renderToStaticMarkup(<CategoryTemplatesAvailableProvider available={false}>{field}</CategoryTemplatesAvailableProvider>)).not.toContain('자주 쓰는 카테고리');
  });
});
