import { readFileSync } from 'node:fs';
import postcss, { type AtRule } from 'postcss';
import { describe, expect, it } from 'vitest';

/* LFS 패리티 2차 L4(#569) — 목록·검색·온라인 팝업·홈의 수치 계약(11 §8.3).
 * 문자열 계약은 실제 브라우저 시각 회귀 검수를 대신하지 않는다(DESIGN §11). 여기서는 레퍼런스 실측값이
 * CSS 에서 조용히 되돌아가는 것만 막는다. */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

type Decls = Record<string, string>;

/** 선택자 하나의 선언을 모은다. media 를 주면 그 조건의 @media 안 규칙만, 생략하면 @media 밖 규칙만 본다. */
function decls(file: string, selector: string, media?: string): Decls {
  const out: Decls = {};
  postcss.parse(read(file)).walkRules((rule) => {
    const parent = rule.parent?.type === 'atrule' ? (rule.parent as AtRule) : null;
    const inMedia = parent?.name === 'media' ? parent.params : null;
    if ((media ?? null) !== inMedia) return;
    if (!rule.selectors.map((item) => item.trim()).includes(selector)) return;
    rule.walkDecls((decl) => { out[decl.prop] = decl.value; });
  });
  return out;
}

const CATALOG = './styles/wc-catalog.css';
const FOUNDATION = './styles/wc-foundation.css';
const DESKTOP = '(min-width: 990px)';

describe('컬렉션 수량·정렬 줄 (11 CL-05)', () => {
  it('데스크톱은 896×50 바에 상하 1px 헤어라인, 그리드까지 16px 이다', () => {
    const toolbar = decls(CATALOG, '.wc-collection__toolbar', DESKTOP);

    expect(toolbar['min-height']).toBe('50px');
    expect(toolbar['box-sizing']).toBe('border-box');
    expect(toolbar['border-top']).toBe('1px solid var(--wc-hairline)');
    expect(toolbar['border-bottom']).toBe('1px solid var(--wc-hairline)');
    expect(toolbar['margin-bottom']).toBe('16px');
  });

  it('수량과 정렬 글자는 14px 이고 "전체 ›" 머리는 데스크톱에서만 보인다', () => {
    expect(decls(CATALOG, '.wc-collection__count')['font-size']).toBe('14px');
    expect(decls(CATALOG, '.wc-collection__sort')['font-size']).toBe('14px');
    expect(decls(CATALOG, '.wc-collection__count-scope').display).toBe('none');
    expect(decls(CATALOG, '.wc-collection__count-scope', DESKTOP).display).toBe('inline');
  });
});

describe('필터 그룹 선 (11 CL-06)', () => {
  it('사이드바는 첫 그룹까지 모든 그룹 위에 1px 선을 긋고 제목 줄은 58 높이다', () => {
    const group = decls(CATALOG, '.wc-collection__sidebar .wc-filter-group');
    const summary = decls(CATALOG, '.wc-collection__sidebar .wc-filter-group__summary');

    expect(group['border-top']).toBe('1px solid var(--wc-hairline)');
    expect(decls(CATALOG, '.wc-collection__sidebar .wc-filter-group + .wc-filter-group')['border-top']).toBe('1px solid var(--wc-hairline)');
    expect(summary.padding).toBe('18px 0 20px');
    expect(summary['line-height']).toBe('20px');
  });

  it('바텀시트 안의 그룹은 탭이 제목을 대신하므로 선을 지운다', () => {
    expect(decls(CATALOG, '.wc-filter-sheet__body .wc-filter-group')['border-top']).toBe('0');
  });
});

describe('VIEW MORE (11 CL-07)', () => {
  it('프리미티브는 1px 옅은 컨트롤 선(#DCDEE0)과 r5 다', () => {
    const viewMore = decls(FOUNDATION, '.wc-view-more');

    expect(read(FOUNDATION)).toContain('--wc-line-control-soft: #DCDEE0');
    expect(viewMore.border).toBe('1px solid var(--wc-line-control-soft)');
    expect(viewMore['border-radius']).toBe('5px');
    expect(viewMore['font-size']).toBe('14px');
    expect(viewMore['font-weight']).toBe('700');
  });

  it('컬렉션에서는 그리드 폭 896×48 바로 편다', () => {
    const collection = decls(CATALOG, '.wc-collection__main .wc-view-more');

    expect(collection.width).toBe('100%');
    expect(collection.height).toBe('48px');
    expect(collection['min-width']).toBe('0');
  });
});

describe('목록 하트 (11 CL-01 · 12 LD-4)', () => {
  it('44px 히트 영역 안에 36px 흰 원을 그리고 카드 우상단 4px 에 앉힌다', () => {
    const heart = decls(CATALOG, '.wc-list-heart');
    const disc = decls(CATALOG, '.wc-list-heart__disc');

    expect([heart.width, heart.height]).toEqual(['44px', '44px']);
    expect([disc.width, disc.height]).toEqual(['36px', '36px']);
    expect(disc['border-radius']).toBe('50%');
    expect(disc.background).toBe('var(--wc-surface)');
    expect(decls(CATALOG, '.wc-product-card__action .wc-list-heart').margin).toBe('-4px -4px 0 0');
  });

  it('빈 하트는 ink.tertiary, 찜한 하트는 비텍스트 액센트다', () => {
    expect(decls(CATALOG, '.wc-list-heart').color).toBe('var(--wc-ink-tertiary)');
    expect(decls(CATALOG, '.wc-list-heart.is-active').color).toBe('var(--wc-accent)');
  });
});

describe('검색 결과 머리 (11 SR-02) · 페이지 창 (SR-03)', () => {
  it('데스크톱은 24/400 제목과 435px 인풋이 한 줄이다', () => {
    const head = decls(CATALOG, '.wc-search-results__head', DESKTOP);

    expect(head.display).toBe('flex');
    expect(head['justify-content']).toBe('space-between');
    expect(decls(CATALOG, '.wc-search-results__form', DESKTOP).width).toBe('435px');
    expect(decls(CATALOG, '.wc-search-results__heading')['font-size']).toBe('24px');
    expect(decls(CATALOG, '.wc-search-results__heading')['font-weight']).toBe('400');
    expect(decls(CATALOG, '.wc-search-results__heading')['letter-spacing']).toBe('-.2px');
  });

  it('결과가 있는 모바일은 제목을 시각만 숨기고 인풋은 포커스에서도 뺀다', () => {
    expect(decls(CATALOG, '.wc-search-results__head.has-results .wc-search-results__heading').clip).toBe('rect(0, 0, 0, 0)');
    expect(decls(CATALOG, '.wc-search-results__head.has-results .wc-search-results__form').display).toBe('none');
  });

  it('767px 이하는 넓은 창 표식을, 768px 이상은 좁은 창 표식을 감춘다', () => {
    expect(decls(CATALOG, '.wc-pagination .is-wide', '(max-width: 767px)').display).toBe('none');
    expect(decls(CATALOG, '.wc-pagination .is-narrow', '(min-width: 768px)').display).toBe('none');
  });
});

const DISCOVERY = './styles/wc-discovery.css';

describe('온라인 팝업 디렉토리 (11 IP-02~04)', () => {
  it('데스크톱 피처드 이름은 하단 36px scrim 띠 위 16/700 이다', () => {
    const name = decls(DISCOVERY, '.wc-ipdir__tile > span', DESKTOP);

    expect(name.height).toBe('36px');
    expect(name.background).toBe('var(--wc-scrim)');
    expect(name['font-size']).toBe('16px');
    expect(name['font-weight']).toBe('700');
    expect(name.padding).toBe('0 14px');
    expect(decls(DISCOVERY, '.wc-ipdir__tile::before', DESKTOP).content).toBe('none');
  });

  it('A–Z 바는 위쪽만 2px 잉크 선이고 데스크톱 글자는 균등 배분하지 않는다', () => {
    const band = decls(DISCOVERY, '.wc-alpha-index-band');

    expect(band['border-top']).toBe('2px solid var(--wc-ink)');
    expect(band['border-bottom']).toBeUndefined();
    expect(decls(DISCOVERY, '.wc-alpha-index__letter', DESKTOP).flex).toBe('none');
    expect(decls(DISCOVERY, '.wc-alpha-index__letter', DESKTOP).padding).toBe('0 10px');
    expect(decls(DISCOVERY, '.wc-alpha-index__letter')['font-size']).toBe('15px');
  });

  it('모바일 피처드 점은 24×44 터치 상자이고 데스크톱 그리드에서는 감춘다', () => {
    const dot = decls(DISCOVERY, '.wc-ipdir__featured .wc-slider__dot');

    expect([dot.width, dot.height]).toEqual(['24px', '44px']);
    expect(decls(DISCOVERY, '.wc-ipdir__featured .wc-slider__dot[aria-current=\'true\']::before').background).toBe('var(--wc-ink)');
    expect(decls(DISCOVERY, '.wc-ipdir__featured .wc-slider__dots', DESKTOP).display).toBe('none');
    expect(decls(DISCOVERY, '.wc-ipdir__featured .wc-slider__controls', DESKTOP).display).toBe('none');
  });
});

describe('IP관 모바일 배너 (11 IP-05)', () => {
  const MOBILE = '(max-width: 749px)';

  it('모바일은 배너 글자를 가운데 세우고 해시태그를 배너 아래로 내린다', () => {
    expect(decls(DISCOVERY, '.wc-iphall__banner .wc-container', MOBILE)['text-align']).toBe('center');
    expect(decls(DISCOVERY, '.wc-iphall__hashtags--banner', MOBILE).display).toBe('none');
    expect(decls(DISCOVERY, '.wc-iphall__tags-band', MOBILE).display).toBe('block');
    expect(decls(DISCOVERY, '.wc-iphall__tags-band').display).toBe('none');
  });
});
