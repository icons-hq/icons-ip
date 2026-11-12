import { readFileSync } from 'node:fs';
import postcss, { type AtRule } from 'postcss';
import { describe, expect, it } from 'vitest';

/* 1014-047 '검색할 때 두 줄로 나뉜다' — 검색 패널은 로고 행 바로 아래에서 GNB 행을 덮는다(#587). 기본형 헤더는 로고 행·패널이 같은
   흰 바탕이고, 컬러형 헤더(스토어 설정)는 패널도 헤더 색을 이어 받아 한 덩어리가 된다 — 흰 패널이면 두 줄로 갈리고 헤더 글자색(흰색)을
   받은 뒤로·검색 버튼이 흰 바탕에 묻혔다(격리 스택 실측 2026-11-12). */
const sheet = postcss.parse(readFileSync(new URL('../../app/styles/wc-chrome.css', import.meta.url), 'utf8'));
const COLOR = '.wc-chrome .wc-header[data-store-header="color"]';

function decls(selector: string, media: string | null = null): Record<string, string> {
  const found: Record<string, string> = {};
  sheet.walkRules((rule) => {
    if (!rule.selectors.map((item) => item.trim()).includes(selector)) return;
    const parent = rule.parent;
    const ruleMedia = parent && parent.type === 'atrule' && (parent as AtRule).name === 'media' ? (parent as AtRule).params : null;
    if (ruleMedia !== media) return;
    rule.walkDecls((decl) => { found[decl.prop] = decl.value; });
  });
  return found;
}

describe('검색 오버레이 한 덩어리 배경', () => {
  it('기본형 헤더는 지금처럼 흰 패널이다(로고 행과 같은 바탕)', () => {
    expect(decls('.wc-search')).toMatchObject({ background: 'var(--wc-surface)', 'border-top': '1px solid var(--wc-hairline-soft)' });
  });

  it('컬러형 헤더는 패널이 헤더 색·글자색을 이어 받고 경계선을 지운다', () => {
    expect(decls(`${COLOR} .wc-search`)).toEqual({
      'border-top-color': 'transparent',
      background: 'var(--store-theme)',
      color: 'var(--store-theme-ink)',
    });
    expect(decls(`${COLOR} .wc-search .wc-search__chips-label`)).toEqual({ color: 'var(--store-theme-ink)' });
    /* 반투명 틴트 칩은 흰 바탕에 얹은 기본 모양 그대로다 — 색 바탕 위에서 글자 대비가 무너지지 않는다. */
    expect(decls('.wc-search__chip').background).toBe('var(--wc-accent-tint)');
    expect(decls(`${COLOR} .wc-search .wc-search__chip`)).toEqual({
      background: 'linear-gradient(var(--wc-accent-tint), var(--wc-accent-tint)), var(--wc-surface)',
    });
  });

  it('데스크톱에서 포커스로 드러난 뒤로·검색 버튼은 칸 안 흰 바탕이라 컬러형 헤더에서도 잉크색이다', () => {
    expect(decls('.wc-search .wc-search__aux:focus', '(min-width: 990px)').background).toBe('var(--wc-surface)');
    /* 뒤로 버튼은 마크업에서 입력 칸보다 앞이라 층을 올려야 칸에 덮이지 않는다(포커스가 보여야 한다 — WCAG 2.4.7). */
    expect(decls('.wc-search .wc-search__aux:focus', '(min-width: 990px)')['z-index']).toBe('1');
    expect(decls(`${COLOR} .wc-search .wc-search__aux:focus`, '(min-width: 990px)')).toEqual({ color: 'var(--wc-ink)' });
  });

  it('컬러형 헤더의 머리말 행·검색 패널 안 포커스 링은 헤더 글자색이고 기본형은 기본 링 그대로다', () => {
    expect(decls(`${COLOR} :is(.wc-header__bar, .wc-gnb-wrap, .wc-search) :focus-visible`)).toEqual({
      'outline-color': 'var(--store-theme-ink)',
    });
  });
});
