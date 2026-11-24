import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import type { HomeGoodsBand, HomeGoodsCard } from '@/lib/home-catalog';
import { IconsPick } from './IconsPick';

const good = (id: string, overrides: Partial<HomeGoodsCard> = {}): HomeGoodsCard => ({
  id, name: `상품 ${id}`, brand: '메이플스토리', price: 15200, badge: null, imageBg: 'linear-gradient(#111, #222)',
  href: `/shop/${id}`, soldOut: false, ...overrides,
});

const band = (id: string, overrides: Partial<HomeGoodsBand> = {}): HomeGoodsBand => ({
  id, title: `기획전 ${id}`, subcopy: '부제 문구', imageUrl: `https://cdn.example/${id}.webp`, href: `/events/${id}`,
  goods: [good(`${id}-1`), good(`${id}-2`), good(`${id}-3`)], ...overrides,
});

const noHeart = () => null;
const heart = (item: Pick<HomeGoodsCard, 'id' | 'name'>, className?: string): ReactNode => <button className={`wc-list-heart ${className ?? ''}`} type="button">{item.name}</button>;

describe('IconsPick', () => {
  it('draws nothing without bands', () => {
    expect(renderToStaticMarkup(<IconsPick bands={[]} heartFor={noHeart} />)).toBe('');
  });

  it('is one X SQUARE PICK section named by its first band, with one card per band', () => {
    const html = renderToStaticMarkup(<IconsPick bands={[band('a'), band('b'), band('c')]} heartFor={noHeart} />);

    expect(html).toContain('aria-labelledby="home-icons-pick-a-heading"');
    expect(html).toContain('<h2 class="wc-x-sechead__title" id="home-icons-pick-a-heading">X SQUARE PICK</h2>');
    expect(html).not.toContain('wc-x-pill');
    expect((html.match(/<article class="wc-x-pick">/g) ?? []).length).toBe(3);
    expect(html).toContain('<ul class="wc-x-pick-grid">');
  });

  /* 카드 = 프로모션 카드(배너 이미지 + 제목 h3, 링크는 배너 목적지) + 상품 앞 2개. 부제는 그리지 않는다. */
  it('stacks the promo card over the first two products and drops the subcopy', () => {
    const html = renderToStaticMarkup(<IconsPick bands={[band('a')]} heartFor={noHeart} />);

    expect(html).toContain('<a class="wc-promo-card wc-x-pick__promo" href="/events/a">');
    expect(html).toContain('<h3 class="wc-promo-card__title">기획전 a</h3>');
    expect(html).toContain('background:url(&quot;https://cdn.example/a.webp&quot;) center / cover no-repeat');
    expect(html.indexOf('wc-promo-card')).toBeLessThan(html.indexOf('wc-x-pick__goods'));
    expect((html.match(/class="wc-x-pick__row"/g) ?? []).length).toBe(2);
    expect(html).toContain('href="/shop/a-1"');
    expect(html).toContain('href="/shop/a-2"');
    expect(html).not.toContain('href="/shop/a-3"');
    expect(html).not.toContain('부제 문구');
  });

  it('shows brand, name and price on each row and a status label next to the price when unavailable', () => {
    const html = renderToStaticMarkup(<IconsPick bands={[band('a', { goods: [good('x'), good('y', { brand: null, soldOut: true })] })]} heartFor={noHeart} />);
    const [first, second] = [...html.matchAll(/<a\b[^>]*wc-x-pick__link[^>]*>[\s\S]*?<\/a>/g)].map((match) => match[0]);

    expect(first).toContain('<span class="wc-x-pick__brand">메이플스토리</span>');
    expect(first).toContain('<span class="wc-x-pick__name">상품 x</span>');
    expect(first).toContain('₩15,200');
    expect(first).not.toContain('wc-x-pick__unavailable');
    expect(second).not.toContain('wc-x-pick__brand');
    expect(second).toContain('<span class="wc-x-pick__unavailable">품절</span>');
  });

  /* 행의 링크와 하트는 서로 형제다 — 링크 안의 버튼은 마크업으로도 잘못됐고 클릭 한 번이 상세 이동까지 일으킨다. */
  it('places each heart beside the row link, never inside it', () => {
    const html = renderToStaticMarkup(<IconsPick bands={[band('a')]} heartFor={heart} />);
    const rows = [...html.matchAll(/<li class="wc-x-pick__row">([\s\S]*?)<\/button><\/li>/g)].map((match) => match[1]);

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.match(/<a\b[^>]*wc-x-pick__link[^>]*>[\s\S]*?<\/a>/)?.[0]).not.toContain('<button');
      expect(row).toContain('wc-list-heart wc-x-pick__heart');
    }
  });

  it('draws only the promo card for a band without products', () => {
    const html = renderToStaticMarkup(<IconsPick bands={[band('a', { goods: [] })]} heartFor={noHeart} />);

    expect(html).toContain('wc-promo-card');
    expect(html).not.toContain('wc-x-pick__goods');
  });
});
