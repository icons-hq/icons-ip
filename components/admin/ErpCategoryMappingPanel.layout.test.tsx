import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdminCategoryNode } from '@/lib/admin/category';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/erp-item-actions', () => ({ setErpCategoryMappingAction: vi.fn(), setErpCategoryMappingsAction: vi.fn() }));

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
    expect(html).toContain('<colgroup><col class="w-10"/><col class="w-[28%]"/><col class="w-20"/><col/><col class="w-28"/></colgroup>');
  });

  it('결과 문구 자리를 저장 전에도 선택 칸 아래에 잡아 둔다', () => {
    expect(html.match(/aria-live="polite"/g)).toHaveLength(2);
    expect(firstRow).toMatch(/data-erp-category-pick[\s\S]*<div class="[^"]*min-h-5[^"]*">[\s\S]*aria-live="polite"/);
  });

  it('연결 필요 표시는 선택 칸 위로 줄을 더 쓰지 않는다', () => {
    expect(firstRow.indexOf('연결 필요')).toBeGreaterThan(firstRow.indexOf('data-erp-category-pick'));
  });

  /* 2026-11-25: 콤보박스를 공용 선택창으로 바꿨다. 선택 칸은 지금 값 글자와 버튼을 한 줄(32px)에 두어, 값을 고르거나 비워도 줄 높이가 그대로다. */
  it('선택 칸은 지금 값과 [카테고리 고르기]를 높이를 잡아 둔 한 줄에 둔다', () => {
    expect(firstRow).toMatch(/<div(?=[^>]*data-erp-category-pick="")(?=[^>]*class="[^"]*\bmin-h-8\b[^"]*\bitems-center\b)[^>]*><span[^>]*>연결 안 함<\/span><button[^>]*>카테고리 고르기<\/button><\/div>/);
    const linkedRow = html.slice(html.lastIndexOf('<tr'));
    /* 값이 있으면 비우는 버튼이 같은 줄 끝에 붙는다(줄을 더 쓰지 않는다). */
    expect(linkedRow).toMatch(/data-erp-category-pick=""[^>]*><span[^>]*>문구 &gt; 키링<\/span><button[^>]*>카테고리 고르기<\/button><button[^>]*>비우기<\/button><\/div>/);
    /* 닫힌 줄에는 카테고리 목록도 선택창도 없다. */
    expect(html).not.toContain('data-admin-picker');
    expect(html).not.toContain('role="combobox"');
  });

  it('ERP 분류·품목 수 글자를 선택 칸 글자와 같은 높이에 맞춘다', () => {
    expect(firstRow).toMatch(/<th(?=[^>]*scope="row")(?=[^>]*pt-3\.5)(?=[^>]*text-sm)[^>]*>없는 분류/);
    expect(firstRow).toMatch(/<td(?=[^>]*pt-3\.5)(?=[^>]*text-right)[^>]*>2</);
  });

  /* 화면 규칙 3: 표 위의 설명 두 문단은 건수 한 줄과 "?" 하나로 줄였다. 자동 연결 규칙은 "?"를 열었을 때만 보인다. */
  it('표 위에는 건수 한 줄과 자동 연결 "?"만 두고, 말단·매핑 같은 말을 쓰지 않는다', () => {
    expect(html).toContain('ERP 분류 2개 중 1개 연결됨 · <strong class="font-semibold text-warning">연결 필요 1개</strong> · 자동 연결 0개');
    expect(html.match(/aria-label="자동 연결 도움말"/g)).toHaveLength(1);
    expect(html).not.toContain('이름만 같고 경로가 다르면');
    expect(html).not.toMatch(/말단|매핑/);
    const empty = renderToStaticMarkup(<ErpCategoryMappingPanel categories={[]} categoryErpMappings={[]} rows={[row('없는 분류', null)]} />);
    expect(empty).toContain('연결할 마지막 단계 카테고리가 없습니다.');
  });
});
