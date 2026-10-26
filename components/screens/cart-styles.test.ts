import { readFileSync } from 'node:fs';
import postcss, { type AtRule } from 'postcss';
import { describe, expect, it } from 'vitest';

/*
 * 장바구니 지면 CSS 계약 (LFS 패리티 2차 L9 — CT-01~04).
 * 화면 구조는 Cart.test 가 지키고, 여기서는 그 구조를 레퍼런스 수치로 세우는 지면 값을 지킨다.
 * 문자열 계약은 브라우저 시각 검수를 대신하지 않는다(DESIGN §11).
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

interface Rule { selectors: string[]; media: string | null; decls: Record<string, string> }
function rules(path: string): Rule[] {
  const out: Rule[] = [];
  postcss.parse(read(path)).walkRules((rule) => {
    const media = rule.parent?.type === 'atrule' ? (rule.parent as AtRule).params : null;
    const decls: Record<string, string> = {};
    rule.walkDecls((decl) => { decls[decl.prop] = decl.value.trim(); });
    out.push({ selectors: rule.selectors.map((selector) => selector.trim()), media, decls });
  });
  return out;
}
const decls = (all: Rule[], selector: string, media: string | null = null) => Object.assign({}, ...all
  .filter((rule) => rule.media === media && rule.selectors.includes(selector))
  .map((rule) => rule.decls)) as Record<string, string>;

const catalog = rules('../../app/styles/wc-catalog.css');
const globals = rules('../../app/globals.css');
const chrome = rules('../../app/styles/wc-chrome.css');
const MOBILE = '(max-width: 989px)';
const DESKTOP = '(min-width: 990px)';

describe('요약 박스 (CT-01)', () => {
  it('데스크톱 요약은 360 회색 박스·안쪽 24 이고 목록 높이로 늘지 않는다', () => {
    expect(decls(catalog, '.wc-cart__aside', DESKTOP)).toMatchObject({ width: '360px', padding: '24px 24px 32px',
      background: 'var(--wc-surface-grey)', 'border-top': '0', margin: '0' });
    expect(decls(catalog, '.wc-cart__layout', DESKTOP)).toMatchObject({ display: 'flex', 'align-items': 'flex-start', gap: '40px' });
    /* 회색 박스 안 쿠폰 칸은 흰 카드다 — 셀렉트·입력이 바탕에 묻히지 않는다. */
    expect(decls(catalog, '.wc-cart__aside .wc-cart__coupon-slot', DESKTOP).background).toBe('var(--wc-surface)');
  });

  it('예상 총액 금액은 26/700 잉크, 안내 문구는 금액 서체로 키우지 않는다', () => {
    expect(decls(catalog, '.wc-cart__summary .wc-cart__total')).toMatchObject({ 'font-size': '26px', 'font-weight': '700' });
    expect(decls(catalog, '.wc-cart__summary .wc-cart__total--pending')).toMatchObject({ 'font-size': '14px', 'font-weight': '400',
      color: 'var(--wc-ink-tertiary)' });
    expect(decls(catalog, '.wc-cart__summary tfoot th').color).toBe('var(--wc-ink)');
    /* 레퍼런스의 금액 핑크를 액센트로 옮기지 않는다 — 금액 칸에 색을 따로 주지 않아 표의 잉크를 그대로 쓴다. */
    expect(decls(catalog, '.wc-cart__summary .wc-cart__total').color).toBeUndefined();
    expect(decls(catalog, '.wc-cart__summary td').color).toBe('var(--wc-ink)');
  });

  it('주문 CTA 는 박스 안 312(360 − 24×2)×56 이다', () => {
    expect(decls(catalog, '.wc-cart__checkout.wc-btn').height).toBe('56px');
    expect(decls(catalog, '.wc-cart__cta-bar')['margin-top']).toBe('24px');
  });
});

describe('빈 상태 (CT-02)', () => {
  it('16/400 안내 → 16 → 220×60 액센트 CTA, 일러스트 자리는 146 + 아래 20 이다', () => {
    expect(decls(catalog, '.wc-cart__empty-message')).toMatchObject({ 'font-size': '16px', 'font-weight': '400', color: 'var(--wc-ink)' });
    expect(decls(catalog, '.wc-cart__empty .wc-cart__cta-bar')['margin-top']).toBe('16px');
    expect(decls(catalog, '.wc-cart__empty-art')).toMatchObject({ width: '146px', height: '146px', 'margin-bottom': '20px' });
    expect(decls(catalog, '.wc-cart__empty')).toMatchObject({ display: 'flex', 'flex-direction': 'column', 'align-items': 'center' });
    /* 일러스트(LG-7)가 오면 레퍼런스처럼 위 여백 32 로 줄인다. */
    expect(decls(catalog, '.wc-cart__empty:has(.wc-cart__empty-art)')['padding-top']).toBe('32px');
  });

  it('액센트 CTA 글자는 잉크다 — brand-green 위 흰 글자(2.3:1)는 AA 미달이다', () => {
    expect(decls(catalog, '.wc-cart__empty-cta.wc-btn.accent')).toMatchObject({ width: '220px', height: '60px', color: 'var(--wc-ink)' });
  });
});

describe('모바일 카트 크롬 (CT-03)', () => {
  it('서브헤더는 모바일에서만 52 높이 sticky 막대다 — 셸 sticky 크롬 높이·해시 착지선과 같은 값', () => {
    expect(decls(catalog, '.wc-cart-subheader').display).toBe('none');
    const subheader = decls(catalog, '.wc-cart-subheader', MOBILE);
    expect(subheader).toMatchObject({ position: 'sticky', top: '0', display: 'grid', height: '52px',
      'grid-template-columns': '44px minmax(0, 1fr) 44px', 'border-bottom': '1px solid var(--wc-hairline-soft)', background: 'var(--wc-surface)' });
    expect(subheader.height).toBe(decls(chrome, '.wc-root')['--wc-sticky-chrome-h']);
    expect(decls(catalog, '.wc-cart-subheader__btn', MOBILE)).toMatchObject({ width: '44px', height: '44px' });
    expect(decls(catalog, '.wc-cart-subheader__title', MOBILE)).toMatchObject({ 'font-size': '18px', 'font-weight': '700', 'text-align': 'center' });
  });

  it('서브헤더가 있는 동안 모바일 전역 헤더를 감추고 h1 은 시각만 숨긴다', () => {
    expect(decls(catalog, '.wc-chrome:has(~ #root .wc-cart-subheader) .wc-header', MOBILE).display).toBe('none');
    expect(catalog.some((rule) => rule.media !== MOBILE && rule.selectors.some((selector) => selector.includes('.wc-cart-subheader) .wc-header')))).toBe(false);
    expect(decls(catalog, '.wc-cart__title', MOBILE)).toMatchObject({ position: 'absolute', width: '1px', height: '1px', 'clip-path': 'inset(50%)' });
  });

  it('주문 바는 하단 고정·흰 바탕·위 1px 선·안쪽 16 + 안전 영역, CTA 전폭×60 이다', () => {
    const bar = decls(catalog, '.wc-cart__cta-bar', MOBILE);
    expect(bar).toMatchObject({ position: 'fixed', bottom: '0', left: '0', right: '0', 'z-index': '100', margin: '0',
      padding: '16px var(--wc-gutter) calc(16px + env(safe-area-inset-bottom))', 'border-top': '1px solid var(--wc-hairline)', background: 'var(--wc-surface)' });
    /* 빈 상태의 묶음 여백(.wc-cart__empty .wc-cart__cta-bar)이 고정 바를 밀지 않도록 같은 선언에 묶는다. */
    expect(decls(catalog, '.wc-cart__empty .wc-cart__cta-bar', MOBILE)).toMatchObject({ position: 'fixed', margin: '0' });
    expect(decls(catalog, '.wc-cart__cta-bar .wc-btn', MOBILE).height).toBe('60px');
    expect(decls(catalog, '.wc-cart__cta-bar .wc-cart__empty-cta.wc-btn.accent', MOBILE).width).toBe('100%');
  });

  it('모바일 바는 예상 총액이 확정된 동안만 금액 문구를 보이고, 데스크톱은 수량 문구다', () => {
    expect(decls(catalog, '.wc-cart__checkout-amount').display).toBe('none');
    expect(decls(catalog, '.wc-cart__checkout--amount .wc-cart__checkout-count', MOBILE).display).toBe('none');
    expect(decls(catalog, '.wc-cart__checkout--amount .wc-cart__checkout-amount', MOBILE).display).toBe('inline');
  });

  /* 첫 화면에 푸터가 올라오지 않는 계약은 불러오는 중에도 지킨다(L9 QA 첫 페인트) — 로딩 → 빈 상태에서 푸터가 첫 화면으로
     올라왔다 밀려나지 않는다. 데스크톱은 한 화면을 잡아(루트 스켈레톤과 같은 첫 화면) 담긴 카트로 바뀔 때 푸터가 밀려나지
     않고, 빈 상태는 레퍼런스처럼 첫 화면에 푸터가 보이는 높이 그대로다. */
  it('불러오는 중 블록은 모바일에서 빈 상태와 같은 최소 높이, 데스크톱에서 한 화면 높이를 잡는다', () => {
    const empty = decls(catalog, '.wc-cart__empty', MOBILE);
    expect(empty['min-height']).toBe('calc(100dvh - 145px)');
    expect(decls(catalog, '.wc-cart__loading', MOBILE)['min-height']).toBe(empty['min-height']);
    expect(decls(catalog, '.wc-cart__loading', DESKTOP)['min-height']).toBe('100vh');
    expect(decls(catalog, '.wc-cart__empty', DESKTOP)['min-height']).toBeUndefined();
    expect(decls(catalog, '.wc-cart__empty')['min-height']).toBeUndefined();
  });

  it('바가 마지막 행·푸터·문의 런처를 가리지 않게 바닥을 연다', () => {
    expect(decls(catalog, '.wc-cart', MOBILE)['padding-block']).toBe('0 calc(117px + env(safe-area-inset-bottom))');
    expect(decls(catalog, '#root:has(.wc-cart__cta-bar) .wc-inquiry-widget__launcher', MOBILE).bottom).toBe('calc(109px + env(safe-area-inset-bottom))');
    expect(decls(catalog, '#root:has(.wc-cart__cta-bar) ~ .wc-footer', MOBILE)['padding-bottom']).toBe('calc(173px + env(safe-area-inset-bottom))');
  });

  it('키보드 포커스·해시 이동이 바 뒤에 멈추지 않게 문서 착지선 아래쪽도 바 위로 올린다', () => {
    /* 바(93) 뒤의 수량·삭제·푸터 링크는 화면 안으로 판정돼 스크롤되지 않고 통째로 가려졌다(WCAG 2.4.11).
       html 은 표면 CSS 가 건드리지 않는다(wc-design 계약) — 전역 착지선을 가진 globals.css 가 바 높이 + 16 을 적는다. */
    expect(decls(globals, 'html:has(.wc-cart__cta-bar)', MOBILE)['scroll-padding-bottom']).toBe('calc(109px + env(safe-area-inset-bottom))');
    expect(decls(globals, 'html:has(.wc-cart__cta-bar)', DESKTOP)['scroll-padding-bottom']).toBeUndefined();
    expect(decls(globals, 'html:has(.wc-cart__cta-bar)')['scroll-padding-bottom']).toBeUndefined();
  });
});

describe('목록 (CT-04)', () => {
  it('데스크톱 목록 맨 위 2px 잉크 선, 썸네일 64(모바일 80)', () => {
    expect(decls(catalog, '.wc-cart__list-col', DESKTOP)['border-top']).toBe('2px solid var(--wc-ink)');
    expect(decls(catalog, '.wc-cart__line', DESKTOP)['grid-template-columns']).toBe('64px minmax(0, 1fr)');
    expect(decls(catalog, '.wc-cart__line-media', DESKTOP).width).toBe('64px');
    expect(decls(catalog, '.wc-cart__line-media').width).toBe('80px');
    /* 행마다 아래 1px 이고, 목록 상자에는 선이 없다 — 그룹 머리 아래 선과 겹쳐 2px 로 보이지 않게. */
    expect(decls(catalog, '.wc-cart__line')['border-bottom']).toBe('1px solid var(--wc-hairline)');
    expect(decls(catalog, '.wc-cart__list')['border-top']).toBeUndefined();
  });

  it('옵션 회색 밴드는 행 전폭 50 이상이고, 삭제는 44 터치 상자다', () => {
    expect(decls(catalog, '.wc-cart__line-band')).toMatchObject({ 'grid-column': '1 / -1', display: 'flex', 'min-height': '50px',
      background: 'var(--wc-surface-grey)' });
    expect(decls(catalog, '.wc-cart__remove')).toMatchObject({ width: '44px', height: '44px' });
    expect(decls(catalog, '.wc-cart__line-total')).toMatchObject({ 'grid-column': '1 / -1', 'justify-self': 'end', 'font-size': '16px', 'font-weight': '700' });
  });

  it('출고지 그룹 공유 규칙(주문서와 같은 모양)은 카트 구간이 바꾸지 않는다', () => {
    expect(decls(catalog, '.wc-shipping-group')).toEqual({ 'margin-bottom': '24px' });
  });

  it('강제 색상 모드에서는 밴드·요약 박스 경계를 시스템 글자색으로 다시 긋는다', () => {
    expect(decls(catalog, '.wc-cart__line-band', '(forced-colors: active)').border).toBe('1px solid CanvasText');
    expect(decls(catalog, '.wc-cart__aside', '(forced-colors: active)').border).toBe('1px solid CanvasText');
  });
});
