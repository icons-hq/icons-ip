import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CollectionBanner } from '@/lib/collection-banners';
import { CollectionBanners } from './CollectionBanners';

function banner(id: string, overrides: Partial<CollectionBanner> = {}): CollectionBanner {
  return {
    id,
    slot: 'all',
    title: `배너 ${id}`,
    subtitle: null,
    imageUrl: `https://cdn.test/${id}.webp`,
    mobileImageUrl: null,
    href: null,
    imageAlt: '',
    imageDim: 'none',
    textColor: 'black',
    endsAt: null,
    ...overrides,
  };
}

const css = readFileSync(join(process.cwd(), 'app/styles/wc-catalog.css'), 'utf8');

describe('CollectionBanners', () => {
  it('배너가 없으면 아무것도 그리지 않는다 — 빈 띠를 남기지 않는다', () => {
    expect(renderToStaticMarkup(<CollectionBanners banners={[]} slot="all" />)).toBe('');
    expect(renderToStaticMarkup(<CollectionBanners banners={[banner('b', { slot: 'best' })]} slot="new" />)).toBe('');
  });

  it('한 장이면 슬라이더 컨트롤 없이 링크 배너 하나를 그리고, 문구는 이미지 위 텍스트 레이어다', () => {
    const html = renderToStaticMarkup(<CollectionBanners banners={[banner('one', {
      slot: 'best', href: '/shop/best', subtitle: '지금 많이 찾는 굿즈', mobileImageUrl: 'https://cdn.test/one-m.webp', imageAlt: '리락쿠마 키링',
    })]} slot="best" />);

    expect(html).toContain('wc-collection-banners--contained');
    expect(html).toContain('aria-label="BEST 배너"');
    expect(html).not.toContain('aria-roledescription="carousel"');
    expect(html).not.toContain('wc-collection-banners__arrow');
    expect(html).toMatch(/<a class="wc-collection-banner" data-text-color="black" href="\/shop\/best">/);
    expect(html).toContain('<source media="(max-width: 749px)" srcSet="https://cdn.test/one-m.webp"/>');
    expect(html).toMatch(/<img alt="리락쿠마 키링" decoding="async" fetchPriority="high" loading="eager" sizes="100vw" src="https:\/\/cdn.test\/one.webp"\/>/);
    expect(html).toContain('<strong class="wc-collection-banner__title">배너 one</strong>');
    expect(html).toContain('<span class="wc-collection-banner__subtitle">지금 많이 찾는 굿즈</span>');
  });

  it('링크가 없으면 div 이고, 대체텍스트가 없으면 장식 이미지(alt="")다', () => {
    const html = renderToStaticMarkup(<CollectionBanners banners={[banner('plain')]} slot="all" />);

    expect(html).toMatch(/<div class="wc-collection-banner" data-text-color="black">/);
    expect(html).toMatch(/<img alt="" /);
    expect(html).not.toContain('wc-collection-banner__dim');
  });

  it('여러 장이면 수동 캐러셀 — 루프 이전·다음 버튼과 위치 표시, 첫 장만 우선 로드하고 정지 버튼은 없다', () => {
    const html = renderToStaticMarkup(<CollectionBanners banners={[banner('a'), banner('b', { imageDim: 'black', textColor: 'white' }), banner('c')]} slot="all" />);

    expect(html).toContain('wc-collection-banners--wide');
    expect(html).toContain('aria-roledescription="carousel"');
    expect(html.match(/aria-roledescription="slide"/g)).toHaveLength(3);
    expect(html).toContain('aria-label="1 / 3"');
    expect(html).toContain('aria-label="이전 배너"');
    expect(html).toContain('aria-label="다음 배너"');
    expect(html).toMatch(/<p aria-live="off" class="wc-collection-banners__fraction"><span>1<\/span> \/ <span>3<\/span><\/p>/);
    expect(html.match(/fetchPriority="high"/g)).toHaveLength(1);
    expect(html.match(/loading="lazy"/g)).toHaveLength(2);
    expect(html).toContain('<span aria-hidden="true" class="wc-collection-banner__dim" data-tone="black"></span>');
    expect(html).toContain('data-text-color="white"');
    /* 레퍼런스는 자동 넘김이 꺼져 있다 — 움직이지 않으니 정지 버튼을 두지 않는다. */
    expect(html).not.toMatch(/일시정지|자동 넘김/);
  });

  it('카드 리워드가 꺼진 배포에서는 카드팩으로 가는 배너를 걷는다', () => {
    const html = renderToStaticMarkup(<CollectionBanners banners={[banner('packs', { href: '/packs' }), banner('shop', { href: '/shop/new' })]} slot="all" />);

    expect(html).not.toContain('배너 packs');
    expect(html).toContain('배너 shop');
    expect(html).not.toContain('aria-roledescription="carousel"');
  });

  it('CSS: 레퍼런스 수치(전폭 72:29·모바일 375:302, 칸 59:13·15:7, 44×45 버튼, 모바일 위치 알약)와 대비 보정을 둔다', () => {
    expect(css).toMatch(/\.wc-collection-banner \{[^}]*aspect-ratio: 375 \/ 302;/);
    expect(css).toMatch(/\.wc-collection-banners--contained \.wc-collection-banner \{\s*aspect-ratio: 15 \/ 7;/);
    expect(css).toMatch(/\.wc-collection-banners--wide \.wc-collection-banner \{\s*aspect-ratio: 72 \/ 29;/);
    expect(css).toMatch(/\.wc-collection-banners--contained \.wc-collection-banner \{\s*aspect-ratio: 59 \/ 13;/);
    expect(css).toMatch(/\.wc-collection-banners__arrow \{[^}]*width: 44px;[^}]*height: 45px;[^}]*background: rgba\(0, 0, 0, \.45\);/);
    expect(css).toMatch(/\.wc-collection-banners__fraction \{[^}]*background: rgba\(0, 0, 0, \.6\);/);
    expect(css).toMatch(/\.wc-collection--banner \{\s*padding-top: 0;/);
  });
});
