import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { AdminCategoryNode } from '@/lib/admin/category';
import { GoodAdditionalCategoryField, GoodCategoryField } from './GoodCategoryFields';
import { CategoryTemplatesAvailableProvider } from './CategoryTemplatesAvailability';

const categories: AdminCategoryNode[] = [
  { id: 'root', code: 'stationery', name: '문구', parentId: null, depth: 1, sortOrder: 0, archivedAt: null, updatedAt: '', childCount: 1, assignedGoodCount: 0 },
  { id: 'note', code: 'note', name: '노트', parentId: 'root', depth: 2, sortOrder: 0, archivedAt: null, updatedAt: '', childCount: 0, assignedGoodCount: 0 },
];
const field = <GoodCategoryField categories={categories} onPrimaryChange={() => {}} primary="note" />;

describe('상품 등록 대표 카테고리', () => {
  /* 운영 책임자 피드백(2026-11-10): 오른쪽 '카테고리 템플릿' 버튼이 무엇인지 몰랐고, 등록 0건이라 누르면 빈 창이었다. */
  it('등록된 자주 쓰는 카테고리가 없으면 버튼 없이 선택 버튼만 둔다', () => {
    const html = renderToStaticMarkup(field);
    expect(html).toContain('id="good-category-display"');
    expect(html).not.toContain('자주 쓰는 카테고리</button>');
    expect(html).not.toContain('카테고리 템플릿');
  });

  it('있으면 뜻이 드러나는 이름의 버튼을 선택 버튼 옆에 보인다', () => {
    const html = renderToStaticMarkup(<CategoryTemplatesAvailableProvider available>{field}</CategoryTemplatesAvailableProvider>);
    expect(html).toMatch(/<button[^>]*>자주 쓰는 카테고리<\/button>/);
    expect(html).not.toContain('카테고리 템플릿');
  });

  it('고른 경로를 읽기 전용 상자에 보이고 선택창은 닫혀 있다', () => {
    const html = renderToStaticMarkup(field);
    expect(html).toMatch(/<input[^>]*id="good-category-display"[^>]*readOnly=""/);
    expect(html).toContain('value="문구 &gt; 노트"');
    expect(html).toMatch(/<button[^>]*>바꾸기<\/button>/);
    expect(html).toMatch(/<button[^>]*>선택 해제<\/button>/);
    expect(html).not.toContain('role="listbox"');
    expect(html).not.toContain('role="combobox"');
    expect(html).not.toContain('<dialog');
  });

  it('고르지 않았으면 [카테고리 선택]만 보인다', () => {
    const html = renderToStaticMarkup(<GoodCategoryField categories={categories} onPrimaryChange={() => {}} primary="" />);
    expect(html).toMatch(/<button[^>]*>카테고리 선택<\/button>/);
    expect(html).not.toContain('선택 해제');
    expect(html).toContain('placeholder="아직 고르지 않았습니다"');
  });

  it('이름 옆 "?"는 칸 이름과 한 줄로 놓이고, 안내 글은 칸 아래에 늘어놓지 않는다', () => {
    const html = renderToStaticMarkup(field);
    expect(html).toContain('data-admin-help-label');
    expect(html).toContain('aria-label="대표 카테고리 도움말"');
    expect(html).not.toContain('마지막 단계 카테고리를 하나 고릅니다');
    expect(html).not.toContain('상품 유형');
  });

  /* 제출 값은 숨긴 select 하나다 — 화면이 바뀌어도 폼 이름·id는 그대로다. */
  it('숨긴 select가 대표 카테고리를 name="categoryId"로 제출한다', () => {
    const html = renderToStaticMarkup(field);
    expect(html).toMatch(/<select[^>]*id="good-category-primary"[^>]*name="categoryId"/);
    expect(html).toContain('hidden=""');
    expect(html).toMatch(/<option value="note" selected="">문구 &gt; 노트 \(note\)<\/option>/);
    expect(html).toContain('data-good-category=""');
  });

  it('값이 없다고 알려 온 화면도 버튼을 그리지 않는다', () => {
    expect(renderToStaticMarkup(<CategoryTemplatesAvailableProvider available={false}>{field}</CategoryTemplatesAvailableProvider>)).not.toContain('자주 쓰는 카테고리</button>');
  });
});

describe('상품 등록 추가 카테고리', () => {
  it('고른 분류를 줄로 보이고 같은 이름의 hidden 입력으로 제출한다', () => {
    const html = renderToStaticMarkup(<GoodAdditionalCategoryField categories={categories} primary="" value='["note"]' />);
    expect(html).toContain('data-good-category-additional=""');
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="additionalCategoryIds"[^>]*value="\[&quot;note&quot;\]"/);
    expect(html).toContain('문구 &gt; 노트');
    expect(html).toContain('aria-label="노트 추가 카테고리 해제"');
    expect(html).toMatch(/<button[^>]*>카테고리 추가<\/button>/);
  });

  it('전체를 늘어놓는 드롭다운과 늘 보이는 안내 글이 없고, "?"로 설명한다', () => {
    const html = renderToStaticMarkup(<GoodAdditionalCategoryField categories={categories} primary="" value="[]" />);
    expect(html).not.toContain('<select');
    expect(html).not.toContain('추가할 카테고리 선택');
    expect(html).not.toContain('상품 목록에서 대표·추가 카테고리로 찾을 수 있습니다');
    expect(html).toContain('aria-label="추가 카테고리 도움말"');
  });

  it('대표 카테고리와 같은 분류는 제출 값에서 뺀다', () => {
    const html = renderToStaticMarkup(<GoodAdditionalCategoryField categories={categories} primary="note" value='["note"]' />);
    expect(html).toMatch(/name="additionalCategoryIds"[^>]*value="\[\]"/);
  });
});
