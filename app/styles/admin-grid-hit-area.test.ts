import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * R11(10/27 회의 05:30): 목록의 클릭 영역. 체크박스 칸은 칸 전체를 누를 수 있어야 한다.
 * ADR-0028 이후 콘솔 표(ConsoleGrid)는 kit 유틸리티로 그리므로 마크업의 클래스로 확인한다. 판매가·재고수량 값의 칸 전체
 * 덮개는 GoodsInlineEdit.test.tsx가 맡는다.
 */
const grid = readFileSync(new URL('../../components/admin/console/ConsoleGrid.tsx', import.meta.url), 'utf8');
const classesOf = (tag: string) => [...grid.matchAll(new RegExp(`<${tag} className=\\{?[\`"]([^\`"]+)[\`"]`, 'g'))].map((match) => match[1].split(/\s+/));

describe('콘솔 그리드 체크박스 칸', () => {
  it('label이 칸 전체를 덮어 칸 어디를 눌러도 체크박스가 바뀐다', () => {
    const cells = [...classesOf('th'), ...classesOf('td')].filter((tokens) => tokens.includes('w-10'));
    expect(cells).toHaveLength(2);
    for (const tokens of cells) expect(tokens).toEqual(expect.arrayContaining(['relative', 'p-0', 'min-w-10']));
    const labels = classesOf('label');
    expect(labels).toHaveLength(2);
    for (const tokens of labels) expect(tokens).toEqual(expect.arrayContaining(['absolute', 'inset-0', 'flex', 'items-center', 'justify-center', 'cursor-pointer']));
  });
});

describe('인쇄', () => {
  /* 인쇄에서는 고정 칸이 흐름 배치(static)가 되어 칸이 절대배치의 기준 상자가 아니다. 클릭 영역 label도 흐름으로 되돌린다(리뷰 T4-R11-2). */
  it('체크박스 클릭 영역은 칸 밖으로 번지지 않는다', () => {
    expect(grid).toContain("print:data-[frozen]:static");
    for (const tokens of classesOf('label')) expect(tokens).toContain('print:static');
  });
});
