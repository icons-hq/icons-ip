import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * X SQUARE 공용 부품 스타일 계약(공용 부품 계약 §3·§5·§8). 수치가 계약과 어긋나거나 토큰 대신 색을 박으면 여기서 깨진다.
 * 부품 CSS 는 wc-storefront-x.css 에만 두고, 앞선 카드 규칙(wc-foundation·wc-catalog)은 건드리지 않는다.
 */
const css = (name: string) => readFileSync(new URL(`../../app/styles/${name}`, import.meta.url), 'utf8');
const X = css('wc-storefront-x.css');
const FOUNDATION = css('wc-foundation.css');

function rule(selector: string, source = X) {
  const start = source.indexOf(`${selector} {`);
  expect(start, `${selector} 규칙이 있어야 한다`).toBeGreaterThanOrEqual(0);
  return source.slice(start, source.indexOf('}', start));
}

describe('product card parts', () => {
  /* MD-0044 — 카드 어디를 눌러도 상세로 간다. 이름 링크 하나가 덮개로 카드 전체를 덮고, 하트·담기는 그 위에 선다. */
  it('stretches the name link over the whole card and keeps the heart and cart above it', () => {
    expect(rule('.wc-product-card')).toContain('isolation: isolate');
    const overlay = rule('.wc-product-card__name-link::after');
    expect(overlay).toContain('position: absolute');
    expect(overlay).toContain('inset: 0');
    expect(overlay).toContain('z-index: 1');
    expect(rule('.wc-product-card__action')).toContain('z-index: 2');
    expect(rule('.wc-product-card__cart')).toMatch(/position: relative;[\s\S]*z-index: 2/);
    /* 이미지 넘김 버튼은 공용 규칙에서 이미 z-index 2 다. */
    expect(css('store-presentation.css')).toMatch(/\.wc-root \.wc-product-card__gallery \{[^}]*z-index:2/);
  });

  it('sizes the text block like Figma: muted 14/500 brand, ink 14/500 name, 17px line height', () => {
    expect(rule('.wc-product-card__brand')).toMatch(/font-size: 14px;[\s\S]*font-weight: 500;[\s\S]*line-height: 17px;[\s\S]*color: var\(--wc-x-muted\)/);
    expect(rule('.wc-product-card__brand')).toContain('white-space: nowrap');
    expect(rule('.wc-product-card__name')).toMatch(/font-size: 14px;[\s\S]*font-weight: 500;[\s\S]*color: var\(--wc-x-ink\)/);
  });

  it('draws the price line as a 15 Bold sale rate and a 16 Bold amount from tokens', () => {
    expect(rule('.wc-price--inline .wc-price__rate')).toMatch(/font-size: 15px;[\s\S]*font-weight: 700;[\s\S]*color: var\(--wc-x-sale\)/);
    expect(rule('.wc-price--inline .wc-price__amount')).toMatch(/font-size: 16px;[\s\S]*font-weight: 700;[\s\S]*color: var\(--wc-x-ink\)/);
  });

  it('places the chip row 10px under the price with 6px gaps and wrapping', () => {
    const chips = rule('.wc-product-card__chips');
    expect(chips).toContain('flex-wrap: wrap');
    expect(chips).toContain('gap: 6px');
    expect(chips).toContain('margin-top: 10px');
  });

  it('sizes chips 11px/600 with 13px line height, 3/4 padding and the chip radius token', () => {
    const chip = rule('.wc-x-chip');
    expect(chip).toContain('font-size: 11px');
    expect(chip).toContain('font-weight: 600');
    expect(chip).toContain('line-height: 13px');
    expect(chip).toContain('padding: 3px 4px');
    expect(chip).toContain('var(--wc-x-radius-chip)');
  });

  it.each([
    ['preorder', 'preorder'],
    ['freeShipping', 'shipping'],
    ['random', 'random'],
    ['tag', 'tag'],
  ])('colors the %s chip only from its tokens', (kind, token) => {
    const chip = rule(`.wc-x-chip--${kind}`);
    expect(chip).toContain(`background: var(--wc-x-chip-${token}-bg)`);
    expect(chip).toContain(`color: var(--wc-x-chip-${token}-ink)`);
    expect(chip).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(FOUNDATION).toContain(`--wc-x-chip-${token}-bg:`);
    expect(FOUNDATION).toContain(`--wc-x-chip-${token}-ink:`);
  });

  it('moves the wish heart to the bottom right with a 32px disc and the heart token for the selected state', () => {
    const action = rule('.wc-product-card__action');
    expect(action).toContain('top: auto');
    expect(action).toContain('right: 2px');
    expect(action).toContain('bottom: 2px');
    expect(X).toMatch(/\.wc-product-card__action \.wc-list-heart__disc,\s*\.wc-x-pick \.wc-list-heart__disc \{[^}]*width: 32px;[^}]*height: 32px/);
    expect(X).toMatch(/\.wc-product-card__action \.wc-list-heart\.is-active,\s*\.wc-x-pick \.wc-list-heart\.is-active \{ color: var\(--wc-x-heart\); \}/);
  });

  it('moves the gallery stepper to the bottom left so it never overlaps the heart', () => {
    const gallery = rule('.wc-root .wc-product-card__gallery');
    expect(gallery).toContain('right: auto');
    expect(gallery).toContain('left: 8px');
  });

  it('rounds the thumbnail with the card radius token', () => {
    expect(rule('.wc-product-card__media')).toContain('border-radius: var(--wc-x-radius-card)');
  });
});

describe('section header parts', () => {
  it('sets the title 28 Bold on desktop and 20 on phones, with the face reset for the editorial headings', () => {
    const title = rule('.wc-x-sechead__title');
    expect(title).toContain('font-family: inherit');
    expect(title).toContain('font-size: 20px');
    expect(title).toContain('font-weight: 700');
    expect(title).toContain('letter-spacing: -.5px');
    expect(title).toContain('color: var(--wc-x-ink)');
    expect(X).toMatch(/@media \(min-width: 750px\) \{\s*\.wc-x-sechead__title \{ font-size: 28px; \}/);
    expect(rule('.wc-x-sechead')).toContain('margin: 0 0 18px');
  });

  it('draws the pill 38px tall with a 1px pill line token and a fully rounded edge', () => {
    const pill = rule('.wc-x-pill');
    expect(pill).toContain('min-height: 38px');
    expect(pill).toContain('padding: 10px 16px');
    expect(pill).toContain('border: 1px solid var(--wc-x-line-pill)');
    expect(pill).toContain('border-radius: 999px');
    expect(pill).toContain('font-size: 13px');
    expect(pill).toContain('font-weight: 500');
    expect(pill).toContain('color: rgba(18, 18, 18, .8)');
  });
});

describe('strip banner parts', () => {
  it('uses 1272:170 for home and 1272:340 for page, cover fit and the strip radius token', () => {
    expect(rule(".wc-strip-banner[data-size='home'] .wc-strip-banner__img")).toContain('aspect-ratio: 1272 / 170');
    expect(rule(".wc-strip-banner[data-size='page'] .wc-strip-banner__img")).toContain('aspect-ratio: 1272 / 340');
    expect(rule('.wc-strip-banner__img')).toContain('object-fit: cover');
    expect(rule('.wc-strip-banner')).toContain('border-radius: var(--wc-x-radius-strip)');
  });

  it('rounds to 8px on phones and follows the phone image ratio only when one is supplied', () => {
    const phones = X.slice(X.indexOf('@media (max-width: 749px) {\n  .wc-strip-banner'));
    expect(phones).toContain('.wc-strip-banner { border-radius: 8px; }');
    expect(phones).toContain(".wc-strip-banner[data-mobile='true'] .wc-strip-banner__img { aspect-ratio: auto var(--wc-strip-mobile-ratio, 3 / 1); }");
  });
});
