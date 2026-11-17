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

describe('헤더 하단 선 (CH-03)', () => {
  /* GNB·축약 헤더 아래 1px. 헤더 상자에 걸어야 축약(GNB가 로고 행 뒤로 들어감)·모바일 고정 상태에도 남는다.
     그림자는 쓰지 않는다(DESIGN §5 — 헤더 그림자 금지). */
  it('헤더 상자 아래에 1px 헤어라인을 두고 그림자는 쓰지 않는다', () => {
    const header = declsFor('.wc-header');
    expect(header['border-bottom']).toBe('1px solid var(--wc-hairline-soft)');
    expect(header['box-shadow']).toBeUndefined();
  });
});

describe('데스크톱 헤더 축약 표현', () => {
  /* 1단 헤더(ADR-0043)라 GNB는 접히지 않고 헤더 행 높이만 108 → 68로 줄어든다. 모바일은 줄이지 않는다(LD-2) — 축약 표현이
     미디어 밖에 남으면 모바일 로고 행이 달라진다. */
  it('data-condensed는 990px 이상에서만 헤더 행을 68로 줄이고 GNB는 접지 않는다', () => {
    const media = mediaFor(/\.wc-header\[data-condensed='true'\]/);
    expect(media.length).toBeGreaterThan(0);
    expect(new Set(media)).toEqual(new Set([DESKTOP]));
    expect(declsFor(".wc-header[data-condensed='true']", DESKTOP)).toEqual({ '--wc-header-row-h': '68px' });
    expect(declsFor('.wc-header', DESKTOP)['--wc-header-row-h']).toBe('108px');
    /* GNB를 로고 행 뒤로 접던 규칙(margin-top 음수·투명·포인터 차단)과 키보드로 되돌리던 예외는 없다. */
    expect(declsFor(".wc-header[data-condensed='true'] .wc-gnb-wrap", DESKTOP)).toEqual({});
    expect(css).not.toMatch(/data-condensed='true'\]:has\(/);
    expect(css).not.toMatch(/margin-top:\s*-54px/);
  });

  it('데스크톱 헤더 행은 좌우 60 안쪽 세로 가운데이고 GNB·로고는 왼쪽 묶음, 아이콘은 오른쪽이다', () => {
    expect(declsFor('.wc-header .wc-header__bar-inner.wc-container', DESKTOP)).toMatchObject({ 'align-items': 'center', 'padding-inline': '60px' });
    expect(declsFor('.wc-header__lead')).toMatchObject({ display: 'flex', gap: '15px' });
    expect(declsFor('.wc-header__icons', DESKTOP)).toMatchObject({ gap: '11px', 'padding-bottom': '0' });
    /* Figma GNB: 패딩 12/15, 17px SemiBold 줄높이 20(항목 44). */
    expect(declsFor('.wc-gnb__link')).toMatchObject({ padding: '12px 15px', 'font-size': '17px', 'font-weight': '600', 'line-height': '20px' });
  });

  it('현재·hover 표기는 글자색을 바꾸지 않고 라벨 아래 2px 잉크 막대 하나다(초록 없음)', () => {
    expect(declsFor('.wc-gnb__link.is-active')).toEqual({ color: 'var(--wc-ink)' });
    expect(declsFor('.wc-gnb__label::after')).toMatchObject({ height: '2px', bottom: '-6px', background: 'var(--wc-ink)' });
    /* store-presentation.css 의 기본형 헤더 테마색 막대 규칙을 이긴다. */
    expect(declsFor(".wc-chrome .wc-header[data-store-header='basic'] .wc-gnb .wc-gnb__label::after")).toEqual({ background: 'var(--wc-ink)' });
  });
});

describe('유틸 메뉴 (Figma 48)', () => {
  it('데스크톱에서만 보이고 높이 48 = 항목 47 + 아래 1px 전폭 선이다', () => {
    expect(declsFor('.wc-utilbar')).toMatchObject({ display: 'none' });
    expect(declsFor('.wc-utilbar', DESKTOP)).toMatchObject({ display: 'block', 'box-sizing': 'border-box', height: '48px', 'border-bottom': '1px solid var(--wc-x-line-util)' });
    expect(declsFor('.wc-utilbar .wc-utilbar__inner.wc-container', DESKTOP)).toMatchObject({ height: '47px', 'padding-inline': '60px' });
  });

  it('항목은 12px SemiBold 보조 잉크, 간격 18, 오른쪽 정렬이다', () => {
    expect(declsFor('.wc-utilbar__inner')).toMatchObject({ 'justify-content': 'flex-end', gap: '18px' });
    expect(declsFor('.wc-utilbar__link')).toMatchObject({ 'font-size': '12px', 'font-weight': '600', 'line-height': '47px', color: 'var(--wc-ink-tertiary)' });
    expect(declsFor('.wc-utilbar__badge').background).toBe('var(--wc-ink)');
  });
});

describe('롤링 띠배너 (ADR-0043 · Figma 40)', () => {
  it('높이 40 빨강 면에 흰 13px Medium 문구, 사본 간격 200(모바일 80)이고 기본 공지 바 규칙을 덮는 건 .wc-x-rolling 뿐이다', () => {
    expect(declsFor('.wc-notice-bar.wc-x-rolling')).toMatchObject({ height: '40px', background: 'var(--wc-x-rolling-bg)', color: '#FFFFFF', overflow: 'hidden' });
    expect(declsFor('.wc-x-rolling__body')).toMatchObject({ 'font-size': '13px', 'font-weight': '500', height: '40px' });
    expect(declsFor('.wc-x-rolling__copy')['padding-right']).toBe('80px');
    expect(declsFor('.wc-x-rolling__copy', DESKTOP)['padding-right']).toBe('200px');
    /* 후보 [hidden]이 위 display 규칙에 되살아나지 않는다. */
    expect(declsFor('.wc-notice-bar.wc-x-rolling[hidden]')).toMatchObject({ display: 'none' });
    /* 어드민 미리보기가 쓰는 기본 공지 바(회색 47)는 그대로다. */
    expect(declsFor('.wc-notice-bar')).toMatchObject({ 'min-height': '47px', background: 'var(--wc-surface-grey)' });
  });

  it('트랙은 40초 선형 무한으로 -50% 흐르고 hover·포커스 중에는 멈춘다(WCAG 2.2.2)', () => {
    expect(declsFor('.wc-x-rolling__track').animation).toBe('wc-x-rolling 40s linear infinite');
    let frames = '';
    root.walkAtRules('keyframes', (rule) => {
      if (rule.params === 'wc-x-rolling') frames = rule.toString();
    });
    expect(frames).toContain('translateX(-50%)');
    for (const selector of ['.wc-x-rolling:hover .wc-x-rolling__track', '.wc-x-rolling:focus-within .wc-x-rolling__track']) {
      expect(declsFor(selector), selector).toEqual({ 'animation-play-state': 'paused' });
    }
  });

  it('모션 축소에서는 흐르지 않고 첫 사본만 가운데에 둔다', () => {
    const reduced = '(prefers-reduced-motion: reduce)';
    expect(declsFor('.wc-x-rolling__track', reduced).animation).toBe('none');
    expect(declsFor('.wc-x-rolling__copy:not(:first-child)', reduced)).toEqual({ display: 'none' });
    expect(declsFor('.wc-x-rolling__body', reduced)['text-align']).toBe('center');
  });

  it('닫기는 44×40 흰 X이고 포커스 링은 흰색 2px을 띠 안쪽에 그린다', () => {
    expect(declsFor('.wc-notice-bar.wc-x-rolling .wc-notice-bar__close')).toMatchObject({ width: '44px', height: '40px', color: '#FFFFFF', top: '0', right: '0' });
    expect(declsFor('.wc-notice-bar.wc-x-rolling :focus-visible')).toEqual({ outline: '2px solid #FFFFFF', 'outline-offset': '-4px' });
  });
});

describe('검색 오버레이 (B5·CH-08·CH-09·MC-04)', () => {
  /* 패널과 백드롭은 sticky 헤더 상자 기준으로 로고 행 바로 아래(= GNB 행 자리)에서 시작한다.
     레퍼런스의 fixed top 156처럼 고정 수치를 쓰면 공지가 붙는 순간 로고 행을 덮거나 공지에 가려진다. */
  it('패널·백드롭을 헤더 행 바로 아래에 붙인다(모바일은 GNB 탭 행을 덮는다)', () => {
    /* 헤더 행 높이는 변수 하나(--wc-header-row-h)다 — 모바일 81, 데스크톱 108, 축약 68. 패널은 그 값을 따라 데스크톱 미디어에 따로 top을 두지 않는다. */
    const row = {
      mobile: declsFor('.wc-header')['--wc-header-row-h'],
      desktop: declsFor('.wc-header', DESKTOP)['--wc-header-row-h'],
      condensed: declsFor(".wc-header[data-condensed='true']", DESKTOP)['--wc-header-row-h'],
    };
    expect(row).toEqual({ mobile: '81px', desktop: '108px', condensed: '68px' });
    expect(declsFor('.wc-header__bar-inner').height).toBe('var(--wc-header-row-h)');
    for (const selector of ['.wc-search', '.wc-search-backdrop']) {
      expect(declsFor(selector), selector).toMatchObject({ position: 'absolute', top: 'var(--wc-header-row-h)' });
      expect(declsFor(selector, DESKTOP).top, selector).toBeUndefined();
    }
    expect(declsFor('.wc-search', DESKTOP)['min-height']).toBe('200px');
  });

  it('백드롭은 10% 잉크 딤 + 5px 흐림이다(미지원 브라우저는 딤만)', () => {
    const backdrop = declsFor('.wc-search-backdrop');
    expect(backdrop.background).toBe('color-mix(in srgb, var(--wc-ink) 10%, transparent)');
    expect(backdrop['backdrop-filter']).toBe('blur(5px)');
    expect(backdrop['-webkit-backdrop-filter']).toBe('blur(5px)');
    expect(backdrop.background).not.toContain('--wc-dim');
  });

  /* 데스크톱 입력은 전폭 회색 칸 하나 — 뒤로·제출 버튼은 감추되 접근 이름과 키보드 순서에 남고, 포커스가 오면 드러난다. */
  it('데스크톱은 돋보기를 칸 안 왼쪽에 두고 뒤로·제출 버튼을 포커스 전까지 감춘다', () => {
    expect(declsFor('.wc-search__field-icon')).toMatchObject({ display: 'none' });
    expect(declsFor('.wc-search__field-icon', DESKTOP)).toMatchObject({ position: 'absolute', display: 'flex' });
    expect(declsFor('.wc-search .wc-search__input', DESKTOP)['padding-left']).toBe('52px');
    const hidden = declsFor('.wc-search .wc-search__aux:not(:focus)', DESKTOP);
    expect(hidden).toMatchObject({ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden' });
    expect(hidden.display).toBeUndefined();
    expect(hidden.visibility).toBeUndefined();
    expect(declsFor('.wc-search .wc-search__aux:focus', DESKTOP)).toMatchObject({ position: 'absolute' });
    /* 모바일에는 감춤 규칙이 없다 — [뒤로][입력][검색] 한 줄이 그대로 보인다. */
    expect(declsFor('.wc-search .wc-search__aux:not(:focus)', MOBILE)).toEqual({});
  });

  it('추천 라벨은 17/700, 모바일 칩은 한 줄 가로 스크롤이다', () => {
    expect(declsFor('.wc-search .wc-search__chips-label')).toMatchObject({ 'font-size': '17px' });
    expect(declsFor('.wc-search__chips-label')).toMatchObject({ 'font-weight': '700' });
    expect(declsFor('.wc-search .wc-search__chips', MOBILE)).toMatchObject({ 'flex-wrap': 'nowrap', 'overflow-x': 'auto' });
  });

  /* /search 빈 결과가 같은 칩·인풋 마크업을 공유한다 — 오버레이 보정이 공유 규칙에 새면 L4 표면이 바뀐다. */
  it('오버레이 전용 보정은 .wc-search 안에서만 한다', () => {
    expect(declsFor('.wc-search__chips-label')['font-size']).toBe('15px');
    expect(declsFor('.wc-search__chips')['flex-wrap']).toBe('wrap');
    expect(declsFor('.wc-search__chips', MOBILE)).toEqual({});
    expect(declsFor('.wc-search__input', DESKTOP)['padding-left']).toBeUndefined();
  });
});

describe('모바일 헤더 고정 (LD-2)', () => {
  it('sticky 기준을 로고 행 높이만큼 올려 스크롤하면 GNB 탭 행만 남긴다', () => {
    expect(declsFor('.wc-header')['--wc-header-row-h']).toBe('81px');
    expect(declsFor('.wc-header__bar-inner')).toMatchObject({ height: 'var(--wc-header-row-h)' });
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

describe('표면 sticky 기준 높이 (--wc-sticky-chrome-h)', () => {
  /* 지면 맨 위에서 곧바로 붙는 sticky(캠페인 앵커 내브)는 헤더가 접히기 전(스크롤 150 이하)에 붙는다 — 그동안 기준이
     축약 높이(69)면 펼친 헤더(123, z 3) 뒤로 숨는다. */
  it('모바일 52, 데스크톱 축약 69, 데스크톱 헤더가 펼친 동안 109', () => {
    expect(declsFor('.wc-root')['--wc-sticky-chrome-h']).toBe('52px');
    expect(declsFor('.wc-root', DESKTOP)['--wc-sticky-chrome-h']).toBe('69px');
    /* 셸(.wc-chrome)과 본문(#root)은 body 아래 형제다 — 전역 element(body) 규칙 없이 형제 결합자로 건다. 펼침 109 = 헤더 행 108 + 하단 선 1. */
    expect(declsFor(".wc-chrome:has(.wc-header[data-condensed='false']) ~ #root .wc-root", DESKTOP)['--wc-sticky-chrome-h']).toBe('109px');
    /* 1단 헤더라 GNB가 접히지 않는다 — 키보드가 되돌리던 예외(123)가 없다. */
    expect(css).not.toContain('123px');
  });
});

describe('해시 이동 착지선 (html scroll-padding-top)', () => {
  /* 해시 이동·scrollIntoView·포커스 이동은 html scroll-padding-top 만큼 아래에 대상을 세운다. 문서 루트는 .wc-root 의
     변수를 읽지 못해 globals.css 가 같은 상태 조건으로 같은 수치를 적는다 — 한쪽만 바뀌면 sticky 표면과 해시 착지가
     갈라진다. 2026-10-23까지는 White Catalog 이전 셸의 112(≤720px 88)가 남아 해시 대상이 크롬보다 그만큼 아래에 섰다. */
  const globals = postcss.parse(readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8'));

  function htmlScrollPadding() {
    const found: Array<{ selector: string; media: string | null; layer: string | null; value: string }> = [];
    globals.walkDecls('scroll-padding-top', (decl) => {
      const rule = decl.parent as Rule;
      let layer: string | null = null;
      for (let node = rule.parent; node?.type === 'atrule'; node = node.parent) {
        if ((node as AtRule).name === 'layer') layer = (node as AtRule).params;
      }
      for (const selector of rule.selectors) found.push({ selector: selector.trim(), media: mediaOf(rule), layer, value: decl.value });
    });
    return found;
  }

  it('공개 셸 상태마다 --wc-sticky-chrome-h 와 같은 높이를 둔다', () => {
    const expected: Array<{ selector: string; media: string | null; value: string }> = [];
    root.walkDecls('--wc-sticky-chrome-h', (decl) => {
      const rule = decl.parent as Rule;
      for (const selector of rule.selectors.map((s) => s.trim())) {
        const state = selector === '.wc-root' ? '.wc-header' : /^\.wc-chrome:has\((.+)\) ~ #root \.wc-root$/.exec(selector)?.[1];
        expect(state, selector).toBeDefined();
        expected.push({ selector: `html:has(.wc-chrome ${state})`, media: mediaOf(rule), value: decl.value });
      }
    });
    const mirrored = htmlScrollPadding()
      .filter((entry) => entry.selector.includes('.wc-chrome'))
      .map(({ selector, media, value }) => ({ selector, media, value }));

    expect(expected.map((entry) => entry.value)).toEqual(['52px', '69px', '109px']);
    expect(mirrored).toEqual(expected);
  });

  it('어드민은 고정 상단바 높이를, 셸이 없는 집중형 화면은 0을 둔다', () => {
    /* 어드민 상단 막대는 kit 유틸리티로 그린다(ADR-0028): sticky top-0 · h-12(48px). */
    const header = readFileSync(new URL('../admin/Header.tsx', import.meta.url), 'utf8');
    const headerClass = header.match(/<header className="([^"]+)"[^>]*data-admin-header/)?.[1] ?? '';
    expect(headerClass.split(/\s+/)).toEqual(expect.arrayContaining(['sticky', 'top-0', 'h-12']));
    expect(htmlScrollPadding().filter((entry) => entry.selector === 'html:has([data-admin-header])').map((entry) => entry.value)).toEqual(['48px']);
    /* 셸을 묻지 않는 html 규칙에 높이를 두면 게임·초대 같은 화면도 없는 크롬만큼 내려간다. */
    expect(htmlScrollPadding().map((entry) => entry.selector).filter((selector) => !selector.startsWith('html:has('))).toEqual([]);
  });

  it('기본 레이어에 두어 표면이 직접 정한 값이 이긴다', () => {
    /* 보존 표면(/about, about-legacy)은 자기 스크롤 여백을 0으로 정해 두었다 — 레이어 밖 규칙이 그대로 이긴다. */
    expect(htmlScrollPadding().map((entry) => entry.layer)).toEqual(htmlScrollPadding().map(() => 'base'));
  });

  /* 셸 QA(2026-10-27) — 축약 중 깊이 스크롤한 /shop 에서 키보드가 로고·GNB 로 들어오면 Tab 마다 약 477px 끌려 올라가 맨 위까지 갔다.
     sticky 헤더 안 요소가 착지선(최대 123) 안쪽이라 브라우저가 가려진 것으로 읽고 가운데로 데려온 것이다. */
  it('헤더 행 안 포커스는 착지 상자 윗변을 착지선 최댓값만큼 내려 문서를 끌어올리지 않는다', () => {
    const lines = htmlScrollPadding().filter((entry) => entry.selector.includes('.wc-chrome')).map((entry) => Number.parseInt(entry.value, 10));
    const margin = `-${Math.max(...lines)}px`;
    expect(margin).toBe('-109px');
    expect(declsFor('.wc-header .wc-header__bar :focus', DESKTOP)['scroll-margin-top']).toBe(margin);
    expect(declsFor('.wc-header .wc-gnb__link:focus', DESKTOP)['scroll-margin-top']).toBe(margin);
    /* 메가메뉴는 안쪽 스크롤 상자다 — 음수 여백이 붙으면 위로 넘친 링크를 상자 안으로 데려오지 못한다. 모바일 헤더는 다른 구조다. */
    root.walkDecls('scroll-margin-top', (decl) => {
      const rule = decl.parent as Rule;
      if (!decl.value.startsWith('-')) return;
      expect(rule.selectors.some((selector) => selector.includes('.wc-mega'))).toBe(false);
      expect(mediaOf(rule)).toBe(DESKTOP);
    });
  });
});

describe('하단 착지선 (html scroll-padding-bottom)', () => {
  /* 셸 QA(2026-10-27) 375 Tab 순회 — 하단 탭바 뒤(/shop 목록 이름·/my 회원 등급 혜택·/my/wishlist 하트), PDP 구매바 뒤(위시 하트),
     문의 런처 뒤(/my 최근 본 굿즈)로 포커스가 통째로 들어갔다(WCAG 2.2 SC 2.4.11). 화면 아래 고정 층의 윗변이 착지선이다. */
  const globals = postcss.parse(readFileSync(new URL('../../app/globals.css', import.meta.url), 'utf8'));
  const inquiry = postcss.parse(readFileSync(new URL('../../app/styles/wc-inquiry-widget.css', import.meta.url), 'utf8'));
  const catalog = postcss.parse(readFileSync(new URL('../../app/styles/wc-catalog.css', import.meta.url), 'utf8'));

  function declsIn(sheet: postcss.Root, selector: string, media: string | null = null): Decls {
    const decls: Decls = {};
    sheet.walkRules((rule) => {
      if (!rule.selectors.map((s) => s.trim()).includes(selector) || mediaOf(rule) !== media) return;
      rule.walkDecls((decl) => {
        decls[decl.prop] = decl.value;
      });
    });
    return decls;
  }

  it('모바일 탭바·PDP 구매바 화면은 그 위에 선 문의 런처의 윗변, 카트는 주문 바 + 16 이다', () => {
    const launcher = declsIn(inquiry, '.wc-root .wc-inquiry-widget__launcher');
    const raised = declsIn(inquiry, '.wc-root .wc-inquiry-widget__launcher', MOBILE);
    expect(raised.bottom).toBe('calc(80px + env(safe-area-inset-bottom))');
    expect(launcher['min-height']).toBe('48px');
    expect(declsFor('.wc-tabbar')['min-height']).toBe('62px');
    expect(declsIn(catalog, '.wc-buybar').height).toBe('72px');

    const top = 'calc(128px + env(safe-area-inset-bottom))';
    expect(declsIn(globals, 'html:has(.wc-chrome .wc-tabbar)', MOBILE)['--wc-bottom-fixed-h']).toBe(top);
    /* 어드민 미리보기 PDP(.is-embedded)는 구매바를 띄우지 않는다(wc-catalog.css). */
    expect(declsIn(globals, 'html:has(.wc-pdp:not(.is-embedded) .wc-buybar)', MOBILE)['--wc-bottom-fixed-h']).toBe(top);
    expect(declsIn(globals, 'html:has(.wc-cart__cta-bar)', MOBILE)['--wc-bottom-fixed-h']).toBe('calc(109px + env(safe-area-inset-bottom))');
    /* 데스크톱에는 하단 고정 바가 없다. */
    for (const selector of ['html:has(.wc-chrome .wc-tabbar)', 'html:has(.wc-cart__cta-bar)']) {
      expect(declsIn(globals, selector, DESKTOP)['--wc-bottom-fixed-h']).toBeUndefined();
      expect(declsIn(globals, selector)['--wc-bottom-fixed-h']).toBeUndefined();
    }
  });

  /* 고정 층끼리 겹치면 스크롤로는 풀 수 없다 — 375 에서 문의 런처(바닥 80~128)가 선택 방문 통계 안내(바닥 76~) 밑에 통째로 깔렸고,
     601~989 에서는 안내(바닥 20)·설정 버튼(바닥 12)이 하단 탭바를 덮었다. */
  it('선택 방문 통계 안내·설정 버튼은 990 미만에서 하단 바와 문의 런처 위에 선다', () => {
    const analytics = postcss.parse(readFileSync(new URL('../../app/styles/store-analytics.css', import.meta.url), 'utf8'));
    const cart = '#root:has(.wc-cart__cta-bar)~.wc-store-analytics';
    const compactMobile = '(max-width:989px)'; // 이 시트는 압축 표기다.
    expect(declsIn(analytics, '.wc-store-analytics-banner', compactMobile).bottom).toBe('calc(136px + env(safe-area-inset-bottom))'); // 런처 윗변 128 + 8
    expect(declsIn(analytics, `${cart} .wc-store-analytics-banner`, compactMobile).bottom).toBe('calc(165px + env(safe-area-inset-bottom))'); // 카트 런처 윗변 157 + 8
    expect(declsIn(analytics, '.wc-store-analytics-settings', compactMobile).bottom).toBe('calc(72px + env(safe-area-inset-bottom))'); // 탭바 62 + 10
    expect(declsIn(analytics, `${cart} .wc-store-analytics-settings`, compactMobile).bottom).toBe('calc(101px + env(safe-area-inset-bottom))'); // 주문 바 93 + 8
    expect(declsIn(catalog, '#root:has(.wc-cart__cta-bar) .wc-inquiry-widget__launcher', MOBILE).bottom).toBe('calc(109px + env(safe-area-inset-bottom))');
    /* 최대 스크롤에서는 착지선이 더 내릴 곳이 없다 — 안내가 보이는 동안 푸터 바닥이 그 윗변 + 16 까지 열린다. */
    const raised = 'calc(var(--wc-store-analytics-clearance, 0px) + 16px)';
    expect(declsFor('.wc-footer').padding).toBe(`40px 0 max(60px, ${raised})`);
    expect(declsFor('.wc-footer', MOBILE)['padding-bottom']).toBe(`max(122px, ${raised})`);
    /* 600 이하 배치(줄바꿈·버튼 폭)만 남기고 위치는 990 기준 하나로 둔다. */
    expect(declsIn(analytics, '.wc-store-analytics-banner', '(max-width:600px)').bottom).toBeUndefined();
    expect(declsIn(analytics, '.wc-store-analytics-settings', '(max-width:600px)').bottom).toBeUndefined();
  });

  it('착지선은 하단 바와 선택 방문 통계 안내(측정값) 중 높은 쪽이고, 기본 레이어라 표면 값이 이긴다', () => {
    expect(declsIn(globals, 'html')['scroll-padding-bottom']).toBe('max(var(--wc-bottom-fixed-h, 0px), var(--wc-store-analytics-clearance, 0px))');
    const layers: Array<string | null> = [];
    globals.walkDecls(/^(scroll-padding-bottom|--wc-bottom-fixed-h)$/, (decl) => {
      let layer: string | null = null;
      for (let node = decl.parent?.parent; node; node = node.parent) {
        if (node.type === 'atrule' && (node as AtRule).name === 'layer') layer = (node as AtRule).params;
      }
      layers.push(layer);
    });
    expect(layers.length).toBeGreaterThan(0);
    expect(new Set(layers)).toEqual(new Set(['base']));
    const analytics = readFileSync(new URL('./StoreAnalytics.tsx', import.meta.url), 'utf8');
    expect(analytics).toContain('holdStoreAnalyticsClearance(pinned.current, window)');
  });
});

describe('X SQUARE 푸터 (Figma Site Footer, ADR-0043)', () => {
  /* 약관·안내 → 고객센터·SNS → 사업자 정보 → 저작권. CSS order 는 화면 순서와 읽기·포커스 순서를 갈라놓는다(WCAG 1.3.2·2.4.3) —
     순서는 마크업이 갖고(SiteFooter.test) 시트는 모바일에서 세로로 쌓기만 한다. */
  it('푸터 어디에도 order 를 쓰지 않는다', () => {
    const ordered: string[] = [];
    root.walkRules((rule) => {
      if (!rule.selectors.some((selector) => selector.includes('wc-footer') || selector.includes('wc-x-footer'))) return;
      rule.walkDecls('order', () => { ordered.push(`${mediaOf(rule) ?? 'base'} ${rule.selector}`); });
    });
    expect(ordered).toEqual([]);
  });

  it('위 여백 60(데스크톱 120), 전폭 1px 선, 흰 바탕이고 독립 경험은 위 여백을 열지 않는다', () => {
    expect(declsFor('.wc-footer')).toMatchObject({ 'margin-top': '60px', 'border-top': '1px solid var(--wc-x-line-util)', background: 'var(--wc-surface)' });
    expect(declsFor('.wc-footer', DESKTOP)['margin-top']).toBe('120px');
    expect(declsFor('.wc-footer.wc-footer--standalone')['margin-top']).toBe('0');
    /* 안쪽 패딩은 위 40, 아래 60(통계 안내가 있으면 그 위까지). */
    expect(declsFor('.wc-footer').padding).toBe('40px 0 max(60px, calc(var(--wc-store-analytics-clearance, 0px) + 16px))');
  });

  it('1행은 양끝 정렬(왼쪽 링크 간격 24, 오른쪽 고객센터·SNS 간격 22)이고 링크는 16px Bold #535353 토큰이다', () => {
    expect(declsFor('.wc-x-footer__bar')).toMatchObject({ display: 'flex', 'justify-content': 'space-between' });
    expect(declsFor('.wc-x-footer__links ul').gap).toBe('4px 24px');
    expect(declsFor('.wc-x-footer__aside ul').gap).toBe('4px 22px');
    for (const selector of ['.wc-x-footer__links a', '.wc-x-footer__aside a']) {
      expect(declsFor(selector), selector).toMatchObject({ 'font-size': '16px', 'font-weight': '700', color: 'var(--wc-x-footer-link)', 'min-height': '24px' });
    }
    /* SNS 아이콘은 18px 이고 눌림 상자는 24px 이상이다. */
    expect(declsFor('.wc-x-footer__social img')).toMatchObject({ width: '18px', height: '18px' });
    expect(declsFor('.wc-x-footer__aside .wc-x-footer__social')).toMatchObject({ width: '24px' });
  });

  it('사업자 정보는 12px SemiBold 보조색, 항목 간격 16·줄 간격 4이고 줄바꿈을 허용한다', () => {
    expect(declsFor('.wc-x-footer__biz')).toMatchObject({ display: 'flex', 'flex-wrap': 'wrap', gap: '4px 16px' });
    expect(declsFor('.wc-x-footer__biz-row')).toMatchObject({ 'font-size': '12px', 'font-weight': '600', color: 'var(--wc-x-muted)' });
    expect(declsFor('.wc-x-footer__copy')).toMatchObject({ 'font-size': '12px', 'font-weight': '600', color: 'var(--wc-x-muted)' });
    /* 상호·주소 라벨은 화면에서만 감추고 접근 이름으로는 남긴다(display:none 이 아니다). */
    const bare = declsFor('.wc-x-footer__biz-row--bare dt');
    expect(bare).toMatchObject({ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden' });
    expect(bare.display).toBeUndefined();
  });

  it('모바일은 1행을 세로로 쌓는다', () => {
    expect(declsFor('.wc-x-footer__bar', MOBILE)).toMatchObject({ 'flex-direction': 'column', 'align-items': 'flex-start' });
  });

  it('Figma 푸터에서 빠진 블록(로고·소개·회사 정책 행·발견/내 활동 열·접이식)의 규칙을 남기지 않는다', () => {
    for (const removed of ['.wc-footer__logo', '.wc-footer__primary', '.wc-footer__middle', '.wc-footer__cols', '.wc-footer__links', '.wc-footer__line', '.wc-footer__biz', '.wc-footer__cs', '.wc-footer__brand']) {
      expect(css, removed).not.toContain(removed);
    }
  });
});

describe('404 2CTA (CH-14)', () => {
  it('두 버튼을 260×56으로, 그룹을 260 두 칸 + 간격 8로 넓힌다', () => {
    expect(declsFor('.wc-not-found .wc-not-found__actions .wc-btn')).toMatchObject({ 'max-width': '260px', height: '56px' });
    expect(declsFor('.wc-not-found .wc-not-found__actions')['max-width']).toBe('528px');
    /* 가운데 정렬 행 flex 부모(.wc-fallback) 안에서 .wc-empty가 글자 폭으로 줄면 묶음의 100%도 그 폭이다 —
       상자(.wc-empty)부터 폭을 줘야 묶음이 528까지 선다(운영 실측: 묶음 214·버튼 103 → 수정 뒤 260×56). */
    expect(declsFor('.wc-not-found .wc-empty').width).toBe('min(560px, 100%)');
    expect(declsFor('.wc-not-found .wc-not-found__actions').width).toBe('min(528px, 100%)');
  });
});

describe('검색 모달 배경 inert (공지 스트립 포함)', () => {
  /* 백드롭이 로고 행 아래에서 시작해 공지 스트립이 딤 밖에 남는다 — 모달이 열린 동안 스트립도 inert여야 한다. */
  it('useOverlayA11y가 공지 스트립을 배경으로 덮는다', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./useOverlayA11y.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/'[^']*\.wc-notice[^']*'/);
    /* 텍스트 공지 바의 버튼·닫기도 딤 밖에 남는 조작부다(L8a). */
    expect(src).toMatch(/'[^']*\.wc-notice-bar[^']*'/);
    /* body 직계 선택 방문 통계 안내(배너·설정 버튼)도 — 셸 QA(2026-10-27)에서 시트가 열린 동안 Tab 이 배너 버튼으로 나갔다. */
    expect(src).toMatch(/'[^']*\.wc-store-analytics'/);
  });
});

describe('셸 공지 (CH-01 텍스트 공지 바 · CH-02 스트립)', () => {
  /* 공지는 유틸바 위 일반 흐름이다 — sticky·fixed가 되면 sticky 크롬 높이(--wc-sticky-chrome-h)와 해시 착지선이 공지만큼 어긋난다. */
  it('공지 묶음·바·스트립은 스크롤과 함께 빠지는 일반 흐름이고 묶음 자체는 높이를 더하지 않는다', () => {
    for (const selector of ['.wc-notices', '.wc-notice-bar', '.wc-notice']) {
      expect(['sticky', 'fixed']).not.toContain(declsFor(selector).position);
    }
    const group = declsFor('.wc-notices');
    for (const prop of ['padding', 'margin', 'border', 'min-height', 'height']) expect(group[prop], prop).toBeUndefined();
  });

  /* 후보는 hidden으로 접는다. 클래스의 display가 UA [hidden]을 이기므로 다시 꺼야 닫힌 뒤 빈 띠가 남지 않는다. */
  it('hidden 처리된 공지 바·스트립은 자리를 차지하지 않는다', () => {
    expect(declsFor('.wc-notice-bar[hidden]')).toMatchObject({ display: 'none' });
    expect(declsFor('.wc-notice[hidden]')).toMatchObject({ display: 'none' });
  });

  it('공지 바는 47 높이·회색 면·13px 문구, 버튼 23, 닫기 44 터치 대상이다(11 §3 Δ1)', () => {
    expect(declsFor('.wc-notice-bar')).toMatchObject({ 'min-height': '47px', background: 'var(--wc-surface-grey)', position: 'relative' });
    expect(declsFor('.wc-notice-bar__body')).toMatchObject({ 'font-size': '13px', 'flex-wrap': 'wrap' });
    expect(declsFor('.wc-notice-bar__cta')).toMatchObject({ height: '23px', background: 'var(--wc-ink)' });
    expect(declsFor('.wc-notice-bar__close')).toMatchObject({ width: '44px', height: '44px', position: 'absolute' });
    /* 23px 버튼의 누르는 영역은 바 높이까지 넓힌다. */
    expect(declsFor('.wc-notice-bar__cta::before')).toMatchObject({ position: 'absolute' });
  });

  /* 닫기 상자(44)는 47px 바의 위 1.5px·오른쪽 2px에 붙는다. 링이 상자 밖으로 나가면(offset > -두께) 위·오른쪽 변이
     뷰포트 밖으로 잘려 'ㄴ'자만 남는다 — 링의 바깥 변이 상자 안(≥ 0)에 들어오게 고정한다. */
  it('공지 닫기의 포커스 링은 상자 안쪽에 그려 위·오른쪽 끝에서도 잘리지 않는다', () => {
    const close = declsFor('.wc-notice-bar__close');
    expect(close).toMatchObject({ top: '50%', 'margin-top': '-22px', right: '2px', height: '44px' });
    const ring = declsFor('.wc-notice-bar .wc-notice-bar__close:focus-visible');
    const ringOutsideBox = parseFloat(ring['outline-offset']) + 2; // + 기본 두께 2px(wc-foundation .wc-root :focus-visible)
    expect(ringOutsideBox).toBeLessThanOrEqual(0);
    expect(ring['outline-offset']).toBe('-4px');
  });
});

describe('카테고리 메가메뉴·카테고리 시트 (L5 · CH-05·CH-07·MC-05)', () => {
  /* R-01 §4.1 메가메뉴 A 트랙 130·180·150(구분선 칸)·간격 20을 같은 자리로 — 세로선은 기획전 칸 끝 +70(간격 20 + 50),
     전시분류는 선 +120에서 시작한다. 기획전이 없으면 180 칸을 접어 빈 칸을 남기지 않는다. 선은 목록 항목이 아니라 칸의 왼쪽 선이다. */
  it('공개 전시 메가메뉴는 [130][180] | 세로선 | 전시분류 흐름이고 기획전이 없으면 칸을 접는다', () => {
    expect(declsFor('.wc-mega__list--catalog')).toMatchObject({ 'grid-template-columns': '130px 180px minmax(0, 1fr)', 'column-gap': '20px', 'row-gap': '18px' });
    expect(declsFor('.wc-mega__list--catalog.wc-mega__list--compact')['grid-template-columns']).toBe('130px minmax(0, 1fr)');
    expect(declsFor('.wc-mega__catalog')).toMatchObject({ 'margin-left': '50px', 'padding-left': '119px', 'border-left': '1px solid var(--wc-hairline-dark)' });
    expect(declsFor('.wc-mega__catalog-groups')).toMatchObject({ display: 'flex', 'flex-wrap': 'wrap', gap: '18px 20px' });
    expect(declsFor('.wc-mega__catalog-groups > .wc-mega__group')).toMatchObject({ 'min-width': '80px', 'max-width': '180px' });
    /* 그룹 제목 링크는 제목 문법 그대로 블록이고, 현재 위치는 GNB 와 같은 state.success 색이다. */
    expect(declsFor('.wc-mega__heading-link')).toMatchObject({ display: 'block', 'text-decoration': 'none' });
    expect(declsFor(".wc-mega__heading-link[aria-current='page']").color).toBe('var(--wc-success)');
  });

  it('온라인 팝업 메가메뉴는 repeat(6) 간격 40, 4열부터 136 정사각 타일 두 개다(R-01 §4.1 B·C)', () => {
    expect(declsFor('.wc-mega__list--ip')).toMatchObject({ 'grid-template-columns': 'repeat(6, minmax(0, 1fr))', 'column-gap': '40px', 'row-gap': '18px' });
    expect(declsFor('.wc-mega__group--tiles')['grid-column']).toBe('4 / span 2');
    expect(declsFor('.wc-mega__tile').width).toBe('136px');
    expect(declsFor('.wc-mega__tile-image')).toMatchObject({ 'aspect-ratio': '1', 'background-color': 'var(--wc-surface-icon-tile)', 'background-size': 'cover' });
  });

  /* 카테고리 시트는 전체 메뉴 시트의 바텀시트(.wc-sheet 75%·radius 8·딤 70%)를 그대로 쓴다. 열 때만 .3s 로 올라오고
     모션 축소에서는 전환 없이 선다(파운데이션의 .wc-root * 규칙에 더해 이 표면이 직접 끈다). */
  it('카테고리 시트는 75% 바텀시트로 .3s 올라오고 모션 축소에서는 애니메이션이 없다', () => {
    expect(declsFor('.wc-sheet')).toMatchObject({ position: 'fixed', bottom: '0', height: '75%', 'z-index': '1000', 'border-radius': 'var(--wc-radius-sheet) var(--wc-radius-sheet) 0 0' });
    expect(declsFor('.wc-sheet-dim')).toMatchObject({ background: 'var(--wc-dim)', 'z-index': '999' });
    expect(declsFor('.wc-catsheet').animation).toBe('wc-sheet-rise var(--wc-duration-medium) var(--wc-ease-out-slow)');
    expect(declsFor('.wc-catsheet', '(prefers-reduced-motion: reduce)').animation).toBe('none');
    expect(declsFor('.wc-catsheet-dim', '(prefers-reduced-motion: reduce)').animation).toBe('none');
  });

  it('바로가기·그리드 아이콘 칸은 60 정사각 r10 icon-tile 이고 그리드는 4열이다(11 2-4)', () => {
    for (const selector of ['.wc-catsheet__icon', '.wc-catsheet__tile-image']) {
      expect(declsFor(selector), selector).toMatchObject({ width: '60px', height: '60px', 'border-radius': '10px' });
    }
    expect(declsFor('.wc-catsheet__icon').background).toBe('var(--wc-surface-icon-tile)');
    expect(declsFor('.wc-catsheet__tile-image')['background-color']).toBe('var(--wc-surface-icon-tile)');
    expect(declsFor('.wc-catsheet__shortcut').width).toBe('clamp(60px, 17vw, 72px)');
    expect(declsFor('.wc-catsheet__shortcuts')).toMatchObject({ 'overflow-x': 'auto', 'scroll-snap-type': 'x mandatory' });
    expect(declsFor('.wc-catsheet__grid')['grid-template-columns']).toBe('repeat(4, minmax(0, 1fr))');
    /* 전시분류 아이콘은 칸 안에 맞추고(라인아트), IP 키아트는 칸을 채운다. */
    expect(declsFor('.wc-catsheet__tile-image--icon')['background-size']).toBe('contain');
    expect(declsFor('.wc-catsheet__tile-image--art')['background-size']).toBe('cover');
    expect(declsFor('.wc-catsheet__collection-page')['grid-template-columns']).toBe('repeat(2, minmax(0, 1fr))');
  });

  /* 리뷰 l5-ui-3 — 가로 스크롤 트랙(overflow)은 위아래까지 자른다. 바로가기·기획전 카드가 트랙 경계에 붙어 있으면
   * 포커스 링(2px + 간격 2px)이 잘렸다. 링이 들어갈 4px 안쪽 여백을 두고 같은 만큼 바깥 여백을 당겨 배치는 그대로 둔다. */
  it('바로가기·기획전 슬라이드 트랙은 포커스 링이 들어갈 4px 안쪽 여백을 두고 바깥 여백으로 상쇄한다', () => {
    /* 링이 상자 밖으로 뻗는 거리 = 전역 포커스 링(wc-foundation `.wc-root :focus-visible`)의 두께 + 간격. */
    const foundation = postcss.parse(readFileSync(new URL('../../app/styles/wc-foundation.css', import.meta.url), 'utf8'));
    let ringReach = 0;
    foundation.walkRules('.wc-root :focus-visible', (rule) => {
      rule.walkDecls((decl) => {
        if (decl.prop === 'outline') ringReach += Number.parseFloat(decl.value);
        if (decl.prop === 'outline-offset') ringReach += Number.parseFloat(decl.value);
      });
    });
    expect(ringReach).toBe(4);
    expect(declsFor('.wc-catsheet__shortcuts')).toMatchObject({ margin: `-${ringReach}px -16px`, padding: `${ringReach}px 16px` });
    expect(declsFor('.wc-catsheet__collections .wc-slider__track')).toMatchObject({ margin: `-${ringReach}px`, padding: `${ringReach}px`, 'scroll-padding-inline': `${ringReach}px` });
  });

  /* QA l5-qa-1 — 캠페인 제목은 DB 상한 120자까지 온다. 180 칸에서 그대로 감기면 110자 제목 하나가 8줄(h160)이 돼 패널이 316→444 로
   * 커지고 나머지 기획전이 밀렸다. 기획전 링크만 2줄 말줄임이고(레퍼런스 컬렉션 링크도 2줄), 다른 메가 링크는 그대로 감긴다. */
  it('카탈로그 메가의 기획전 링크만 글자 상자를 2줄에서 말줄임한다(링크 여백은 그대로 — 여백에 3번째 줄이 비치지 않게)', () => {
    expect(declsFor('.wc-mega__list--catalog .wc-mega__link-clamp')).toEqual({
      display: '-webkit-box',
      overflow: 'hidden',
      'overflow-wrap': 'anywhere',
      'word-break': 'keep-all',
      '-webkit-box-orient': 'vertical',
      '-webkit-line-clamp': '2',
    });
    /* 바탕 링크 규칙은 말줄임을 갖지 않는다 — 전시분류·IP 링크에는 번지지 않고, 누르는 영역(위아래 여백 7)은 링크에 남는다. */
    expect(declsFor('.wc-mega__link')).not.toHaveProperty('-webkit-line-clamp');
    expect(declsFor('.wc-mega__link')).toMatchObject({ display: 'block', padding: '7px 0' });
    /* 자르는 상자에는 위아래 여백이 없다 — overflow 가 여백 끝에서 잘리면 다음 줄 윗부분이 비친다. */
    expect(declsFor('.wc-mega__list--catalog .wc-mega__link-clamp')).not.toHaveProperty('padding');
  });

  /* QA l5-qa-2 — 375 그리드 칸은 82 인데 'NONGDAMGOM'(12px, 브라우저 실측 약 83)이 칸만 쓰다 'NONGDAMGO / M' 으로 갈렸다.
   * 라벨은 열 간격의 반씩을 양옆으로 더 써서 375 에서도 한 줄에 들고, 긴 운영 이름은 2줄에서 말줄임한다. */
  it('시트 라벨은 열 간격의 반씩을 더 쓰고 2줄에서 말줄임해 375 에서 라틴 IP 이름이 단어 중간에서 갈리지 않는다', () => {
    const label = declsFor('.wc-catsheet__tile-label');
    expect(declsFor('.wc-catsheet__label')).toEqual(label);
    expect(label).toMatchObject({ display: '-webkit-box', overflow: 'hidden', 'word-break': 'keep-all', '-webkit-box-orient': 'vertical', '-webkit-line-clamp': '2' });
    const [top, inline, bottom] = label.margin.split(' ').map((value) => Number.parseFloat(value));
    expect([top, bottom]).toEqual([8, 0]);
    const columnGap = Number.parseFloat(declsFor('.wc-catsheet__grid').gap.split(' ')[1]);
    expect(Number.parseFloat(declsFor('.wc-catsheet__shortcuts').gap)).toBe(columnGap);
    expect(inline).toBe(-columnGap / 2);

    /* 375 셈: 시트 안쪽 여백 16 ×2, 4열·열 간격 → 칸 82, 라벨이 쓰는 폭 = 칸 + 간격. */
    const gutter = Number.parseFloat(declsFor('.wc-sheet__inner').padding.split(' ')[1]);
    const cell = (375 - gutter * 2 - columnGap * 3) / 4;
    expect(cell).toBe(82);
    const NONGDAMGOM_12PX = 83; // QA labels.json(m375.ips[4]) 실측 — 라틴 대문자 10자, 12px/-0.2px
    expect(cell).toBeLessThan(NONGDAMGOM_12PX);
    expect(cell - inline * 2).toBeGreaterThanOrEqual(NONGDAMGOM_12PX);
  });

  /* QA l5-qa-5 — 공용 닫기(.wc-sheet__close)는 투명한 채 시트 기준 absolute 이고 스크롤은 안쪽이 해서, 내리면 기획전 이미지·제목이
   * X 아래로 지나갔다. 카테고리 시트만 닫기 버튼 줄을 머리줄로 두고, 콘텐츠가 그 아래로 들어간 동안(data-scrolled)에만 지면색을 깐다. */
  it('카테고리 시트 머리줄은 닫기 버튼 줄 높이이고, 스크롤한 동안에만 지면색으로 콘텐츠를 가린다 — 공용 닫기는 그대로다', () => {
    const close = declsFor('.wc-sheet__close');
    expect(close).toEqual({ position: 'absolute', top: '8px', right: '8px' });
    const iconButton = declsFor('.wc-icon-btn');
    expect(iconButton.background).toBe('none');

    const strip = declsFor('.wc-catsheet::before');
    expect(strip).toMatchObject({ position: 'absolute', top: '0', right: '0', left: '0', background: 'var(--wc-surface)', opacity: '0', 'pointer-events': 'none' });
    expect(Number.parseFloat(strip.height)).toBe(Number.parseFloat(close.top) + Number.parseFloat(iconButton.height));
    expect(declsFor(".wc-catsheet[data-scrolled='true']::before")).toEqual({ opacity: '1', 'pointer-events': 'auto' });
    expect(Number(declsFor('.wc-catsheet .wc-sheet__close')['z-index'])).toBeGreaterThan(Number(strip['z-index']));
    expect(declsFor('.wc-catsheet::before', '(prefers-reduced-motion: reduce)').transition).toBe('none');

    /* 제목 없는 탭 구역이 맨 위에 오면 머리줄과 겹치는 만큼(52 − 시트 위 여백 20) 내린다. */
    const offset = Number.parseFloat(strip.height) - Number.parseFloat(declsFor('.wc-sheet')['padding-top']);
    expect(declsFor('.wc-catsheet .wc-sheet__inner > .wc-catsheet__section--untitled:first-child')['padding-top']).toBe(`${offset}px`);
  });

  it('기획전 슬라이드 점은 24×44 터치 상자 안 8px 점이고 강제 색상에서도 보인다', () => {
    expect(declsFor('.wc-catsheet__collections .wc-slider__dot')).toMatchObject({ width: '24px', height: '44px' });
    expect(declsFor('.wc-catsheet__collections .wc-slider__dot::before')).toMatchObject({ width: '8px', height: '8px' });
    expect(declsFor(".wc-catsheet__collections .wc-slider__dot[aria-current='true']::before", '(forced-colors: active)').background).toBe('CanvasText');
  });
});
