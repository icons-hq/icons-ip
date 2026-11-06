import { readFileSync } from 'node:fs';
import postcss, { type Rule } from 'postcss';
import { mediaOf, withoutKitGuard } from './css-cascade.test-helpers';
import { describe, expect, it } from 'vitest';

/*
 * R11(10/27 회의 05:30): 목록의 클릭 영역. 체크박스 칸은 칸 전체가, 판매가·재고수량 값은 셀 전체가 누를 수 있어야 한다.
 * 기본은 미디어 쿼리 밖(기본 화면)의 선언만, `media`를 주면 그 미디어 블록의 선언만 본다. 같은 선택자를 여러 규칙이 정의하면 뒤의 값이 이긴다.
 *
 * 상품 목록의 바로 수정 덮개는 kit 템플릿 룩으로 옮기며(ADR-0028) 관리자 CSS가 아니라 마크업 유틸리티가 맡는다. 같은 의도를 마크업에서 확인한다:
 * - components/admin/GoodsInlineEdit.test.tsx — 값 버튼이 칸 폭을 채우고 오른쪽 정렬 칸에서 오른쪽에 선다, 덮개(::after)가 감싼 칸을
 *   기준 상자로 세워 칸 전체를 덮는다, '처리 결과 조회' 버튼은 덮개 위에 남는다, 인쇄에서는 덮개를 걷는다.
 * - components/admin/screens/GoodsListScreen.test.tsx — 판매가·재고수량 칸이 덮개형 값 버튼을 쓰고, 같은 칸의 보조 링크는 덮개 위에 남으며,
 *   칸 전체가 선택 영역인 체크박스 칸이 좁은 화면에서 접히지 않는다.
 */
function declarations(file: string, selector: string, media?: string) {
  const values: Record<string, string> = {};
  postcss.parse(readFileSync(new URL(file, import.meta.url), 'utf8')).walkRules((rule: Rule) => {
    const parent = mediaOf(rule);
    if (media ? !(parent && parent.params.trim() === media) : parent) return;
    if (!rule.selectors.map(withoutKitGuard).includes(selector)) return;
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

describe('인쇄', () => {
  /*
   * 인쇄에서는 틀고정 칸이 `position: static`이 되어(admin-console-controls.css) 칸이 절대배치의 기준 상자가 아니다.
   * 칸 전체 클릭 영역(체크박스 label)은 인쇄에서 쓸 일이 없으므로 흐름 배치로 되돌린다(리뷰 T4-R11-2). 바로 수정 덮개는 값 버튼의
   * `print:after:hidden`이 걷는다(GoodsInlineEdit.test.tsx).
   */
  it('체크박스 클릭 영역은 칸 밖으로 번지지 않는다', () => {
    expect(declarations('./admin-console-controls.css', '.wc-admin .admin-console-grid-table :is(th, td)[data-frozen]', 'print')).toMatchObject({ position: 'static' });
    expect(declarations('./wc-admin-surfaces.css', '.wc-admin .admin-console-grid-check-hit', 'print')).toMatchObject({ position: 'static' });
  });
});
