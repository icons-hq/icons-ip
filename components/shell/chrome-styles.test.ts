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
  /* 모바일은 GNB를 접지 않는다(LD-2) — 축약 표현이 미디어 밖에 남으면 모바일 탭 행이 다시 사라진다. */
  it('data-condensed는 990px 이상에서만 GNB를 접는다', () => {
    const media = mediaFor(/\.wc-header\[data-condensed='true'\]/);
    expect(media.length).toBeGreaterThan(0);
    expect(new Set(media)).toEqual(new Set([DESKTOP]));
    expect(declsFor(".wc-header[data-condensed='true'] .wc-gnb-wrap", DESKTOP)).toMatchObject({ 'margin-top': '-54px', opacity: '0' });
    /* 키보드 포커스가 로고 행·GNB에 들어오면 다시 펼친다. 검색 패널 안의 포커스는 재전개 조건이 아니다. */
    const refocus = ".wc-header[data-condensed='true']:has(.wc-header__bar :focus-visible, .wc-gnb-wrap :focus-visible) .wc-gnb-wrap";
    expect(declsFor(refocus, DESKTOP)).toMatchObject({ 'margin-top': '0', opacity: '1', 'pointer-events': 'auto' });
    expect(refocus).not.toContain('wc-search');
  });
});

describe('검색 오버레이 (B5·CH-08·CH-09·MC-04)', () => {
  /* 패널과 백드롭은 sticky 헤더 상자 기준으로 로고 행 바로 아래(= GNB 행 자리)에서 시작한다.
     레퍼런스의 fixed top 156처럼 고정 수치를 쓰면 공지가 붙는 순간 로고 행을 덮거나 공지에 가려진다. */
  it('패널·백드롭을 로고 행 바로 아래에 붙여 GNB 행을 덮는다', () => {
    const logoRow = { mobile: declsFor('.wc-header__bar-inner').height, desktop: declsFor('.wc-header__bar-inner', DESKTOP).height };
    expect(logoRow).toEqual({ mobile: '81px', desktop: '68px' });
    for (const selector of ['.wc-search', '.wc-search-backdrop']) {
      expect(declsFor(selector), selector).toMatchObject({ position: 'absolute', top: logoRow.mobile });
      expect(declsFor(selector, DESKTOP), selector).toMatchObject({ top: logoRow.desktop });
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

describe('모바일 푸터 순서 (CH-15)', () => {
  /* 로고 → 회사·정책 → 고객센터(사업자 정보 포함) → 소개·SNS → 링크 → 스태프 블록 → 저작권. 데스크톱은 마크업 순서 그대로다. */
  it('모바일에서만 블록 순서를 다시 놓는다', () => {
    const order = (selector: string) => Number(declsFor(selector, MOBILE).order);
    const sequence = ['.wc-footer__logo', '.wc-footer__primary', '.wc-footer__cs', '.wc-footer .wc-store-brand-details', '.wc-footer__cols', '.wc-footer__demo', '.wc-footer__line'];
    const orders = sequence.map(order);
    expect(orders.every(Number.isFinite)).toBe(true);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    expect(new Set(orders).size).toBe(orders.length);
    expect(declsFor('.wc-footer__inner', MOBILE)).toMatchObject({ display: 'flex', 'flex-direction': 'column' });
    /* 고객센터와 링크 사이에 소개·SNS를 끼우려면 둘을 묶은 상자를 지워야 한다. */
    expect(declsFor('.wc-footer__middle', MOBILE)).toMatchObject({ display: 'contents' });
    /* 데스크톱에는 순서 규칙이 없다(현행 유지). */
    for (const selector of sequence) expect(declsFor(selector, DESKTOP).order, selector).toBeUndefined();
  });
});

describe('404 2CTA (CH-14)', () => {
  it('두 버튼을 260×56으로, 그룹을 260 두 칸 + 간격 8로 넓힌다', () => {
    expect(declsFor('.wc-not-found .wc-not-found__actions .wc-btn')).toMatchObject({ 'max-width': '260px', height: '56px' });
    expect(declsFor('.wc-not-found .wc-not-found__actions')['max-width']).toBe('528px');
    /* 가운데 정렬 flex 부모 안에서 글자 폭으로 줄지 않도록 폭을 명시한다(QA: 103px로 줄어 두 줄 꺾임). */
    expect(declsFor('.wc-not-found .wc-not-found__actions').width).toBe('min(528px, 100%)');
  });
});

describe('검색 모달 배경 inert (공지 스트립 포함)', () => {
  /* 백드롭이 로고 행 아래에서 시작해 공지 스트립이 딤 밖에 남는다 — 모달이 열린 동안 스트립도 inert여야 한다. */
  it('useOverlayA11y가 공지 스트립을 배경으로 덮는다', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('./useOverlayA11y.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/'[^']*\.wc-notice[^']*'/);
  });
});
