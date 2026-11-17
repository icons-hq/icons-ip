import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * POP-UP·EVENT·프로모션 카드 스타일 계약(스펙 C §2.6·§2.7, 공용 부품 계약 §9). 수치가 Figma 와 어긋나거나
 * 전역 규칙이 끼어들면 여기서 깨진다. 이 파일의 선택자는 .wc-promo-*·.wc-popup-hub·.wc-event-hub·.wc-campaign__venue 로만 시작한다.
 */
const css = readFileSync(new URL('../../app/styles/wc-popups.css', import.meta.url), 'utf8');

function rule(selector: string) {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} 규칙이 있어야 한다`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
}

describe('promo card', () => {
  it('keeps the 408:260 ratio with the card radius token and a grey face for missing art', () => {
    const card = rule('.wc-promo-card');
    expect(card).toContain('aspect-ratio: 408 / 260');
    expect(card).toContain('border-radius: var(--wc-x-radius-card)');
    expect(card).toContain('background: var(--wc-surface-grey-2)');
    expect(card).toContain('overflow: hidden');
  });

  it('lays a bottom gradient from transparent to the ink token over 150px (57.7% of the card height)', () => {
    const gradient = rule('.wc-promo-card::after');
    expect(gradient).toContain('height: 57.7%');
    expect(gradient).toContain('linear-gradient(180deg, rgba(18, 18, 18, 0) 0%, var(--wc-x-ink) 100%)');
  });

  it('sets the white title 20 Bold / 27px, two lines, with the face reset for the editorial headings', () => {
    expect(css).toMatch(/@media \(min-width: 750px\) \{\s*\.wc-promo-card__body \{[^}]*right: 30px;[^}]*bottom: 30px;[^}]*left: 30px;[^}]*\}\s*\.wc-promo-card__title \{[^}]*font-size: 20px;[^}]*line-height: 27px;/);
    const title = rule('.wc-promo-card__title');
    expect(title).toContain('-webkit-line-clamp: 2');
    expect(title).toContain('font-family: inherit');
    expect(title).toContain('font-weight: 700');
    expect(title).toContain('color: #FFFFFF');
  });

  it('draws the upcoming badge 12px inside the top left: 90% white, ink 12 SemiBold, chip radius, 3/6 padding', () => {
    const badge = rule('.wc-promo-card__badge');
    expect(badge).toContain('top: 12px');
    expect(badge).toContain('left: 12px');
    expect(badge).toContain('padding: 3px 6px');
    expect(badge).toContain('background: rgba(255, 255, 255, .9)');
    expect(badge).toContain('font-size: 12px');
    expect(badge).toContain('font-weight: 600');
    expect(badge).toContain('border-radius: var(--wc-x-radius-chip)');
    expect(badge).toContain('color: var(--wc-x-ink)');
  });

  it('keeps the meta line single, 14 Medium at 80% white', () => {
    const meta = rule('.wc-promo-card__meta');
    expect(meta).toContain('font-size: 14px');
    expect(meta).toContain('font-weight: 500');
    expect(meta).toContain('color: rgba(255, 255, 255, .8)');
    expect(meta).toContain('white-space: nowrap');
  });
});

describe('promo grid and page', () => {
  it('goes 1 column on phones, 2 from 750 and 3 from 990 with 24 / 40 gaps on desktop', () => {
    expect(rule('.wc-promo-grid')).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(css).toMatch(/@media \(min-width: 750px\) \{\s*\.wc-promo-grid \{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/@media \(min-width: 990px\) \{\s*\.wc-promo-grid \{[^}]*repeat\(3, minmax\(0, 1fr\)\);\s*gap: 40px 24px;/);
  });

  it('sets the page title 32 Bold on desktop (24 on phones) from the ink token with the editorial face reset', () => {
    const title = rule('.wc-promo-page__title');
    expect(title).toContain('font-family: inherit');
    expect(title).toContain('font-size: 24px');
    expect(title).toContain('font-weight: 700');
    expect(title).toContain('color: var(--wc-x-ink)');
    expect(css).toMatch(/@media \(min-width: 750px\) \{[^@]*\.wc-promo-page__title \{[^}]*font-size: 32px;/);
  });
});

describe('event banner slider', () => {
  it('places the arrows 32px at the bottom right of the banner and keeps them scoped to the event hub', () => {
    const arrow = rule('.wc-event-hub .wc-campaign-banners__arrow');
    expect(arrow).toContain('bottom: 20px');
    expect(arrow).toContain('width: 32px');
    expect(arrow).toContain('height: 32px');
    expect(rule('.wc-event-hub .wc-campaign-banners__arrow--next')).toContain('right: 20px');
    expect(rule('.wc-event-hub .wc-campaign-banners__arrow--prev')).toContain('right: 60px');
  });

  it('leaves 60px under the banner on desktop', () => {
    expect(css).toMatch(/@media \(min-width: 990px\) \{\s*\.wc-event-hub__banners \{ margin-bottom: 60px; \}/);
  });
});

describe('scope', () => {
  it('starts every top-level selector with a screen-owned class (no global element rules)', () => {
    const selectors = [...css.matchAll(/^([^\s@/*}][^{]*)\{/gm)].flatMap((match) => match[1].split(',').map((part) => part.trim()));

    expect(selectors.length).toBeGreaterThan(10);
    for (const selector of selectors) {
      expect(selector, `${selector} 는 화면 전용 클래스로 시작해야 한다`).toMatch(/^\.(wc-promo-|wc-popup-hub|wc-event-hub|wc-campaign__venue)/);
    }
  });
});
