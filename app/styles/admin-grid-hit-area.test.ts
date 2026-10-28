import { readFileSync } from 'node:fs';
import postcss, { type AtRule, type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

/*
 * R11(10/27 회의 05:30): 목록의 클릭 영역. 체크박스 칸은 칸 전체가, 판매가·재고수량 값은 셀 전체가 누를 수 있어야 한다.
 * 기본은 미디어 쿼리 밖(기본 화면)의 선언만, `media`를 주면 그 미디어 블록의 선언만 본다. 같은 선택자를 여러 규칙이 정의하면 뒤의 값이 이긴다.
 */
function declarations(file: string, selector: string, media?: string) {
  const values: Record<string, string> = {};
  postcss.parse(readFileSync(new URL(file, import.meta.url), 'utf8')).walkRules((rule: Rule) => {
    const parent = rule.parent?.type === 'atrule' ? rule.parent as AtRule : null;
    if (media ? !(parent?.name === 'media' && parent.params.trim() === media) : parent) return;
    if (!rule.selectors.map(value => value.replace(/\s+/g, ' ').trim()).includes(selector)) return;
    rule.walkDecls(decl => { values[decl.prop] = decl.value; });
  });
  return values;
}

describe('콘솔 그리드 체크박스 칸', () => {
  it('label이 칸 전체를 덮어 칸 어디를 눌러도 체크박스가 바뀐다', () => {
    expect(declarations('./wc-admin-surfaces.css', '.wc-admin .admin-console-grid-table .admin-console-grid-check')).toMatchObject({ position: 'relative', padding: '0' });
    expect(declarations('./wc-admin-surfaces.css', '.wc-admin .admin-console-grid-check-hit')).toMatchObject({ position: 'absolute', inset: '0', display: 'flex', 'align-items': 'center', 'justify-content': 'center', cursor: 'pointer' });
  });
});

describe('상품 목록 바로 수정 값 버튼', () => {
  it('값 버튼은 셀 폭을 채우고 오른쪽 정렬 칸에서는 값을 오른쪽에 둔다', () => {
    expect(declarations('./admin-goods-worklist.css', '.wc-admin .admin-goods-inline')).toMatchObject({ display: 'grid', width: '100%', 'justify-items': 'stretch' });
    expect(declarations('./admin-goods-worklist.css', '.wc-admin .admin-goods-inline__value')).toMatchObject({ display: 'flex', width: '100%', 'justify-content': 'flex-start' });
    expect(declarations('./admin-goods-worklist.css', ".wc-admin td[data-align='end'] .admin-goods-inline__value")).toMatchObject({ 'justify-content': 'flex-end' });
  });
  it('판매가·재고수량 칸은 버튼의 덮개가 셀 전체를 덮고, 같은 칸의 링크는 그 위에 남는다', () => {
    expect(declarations('./admin-goods-worklist.css', '.wc-admin .admin-console-grid-table td:has(.admin-goods-inline--cell)')).toMatchObject({ position: 'relative' });
    expect(declarations('./admin-goods-worklist.css', '.wc-admin .admin-goods-inline--cell .admin-goods-inline__value::after')).toMatchObject({ content: "''", position: 'absolute', inset: '0' });
    expect(declarations('./admin-goods-worklist.css', '.wc-admin .admin-console-grid-table td:has(.admin-goods-inline--cell) :is(a, button):not(.admin-goods-inline__value)')).toMatchObject({ position: 'relative', 'z-index': '1' });
  });
  it('결과가 불명확한 저장 뒤의 \'처리 결과 조회\' 버튼도 덮개 위에 남는다(덮개가 수정 폼을 열지 않는다)', () => {
    // 덮개 예외가 링크(a)에만 걸리면 같은 칸의 복구 버튼을 눌러도 값 버튼이 눌린다(리뷰 T4-R11-1).
    expect(declarations('./admin-goods-worklist.css', '.wc-admin .admin-console-grid-table td:has(.admin-goods-inline--cell) a')).toEqual({});
  });
});

describe('인쇄', () => {
  /*
   * 인쇄에서는 틀고정 칸이 `position: static`이 되어(admin-console-controls.css) 칸이 절대배치의 기준 상자가 아니다.
   * 칸 전체 클릭 영역(체크박스 label, 바로 수정 덮개)은 인쇄에서 쓸 일이 없으므로 흐름 배치로 되돌린다(리뷰 T4-R11-2).
   */
  it('체크박스 클릭 영역과 바로 수정 덮개는 칸 밖으로 번지지 않는다', () => {
    expect(declarations('./admin-console-controls.css', '.wc-admin .admin-console-grid-table :is(th, td)[data-frozen]', 'print')).toMatchObject({ position: 'static' });
    expect(declarations('./wc-admin-surfaces.css', '.wc-admin .admin-console-grid-check-hit', 'print')).toMatchObject({ position: 'static' });
    expect(declarations('./admin-goods-worklist.css', '.wc-admin .admin-goods-inline--cell .admin-goods-inline__value::after', 'print')).toMatchObject({ content: 'none' });
  });
});
