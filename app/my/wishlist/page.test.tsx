import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import Page, { metadata } from './page';

describe('/my/wishlist page', () => {
  it('keeps the preparing placeholder out of search indexes', () => {
    expect(metadata).toMatchObject({
      title: '위시리스트 — ICONS',
      robots: { index: false, follow: false },
    });
    expect(metadata.description).toContain('위시리스트');
  });

  /* 인증 mock 없이 그대로 렌더되는 것 자체가 계약이다 — 보여줄 개인 데이터가 없어
     로그인 게이트는 S4 실화면과 함께 들어온다. 게이트를 넣으면 이 렌더부터 깨진다. */
  it('renders the preparation notice as the page heading inside the wc scope', () => {
    const html = renderToStaticMarkup(<Page />);

    expect(html).toContain('class="wc-root"');
    expect(html).toMatch(/<h1[^>]*>[^<]*위시리스트[^<]*<\/h1>/);
  });

  it('routes the visitor to the goods shop instead of a dead end', () => {
    const html = renderToStaticMarkup(<Page />);

    expect(html).toContain('href="/shop"');
    expect(html).toContain('굿즈샵');
  });
});
