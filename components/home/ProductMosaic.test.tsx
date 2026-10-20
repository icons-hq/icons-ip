import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProductMosaic } from './ProductMosaic';
import type { HomeMosaicBand } from '@/lib/home-mosaic';
const empty: HomeMosaicBand = { id: 'demo', title: '기획 모음', heading: '큰 이미지', subtitle: '상품을 살펴보세요', tiles: Array(8).fill(null) };
describe('ProductMosaic', () => {
  it('preserves browse links while explaining a sale period instead of a stock outage', () => {
    const tiles = [...empty.tiles]; tiles[0] = { good: { id: 'g1', name: '검수 상품', href: '/shop/g1', brand: null, price: 1000, badge: null, imageBg: '', soldOut: true, salePeriod: { state: 'ended', startsAt: '2026-10-12T00:00:00Z', endsAt: '2026-10-13T00:00:00Z', calculatedAt: '2026-10-14T00:00:00Z', nextChangeAt: null } }, imageUrl: '/mosaic.png' };
    const html = renderToStaticMarkup(<ProductMosaic band={{ ...empty, tiles }} />); expect(html).toContain('검수 상품 · 판매 종료'); expect(html).toContain('<strong>판매 종료</strong>'); expect(html).toContain('href="/shop/g1"'); expect(html).not.toContain('품절');
  });
  it('hides a fully unavailable module', () => { expect(renderToStaticMarkup(<ProductMosaic band={empty} />)).toBe(''); });
  it('renders only valid targets while preserving fixed blank positions and accessible sold-out copy', () => {
    const tiles = [...empty.tiles]; tiles[7] = { good: { id: 'g1', name: '검수 상품', href: '/shop/qa-good', brand: null, price: 1000, badge: null, imageBg: '', soldOut: true }, imageUrl: '/mosaic.png' };
    const html = renderToStaticMarkup(<ProductMosaic band={{ ...empty, tiles }} />);
    expect(html.match(/data-slot=/g)).toHaveLength(8); expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('검수 상품 · 품절'); expect(html).toContain('href="/shop/qa-good"');
    expect(html).toContain('가로로 스크롤'); expect(html).toContain('data-slot="8" data-empty="false"');
  });
});
