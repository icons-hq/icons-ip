import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminCategoryNode } from '@/lib/admin/category';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/erp-item-actions', () => ({ setErpCategoryMappingAction: vi.fn() }));

import { ErpCategoryMappingPanel } from './ErpCategoryMappingPanel';

const node = (id: string, name: string, parentId: string | null, extra: Partial<AdminCategoryNode> = {}): AdminCategoryNode => ({
  id, code: id, name, parentId, depth: parentId ? 2 : 1, sortOrder: 0, archivedAt: null, updatedAt: '', childCount: 0, assignedGoodCount: 0, ...extra,
});
const categories = [node('p', '문구', null, { childCount: 1 }), node('k', '키링', 'p')];
const row = (erpCategory: string, categoryId: string | null) => ({ erpCategory, itemCount: 2, categoryId, updatedAt: null, fallbackCategoryId: null });
const html = renderToStaticMarkup(<ErpCategoryMappingPanel categories={categories} categoryErpMappings={[]} rows={[row('없는 분류', null), row('문구 > 키링', 'k')]} />);
const firstRow = html.slice(html.indexOf('<tbody'), html.indexOf('</tr>', html.indexOf('<tbody')));

/* 사람 눈 시험(2026-11-10): 저장 직후 고객 카테고리 열이 50px 좁아지고 행 높이가 10px 줄어 아래 행이 올라왔다. */
describe('ERP 분류 연결 표의 배치', () => {
  it('표 레이아웃과 열 폭을 고정한다', () => {
    expect(html).toMatch(/<table class="[^"]*table-fixed/);
    expect(html).toContain('<colgroup><col class="w-[28%]"/><col class="w-20"/><col/><col class="w-28"/></colgroup>');
  });

  it('결과 문구 자리를 저장 전에도 선택 칸 아래에 잡아 둔다', () => {
    expect(html.match(/aria-live="polite"/g)).toHaveLength(2);
    expect(firstRow).toMatch(/data-admin-search-select[\s\S]*<div class="[^"]*min-h-5[^"]*">[\s\S]*aria-live="polite"/);
  });

  it('연결 필요 표시는 선택 칸 위로 줄을 더 쓰지 않는다', () => {
    expect(firstRow.indexOf('연결 필요')).toBeGreaterThan(firstRow.indexOf('data-admin-search-select'));
  });

  it('ERP 분류·품목 수 글자를 선택 칸 글자와 같은 높이에 맞춘다', () => {
    expect(firstRow).toMatch(/<th(?=[^>]*scope="row")(?=[^>]*pt-3\.5)(?=[^>]*text-sm)[^>]*>없는 분류/);
    expect(firstRow).toMatch(/<td(?=[^>]*pt-3\.5)(?=[^>]*text-right)[^>]*>2</);
  });

  it('설명은 말단 대신 쉬운 말로 쓴다', () => {
    expect(html).toContain('여기서 연결해도 상품은 바뀌지 않습니다.');
    expect(html).toContain('마지막 단계 카테고리');
    expect(html).toContain('이름만 같고 경로가 다르면 연결하지 않습니다.');
    expect(html).not.toContain('말단');
    const empty = renderToStaticMarkup(<ErpCategoryMappingPanel categories={[]} categoryErpMappings={[]} rows={[row('없는 분류', null)]} />);
    expect(empty).toContain('연결할 마지막 단계 카테고리가 없습니다.');
  });
});
