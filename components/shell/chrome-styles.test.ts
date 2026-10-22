import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import postcss, { type AtRule, type Rule } from 'postcss';

/* 전역 크롬 스타일(wc-chrome.css)의 동작 계약. 판정은 순수 함수(chrome-scroll.ts)가, 표현은 이 시트가 맡는다 —
 * data-* 신호가 어느 뷰포트에서 어떤 표현으로 이어지는지를 잠근다. 문자열 계약은 브라우저 시각 검수를 대신하지 않는다. */

const css = readFileSync(new URL('../../app/styles/wc-chrome.css', import.meta.url), 'utf8');
const root = postcss.parse(css);

type Decls = Record<string, string>;

function mediaOf(rule: Rule): string | null {
  const parent = rule.parent;
  return parent && parent.type === 'atrule' && (parent as AtRule).name === 'media' ? (parent as AtRule).params : null;
}

/** 선택자 하나에 걸린 선언을 미디어 조건별로 모은다(null = 미디어 밖). */
function declsFor(selector: string, media: string | null = null): Decls {
  const decls: Decls = {};
  root.walkRules((rule) => {
    if (!rule.selectors.map((s) => s.trim()).includes(selector)) return;
    if (mediaOf(rule) !== media) return;
    rule.walkDecls((decl) => {
      decls[decl.prop] = decl.value;
    });
  });
  return decls;
}

function mediaFor(selectorPattern: RegExp): Array<string | null> {
  const found: Array<string | null> = [];
  root.walkRules((rule) => {
    if (rule.selectors.some((s) => selectorPattern.test(s))) found.push(mediaOf(rule));
  });
  return found;
}

const MOBILE = '(max-width: 989px)';
const DESKTOP = '(min-width: 990px)';

describe('데스크톱 헤더 축약 표현', () => {
  /* 모바일은 GNB를 접지 않는다(LD-2) — 축약 표현이 미디어 밖에 남으면 모바일 탭 행이 다시 사라진다. */
  it('data-condensed는 990px 이상에서만 GNB를 접는다', () => {
    const media = mediaFor(/\.wc-header\[data-condensed='true'\]/);
    expect(media.length).toBeGreaterThan(0);
    expect(new Set(media)).toEqual(new Set([DESKTOP]));
    expect(declsFor(".wc-header[data-condensed='true'] .wc-gnb-wrap", DESKTOP)).toMatchObject({ 'margin-top': '-54px', opacity: '0' });
    /* 헤더 포커스 시 재전개는 유지한다. */
    expect(declsFor(".wc-header[data-condensed='true']:focus-within .wc-gnb-wrap", DESKTOP)).toMatchObject({ 'margin-top': '0', opacity: '1' });
  });
});

describe('모바일 헤더 고정 (LD-2)', () => {
  it('sticky 기준을 로고 행 높이만큼 올려 스크롤하면 GNB 탭 행만 남긴다', () => {
    expect(declsFor('.wc-header__bar-inner')).toMatchObject({ height: '81px' });
    expect(declsFor('.wc-header', MOBILE)).toMatchObject({ top: '-81px' });
  });

  it('키보드 포커스가 헤더에 있으면 로고 행까지 내린다', () => {
    expect(declsFor('.wc-header:has(:focus-visible)', MOBILE)).toMatchObject({ top: '0' });
  });

  it('데스크톱 헤더는 맨 위에 붙는다', () => {
    expect(declsFor('.wc-header')).toMatchObject({ position: 'sticky', top: '0' });
  });
});

describe('모바일 하단 탭바 숨김 (B3·MC-03)', () => {
  it('숨김은 화면 밖으로 내리고 전환 뒤 visibility로 포커스에서 뺀다', () => {
    const hidden = declsFor(".wc-tabbar[data-hidden='true']");
    expect(hidden.transform).toBe('translateY(100%)');
    expect(hidden.visibility).toBe('hidden');
    /* visibility는 내려가는 전환(.3s)이 끝난 뒤에만 바뀐다 — 즉시 숨기면 내려가는 모습이 사라진다. */
    expect(hidden.transition).toMatch(/visibility 0s linear var\(--wc-duration-medium\)/);
    expect(declsFor('.wc-tabbar').transition).toMatch(/transform var\(--wc-duration-medium\)/);
  });
});
