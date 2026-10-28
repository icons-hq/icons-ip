import { readFileSync } from 'node:fs';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';

/* 10/27 회의 R18 — 어드민 금액·수량 입력에는 브라우저 스피너가 없다. 휠 변경은 AdminNumberWheelGuard가 막는다. */
const css = postcss.parse(readFileSync(new URL('./wc-admin.css', import.meta.url), 'utf8'));
function declarations(selector: string) {
  const found = new Map<string, string>();
  css.walkRules((rule) => {
    if (rule.parent?.type !== 'root' || !rule.selectors.includes(selector)) return;
    rule.walkDecls((decl) => { found.set(decl.prop, decl.value); });
  });
  return found;
}

describe('어드민 숫자 입력', () => {
  it('모든 어드민 number 입력의 스피너를 숨기고 textfield로 그린다', () => {
    const input = declarations(".wc-admin input[type='number']");
    expect(input.get('appearance')).toBe('textfield');
    expect(input.get('-moz-appearance')).toBe('textfield');
    for (const pseudo of ['::-webkit-inner-spin-button', '::-webkit-outer-spin-button']) {
      const spin = declarations(`.wc-admin input[type='number']${pseudo}`);
      expect(spin.get('-webkit-appearance')).toBe('none');
      expect(spin.get('margin')).toBe('0');
    }
  });
});
