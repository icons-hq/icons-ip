import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ProductCollection } from './ProductCollection';
import { ProductCard } from '@/components/wc/ProductCard';
import type { HomeProductCollectionBand } from '@/lib/home-product-collection';

const band: HomeProductCollectionBand = { id: 'collection', title: '선택한 상품', layout: 'full_image', imageShape: 'portrait', goods: [
  { id: 'good', href: '/shop/good', name: '상품 이름', brand: '브랜드', price: 12000, badge: null, soldOut: true, imageBg: 'url("https://cdn.example/good.webp") center / cover no-repeat' },
] };

describe('ProductCollection', () => {
  it('hides the title and whole region when no eligible products remain', () => {
    expect(renderToStaticMarkup(<ProductCollection band={{ ...band, goods: [] }} />)).toBe('');
  });
  it('uses a real primary image and named product links with existing sold-out semantics', () => {
    const html = renderToStaticMarkup(<ProductCollection band={band} />);
    expect(html).toContain('aria-labelledby="home-products-collection-heading"');
    expect(html).toContain('data-layout="full_image" data-image-shape="portrait"');
    expect(html).toContain('class="wc-product-collection__image" src="https://cdn.example/good.webp" alt="" loading="lazy"');
    expect(html).toContain('class="wc-product-card__name-link" href="/shop/good">상품 이름</a>');
    expect(html).toContain('(품절)');
    expect(html).not.toContain('더보기');
  });
  it('keeps the normal card contain contract while collection cropping stays in local selectors', () => {
    const card = band.goods[0];
    const normal = renderToStaticMarkup(<ProductCard name={card.name} href={card.href} price={card.price} imageBackground={card.imageBg} />);
    expect(normal).toContain('/ contain');
    const css = readFileSync(new URL('../../app/styles/wc-product-collection.css', import.meta.url), 'utf8');
    expect(css).toContain('object-fit: cover; object-position: center');
    const selectors = css.split('{').slice(0, -1).map(part => part.slice(part.lastIndexOf('}') + 1).trim()).filter(part => !part.startsWith('@'));
    expect(selectors.every(selector => selector.startsWith('.wc-product-collection'))).toBe(true);
  });
});
