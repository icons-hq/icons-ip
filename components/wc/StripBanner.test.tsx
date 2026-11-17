import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StripBanner } from './StripBanner';

const base = { imageUrl: 'https://cdn.example.com/strip.webp', alt: '겨울 기획전' } as const;

describe('StripBanner', () => {
  it('renders the wrapper with the size attribute and one picture image', () => {
    const html = renderToStaticMarkup(<StripBanner {...base} size="home" />);

    expect(html).toContain('<div class="wc-strip-banner" data-size="home">');
    expect(html).toContain('<picture>');
    expect(html).toContain('class="wc-strip-banner__img"');
    expect(html).toContain('alt="겨울 기획전"');
    expect(html).toContain('src="https://cdn.example.com/strip.webp"');
    expect(html).not.toContain('<source');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('data-mobile');
  });

  it('wraps the picture in a link only when there is a destination', () => {
    const linked = renderToStaticMarkup(<StripBanner {...base} href="/events/winter" size="page" />);

    expect(linked).toContain('data-size="page"');
    expect(linked).toMatch(/<a class="wc-strip-banner__link" href="\/events\/winter"><picture>[\s\S]*<\/picture><\/a>/);

    for (const href of [undefined, null, '']) {
      expect(renderToStaticMarkup(<StripBanner {...base} href={href} size="home" />)).not.toContain('<a ');
    }
  });

  it('adds the phone source below 750px and carries its intrinsic ratio', () => {
    const html = renderToStaticMarkup(
      <StripBanner {...base} mobileImageSize={{ width: 750, height: 300 }} mobileImageUrl="https://cdn.example.com/strip-m.webp" size="home" />,
    );

    expect(html).toContain('<source height="300" media="(max-width: 749px)" srcSet="https://cdn.example.com/strip-m.webp" width="750"/>');
    expect(html).toContain('data-mobile="true"');
    expect(html).toContain('--wc-strip-mobile-ratio:750 / 300');
    expect(html.indexOf('<source')).toBeLessThan(html.indexOf('<img'));
  });

  it('keeps the phone source without dimensions when they are unknown or invalid', () => {
    for (const mobileImageSize of [undefined, null, { width: 0, height: 300 }, { width: Number.NaN, height: 10 }]) {
      const html = renderToStaticMarkup(<StripBanner {...base} mobileImageSize={mobileImageSize} mobileImageUrl="/m.webp" size="home" />);

      expect(html).toContain('media="(max-width: 749px)"');
      expect(html).not.toContain('--wc-strip-mobile-ratio');
      expect(html).not.toMatch(/<source[^>]*\b(width|height)=/);
    }
  });

  it('treats a blank phone image as absent', () => {
    const html = renderToStaticMarkup(<StripBanner {...base} mobileImageUrl="" size="home" />);

    expect(html).not.toContain('<source');
    expect(html).not.toContain('data-mobile');
  });

  it('passes the desktop image size to the img as intrinsic hints', () => {
    const html = renderToStaticMarkup(<StripBanner {...base} imageSize={{ width: 2544, height: 340 }} size="home" />);

    expect(html).toMatch(/<img[^>]*height="340"/);
    expect(html).toMatch(/<img[^>]*width="2544"/);
    expect(renderToStaticMarkup(<StripBanner {...base} imageSize={null} size="home" />)).not.toMatch(/<img[^>]*\b(width|height)=/);
  });
});
