import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Page, { metadata } from './page';

describe('/shop/best page', () => {
  it('keeps the preparing placeholder out of search indexes', () => {
    expect(metadata).toMatchObject({
      title: 'BEST — ICONS',
      robots: { index: false, follow: false },
    });
    expect(metadata.description).toContain('가장 사랑받는');
  });

  it('renders the preparation notice as the page heading inside the wc scope', () => {
    const html = renderToStaticMarkup(<Page />);

    expect(html).toContain('class="wc-root"');
    expect(html).toMatch(/<h1[^>]*>[^<]*BEST[^<]*<\/h1>/);
  });

  it('routes the visitor to the full goods catalog instead of a dead end', () => {
    const html = renderToStaticMarkup(<Page />);

    expect(html).toContain('href="/shop"');
    expect(html).toContain('굿즈샵 둘러보기');
  });
});
