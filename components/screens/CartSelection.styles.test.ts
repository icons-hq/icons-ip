import { readFileSync } from 'node:fs';
import postcss, { type AtRule } from 'postcss';
import { describe, expect, it } from 'vitest';

/*
 * 장바구니 선택 바·줄 체크 지면 계약(ADR-0030). 행의 나머지 배치(CT-04)는 cart-styles.test 가 지킨다 — 여기서는
 * 체크 칸이 썸네일 앞에 서고 밴드·줄 금액이 여전히 모든 칸을 가로지르는지만 본다.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
function decls(path: string, selector: string, media: string | null = null): Record<string, string> {
  const out: Record<string, string> = {};
  postcss.parse(read(path)).walkRules((rule) => {
    const ruleMedia = rule.parent?.type === 'atrule' ? (rule.parent as AtRule).params : null;
    if (ruleMedia !== media || !rule.selectors.map((item) => item.trim()).includes(selector)) return;
    rule.walkDecls((decl) => { out[decl.prop] = decl.value.trim(); });
  });
  return out;
}

const SELECTION = '../../app/styles/wc-cart-selection.css';
const CATALOG = '../../app/styles/wc-catalog.css';

describe('장바구니 선택 지면(ADR-0030)', () => {
  it('체크 칸 24 가 썸네일(모바일 80·데스크톱 64) 앞에 선다', () => {
    expect(decls(SELECTION, '.wc-cart__line.wc-cart__line--selectable')['grid-template-columns']).toBe('24px 80px minmax(0, 1fr)');
    expect(decls(SELECTION, '.wc-cart__line.wc-cart__line--selectable', '(min-width: 990px)')['grid-template-columns']).toBe('24px 64px minmax(0, 1fr)');
  });

  it('옵션 밴드와 줄 금액은 그대로 모든 칸을 가로지른다', () => {
    expect(decls(CATALOG, '.wc-cart__line-band')['grid-column']).toBe('1 / -1');
    expect(decls(CATALOG, '.wc-cart__line-total')['grid-column']).toBe('1 / -1');
  });

  it('체크박스는 잉크 색이고 선택 바 단추는 비활성일 때 흐려진다', () => {
    expect(decls(SELECTION, '.wc-cart__line-check input')['accent-color']).toBe('var(--wc-ink)');
    expect(decls(SELECTION, '.wc-cart__select-action:disabled').color).toBe('var(--wc-ink-disabled)');
  });

  /* DESIGN.md touch-target 44 — 모바일 선택 바 단추·전체 선택·줄 체크의 누르는 영역. 데스크톱(990+)은 32로 줄인다. */
  it('모바일 선택 바와 줄 체크는 44px 누르는 영역을 가진다', () => {
    expect(decls(SELECTION, '.wc-cart__select-action')['min-height']).toBe('44px');
    expect(decls(SELECTION, '.wc-cart__select-all')['min-height']).toBe('44px');
    expect(decls(SELECTION, '.wc-cart__select-action', '(min-width: 990px)')['min-height']).toBe('32px');
    const hit = decls(SELECTION, '.wc-cart__line-check::before');
    /* 24 + 10 + 10 = 44 너비, 위아래로 11씩 넓혀 44 이상 높이. 오른쪽은 칸 사이(16)를 넘지 않는다. */
    expect([hit.left, hit.right, hit.top, hit.bottom]).toEqual(['-10px', '-10px', '-11px', '-11px']);
    /* 체크박스 자체는 라벨 여백 위에 선다 — 체크박스를 직접 누르는 클릭이 여백에 가로채이지 않는다. */
    expect(decls(SELECTION, '.wc-cart__line-check input')).toMatchObject({ position: 'relative', 'z-index': '1' });
  });

  it('카트 라우트가 선택 지면 스타일시트를 싣는다', () => {
    expect(read('../../app/cart/layout.tsx')).toContain("import '@/app/styles/wc-cart-selection.css';");
  });
});
