import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ProductCollection } from './ProductCollection';
import { ProductCard } from '@/components/wc/ProductCard';
import type { HomeProductCollectionBand } from '@/lib/home-product-collection';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/app/shop/actions', () => ({ toggleWishlistAction: vi.fn() }));

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
  /* 홈 자유상품 카드에도 목록 하트(11 CL-01) — 미리보기처럼 위시 상태가 없으면 하트를 그리지 않는다. */
  it('adds the listing heart to each card only when the wish set is passed', () => {
    const html = renderToStaticMarkup(<ProductCollection band={band} wishlist={{ viewerId: 'viewer-1', goodIds: ['good'] }} />);

    expect(html).toContain('aria-label="상품 이름 위시리스트에서 빼기"');
    expect(renderToStaticMarkup(<ProductCollection band={band} />)).not.toContain('wc-list-heart');
  });

  it('shows server chips on list and full-image cards too, without the old badge text', () => {
    const chipped = { ...band, goods: [{ ...band.goods[0], badge: 'NEW', chips: [{ kind: 'preorder' as const, label: '예약판매' }, { kind: 'tag' as const, label: 'NEW' }] }] };
    const html = renderToStaticMarkup(<ProductCollection band={chipped} />);

    expect(html).toContain('<span class="wc-x-chip wc-x-chip--preorder">예약판매</span>');
    expect(html).toContain('<span class="wc-x-chip wc-x-chip--tag">NEW</span>');
  });
});

/* X SQUARE 'IP 상품 섹션' — 그리드형은 NEW ARRIVAL 과 같은 5열 카드 그리드에 섹션 제목 + 전체보기 알약이다. */
describe('ProductCollection grid layout', () => {
  const goods = ['g1', 'g2', 'g3', 'g4', 'g5'].map((id) => ({
    id, href: `/shop/${id}`, name: `상품 ${id}`, brand: '홍실퀘스트', price: 15000, badge: null, soldOut: false,
    imageBg: 'url("https://cdn.example/g.webp") center / cover no-repeat',
    chips: [{ kind: 'freeShipping' as const, label: '무료배송' }],
  }));
  const grid: HomeProductCollectionBand = { id: 'hsq', title: '홍실퀘스트', layout: 'grid', imageShape: 'square', goods, moreHref: '/ip/hong-sil-quest' };

  it('draws a section header and the home product grid, one card per product, inside the wide container', () => {
    const html = renderToStaticMarkup(<ProductCollection band={grid} />);

    expect(html).toContain('aria-labelledby="home-products-hsq-heading"');
    expect(html).toContain('data-layout="grid" data-image-shape="square"');
    expect(html).toContain('<h2 class="wc-x-sechead__title" id="home-products-hsq-heading">홍실퀘스트</h2>');
    expect(html).toContain('<ul class="wc-x-grid" data-density="home">');
    expect((html.match(/<li><article class="wc-product-card"/g) ?? []).length).toBe(5);
    expect(html).toContain('class="wc-container wc-container--wide"');
    expect(html).toContain('<span class="wc-x-chip wc-x-chip--freeShipping">무료배송</span>');
  });

  /* 이미지는 정사각 카드 기본 모양 그대로다 — 목록·풀이미지의 잘라 내기(cover) 이미지가 아니다. */
  it('keeps the normal contain card image instead of the cropped collection image', () => {
    const html = renderToStaticMarkup(<ProductCollection band={grid} />);

    expect(html).toContain('/ contain');
    expect(html).not.toContain('wc-product-collection__image');
    expect(html).not.toContain('wc-product-collection__grid');
  });

  /* 링크는 어드민이 고르지 않는다 — 고른 상품이 모두 한 IP일 때만 그 IP관으로 이어진다. */
  it('draws the 전체보기 pill only when the band carries a destination', () => {
    expect(renderToStaticMarkup(<ProductCollection band={grid} />)).toContain('aria-label="홍실퀘스트 전체보기" class="wc-x-pill" href="/ip/hong-sil-quest"');
    expect(renderToStaticMarkup(<ProductCollection band={{ ...grid, moreHref: null }} />)).not.toContain('wc-x-pill');
    expect(renderToStaticMarkup(<ProductCollection band={{ ...grid, moreHref: undefined }} />)).not.toContain('wc-x-pill');
  });

  it('adds the listing heart to each grid card only when the wish set is passed', () => {
    const wishlist = { viewerId: 'viewer-1', goodIds: ['g1'] };

    const html = renderToStaticMarkup(<ProductCollection band={grid} wishlist={wishlist} />);
    expect((html.match(/class="wc-list-heart[ "]/g) ?? []).length).toBe(5);
    expect(html).toContain('aria-label="상품 g1 위시리스트에서 빼기"');
    expect(renderToStaticMarkup(<ProductCollection band={grid} />)).not.toContain('wc-list-heart');
  });

  it('hides the whole section when no eligible products remain', () => {
    expect(renderToStaticMarkup(<ProductCollection band={{ ...grid, goods: [] }} />)).toBe('');
  });
});
