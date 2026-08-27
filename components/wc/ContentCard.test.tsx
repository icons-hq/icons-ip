import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ContentCard } from './ContentCard';

const card = {
  href: '/events/summer-drop',
  title: '여름 드랍 기획전',
};

describe('ContentCard', () => {
  it('wraps the whole card in a single link that carries the title', () => {
    const html = renderToStaticMarkup(<ContentCard {...card} />);

    const links = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
    expect(links).toHaveLength(1);
    expect(links[0][1]).toContain('href="/events/summer-drop"');
    expect(links[0][1]).toContain('class="wc-content-card__link"');
    /* 링크 안에 읽을 텍스트가 없으면 접근 가능한 이름이 빈 문자열이 된다(WCAG 2.4.4). */
    expect(links[0][2]).toContain('여름 드랍 기획전');
  });

  /* 썸네일은 읽을 것이 없는 장식이다. 접근성 트리에 남기면 이름 없는 노드가 카드마다 하나씩 쌓인다. */
  it('hides the decorative thumbnail from the accessibility tree', () => {
    const html = renderToStaticMarkup(<ContentCard {...card} imageBg="linear-gradient(#111, #222)" />);

    const media = html.match(/<div\b([^>]*wc-content-card__media[^>]*)>/)?.[0] ?? '';
    expect(media).toContain('aria-hidden="true"');
    expect(html).toContain('style="background:linear-gradient(#111, #222)"');
  });

  /* 배지는 이미지 위 오버레이가 아니라 텍스트 영역 첫 줄이다(R-스펙 02 §2 ②). */
  it('renders the badge above the title as a shared Badge primitive', () => {
    const html = renderToStaticMarkup(<ContentCard {...card} badge="NEW" />);

    expect(html).toContain('<span class="wc-badge">NEW</span>');
    expect(html.indexOf('wc-badge')).toBeLessThan(html.indexOf('wc-content-card__title'));
  });

  it('renders the description under the title', () => {
    const html = renderToStaticMarkup(<ContentCard {...card} description="8월 한정 컬렉션" />);

    expect(html).toContain('<p class="wc-content-card__desc">8월 한정 컬렉션</p>');
    expect(html.indexOf('wc-content-card__title')).toBeLessThan(html.indexOf('wc-content-card__desc'));
  });

  /* 배지·설명은 큐레이션에서 null 로 올 수 있다 — 빈 칩이나 빈 문단을 남기면 안 된다. */
  it('drops the badge and the description when the curation leaves them empty', () => {
    const html = renderToStaticMarkup(<ContentCard {...card} badge={null} description={null} />);

    expect(html).not.toContain('wc-badge');
    expect(html).not.toContain('wc-content-card__desc');
    expect(html).toContain('wc-content-card__title');
  });

  it('appends an extra class without dropping the base class', () => {
    const html = renderToStaticMarkup(<ContentCard {...card} className="wc-picks__card" />);

    expect(html).toContain('class="wc-content-card wc-picks__card"');
  });
});
