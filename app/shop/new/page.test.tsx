import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Page, { metadata } from './page';

describe('/shop/new page', () => {
  it('keeps the preparing placeholder out of search indexes', () => {
    expect(metadata).toMatchObject({
      title: 'NEW — ICONS',
      robots: { index: false, follow: false },
    });
    expect(metadata.description).toContain('새로 나온');
  });

  it('renders the preparation notice as the page heading inside the wc scope', () => {
    const html = renderToStaticMarkup(<Page />);

    expect(html).toContain('class="wc-root"');
    expect(html).toMatch(/<h1[^>]*>[^<]*NEW[^<]*<\/h1>/);
  });

  it('routes the visitor to the full goods catalog instead of a dead end', () => {
    const html = renderToStaticMarkup(<Page />);

    expect(html).toContain('href="/shop"');
    expect(html).toContain('굿즈샵 둘러보기');
  });
});
