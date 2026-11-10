import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/components/shell/CartProvider', () => ({ useCart: () => ({ getQuantity: () => 0, pending: false, ready: true, add: vi.fn() }) }));
import { ProductCard } from './ProductCard';
import { StorePresentationProvider } from '@/components/shell/StorePresentationProvider';
import { DEFAULT_STORE_PRESENTATION } from '@/lib/store-presentation';
import type { Good } from '@/lib/data';
const good: Good = { id: 'good', ip: 'ip', name: '실제 상품', price: 1000, badge: 'NEW', type: '문구', stock: 'ok', stockQty: 5, img: 'url("/a.webp") center/cover',
  options: [{ id: 'option', name: '단일', code: 'single', price: 1000, stockQty: 5, isDefault: true, attributes: {} }],
  listingAppearance: { gallery: ['url("/b.webp") center/cover'], colors: [{ label: '검정', hex: '#000000' }], description: '<script>상품 텍스트</script>' } };
function render(surface: 'standard' | 'best' | 'story' | 'preview') {
  return renderToStaticMarkup(<StorePresentationProvider value={{ ...DEFAULT_STORE_PRESENTATION, listing: { imageShape: 'portrait', imageMode: 'gallery', showColors: true, showDescription: true, showCart: true, showTags: false } }}>
    <div className="wc-root"><ProductCard href="/shop/good" name={good.name} price={good.price} badges={['NEW', 'BEST', 'SALE']} listSurface={surface} cartGood={good} listingAppearance={good.listingAppearance} imageBackground={good.img} /></div>
  </StorePresentationProvider>);
}
describe('public listing policy consumption', () => {
  it('renders safe descriptions, explicit colors and a separate accessible gallery', () => {
    const html = render('standard');
    expect(html).toContain('data-list-shape="portrait"'); expect(html).toContain('1 / 2'); expect(html).toContain('검정');
    expect(html).not.toContain('>NEW<'); expect(html).not.toContain('>BEST<'); expect(html).toContain('>SALE<');
    expect(html).toContain('&lt;script&gt;상품 텍스트&lt;/script&gt;'); expect(html).not.toContain('<script>상품');
    for (const link of html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/g)) expect(link[1]).not.toContain('<button');
    expect(html).toContain('장바구니에 한 개 담기');
  });
  it('excludes cart actions on BEST/story and leaves editor/home previews untouched', () => {
    expect(render('best')).not.toContain('shop-cart-button'); expect(render('story')).not.toContain('shop-cart-button');
    const preview = render('preview'); expect(preview).not.toContain('data-list-shape'); expect(preview).not.toContain('wc-product-card__gallery'); expect(preview).toContain('>NEW<');
  });
});
