import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SectionHeader } from './SectionHeader';

describe('SectionHeader', () => {
  it('renders an h2 with the id and a pill whose accessible name carries the title', () => {
    const html = renderToStaticMarkup(<SectionHeader id="home-new" moreHref="/shop/new" title="NEW ARRIVAL" />);

    expect(html).toContain('<header class="wc-x-sechead">');
    expect(html).toContain('<h2 class="wc-x-sechead__title" id="home-new">NEW ARRIVAL</h2>');
    expect(html).toContain('<a aria-label="NEW ARRIVAL 전체보기" class="wc-x-pill" href="/shop/new">전체보기</a>');
  });

  /* 보이는 글('전체보기')이 접근 이름에 들어 있어야 음성 제어가 맞는다(WCAG 2.5.3 Label in Name). */
  it('keeps the visible pill text inside the accessible name', () => {
    const html = renderToStaticMarkup(<SectionHeader id="s" moreHref="/x" moreLabel="더 보기" title="홍실퀘스트" />);
    const label = html.match(/aria-label="([^"]*)"/)?.[1] ?? '';
    const visible = html.match(/>([^<]*)<\/a>/)?.[1] ?? '';

    expect(visible).toBe('더 보기');
    expect(label).toBe('홍실퀘스트 더 보기');
    expect(label).toContain(visible);
  });

  it('honours the heading level', () => {
    expect(renderToStaticMarkup(<SectionHeader as="h1" id="a" title="NEW" />)).toContain('<h1 class="wc-x-sechead__title" id="a">NEW</h1>');
    expect(renderToStaticMarkup(<SectionHeader as="h3" id="a" title="NEW" />)).toContain('<h3 class="wc-x-sechead__title" id="a">NEW</h3>');
  });

  it('draws no pill without a destination', () => {
    for (const moreHref of [undefined, null, '']) {
      const html = renderToStaticMarkup(<SectionHeader id="a" moreHref={moreHref} title="NEW" />);
      expect(html).not.toContain('wc-x-pill');
      expect(html).not.toContain('<a ');
    }
  });

  it('appends an extra class to the header', () => {
    expect(renderToStaticMarkup(<SectionHeader className="wc-home__head" id="a" title="NEW" />)).toContain('class="wc-x-sechead wc-home__head"');
  });
});
