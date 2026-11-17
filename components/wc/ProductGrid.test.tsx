import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProductGrid } from './ProductGrid';

const STOREFRONT_X = readFileSync(new URL('../../app/styles/wc-storefront-x.css', import.meta.url), 'utf8');

describe('ProductGrid', () => {
  it('renders a list with the listing density by default and keeps the children', () => {
    const html = renderToStaticMarkup(<ProductGrid><li>하나</li><li>둘</li></ProductGrid>);

    expect(html).toBe('<ul class="wc-x-grid" data-density="listing"><li>하나</li><li>둘</li></ul>');
  });

  it('carries the home density, an extra class and an accessible name', () => {
    const html = renderToStaticMarkup(<ProductGrid className="wc-home__grid" density="home" label="NEW ARRIVAL 상품"><li>하나</li></ProductGrid>);

    expect(html).toContain('class="wc-x-grid wc-home__grid"');
    expect(html).toContain('data-density="home"');
    expect(html).toContain('aria-label="NEW ARRIVAL 상품"');
  });

  it('leaves the accessible name off when no label is given', () => {
    expect(renderToStaticMarkup(<ProductGrid><li>하나</li></ProductGrid>)).not.toContain('aria-label');
  });
});

/* 열·간격 숫자는 CSS 가 쥔다 — 계약 §4 표가 바뀌면 여기서 깨져야 한다. */
describe('ProductGrid stylesheet', () => {
  function block(selector: string, source = STOREFRONT_X) {
    const start = source.indexOf(`${selector} {`);
    expect(start, `${selector} 규칙이 있어야 한다`).toBeGreaterThanOrEqual(0);
    return source.slice(start, source.indexOf('}', start));
  }

  it('starts at two columns with 12px column gap and the listing/home row gaps for phones', () => {
    const base = block('.wc-x-grid');
    expect(base).toContain('repeat(2, minmax(0, 1fr))');
    expect(base).toContain('column-gap: 12px');
    expect(base).toContain('row-gap: 32px');
    expect(block(".wc-x-grid[data-density='home']")).toContain('row-gap: 28px');
  });

  it.each([
    [750, 3, null, 40],
    [990, 4, 15, 48],
    [1200, 5, null, 56],
  ])('steps to the right column count at %ipx', (minWidth, columns, columnGap, listingRowGap) => {
    const media = STOREFRONT_X.slice(STOREFRONT_X.indexOf(`@media (min-width: ${minWidth}px) {\n  .wc-x-grid`));
    const rule = media.slice(0, media.indexOf('\n}'));

    expect(rule).toContain(`repeat(${columns}, minmax(0, 1fr))`);
    if (columnGap) expect(rule).toContain(`column-gap: ${columnGap}px`);
    expect(rule).toContain(`row-gap: ${listingRowGap}px`);
    expect(rule).toContain(".wc-x-grid[data-density='home'] { row-gap: 24px; }");
  });
});
