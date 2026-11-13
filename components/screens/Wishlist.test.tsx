import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { StorePresentationProvider } from '@/components/shell/StorePresentationProvider';
import type { Good } from '@/lib/data';
import { DEFAULT_STORE_PRESENTATION } from '@/lib/store-presentation';
import { Wishlist } from './Wishlist';

vi.mock('next/navigation', () => ({ usePathname: () => '/my/wishlist', useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/app/shop/actions', () => ({ toggleWishlistAction: vi.fn() }));
vi.mock('@/app/ip/actions', () => ({ toggleIpFollowAction: vi.fn() }));
vi.mock('@/app/checkout/draft-actions', () => ({ createDirectCheckoutDraftAction: vi.fn() }));
vi.mock('@/components/shell/CartProvider', () => ({
  useCart: () => ({ items: [], count: 0, ready: true, mode: 'server' as const, pending: false, error: null, getQuantity: () => 0,
    add: vi.fn(), addSelection: vi.fn(), setQuantity: vi.fn(), remove: vi.fn(), refresh: vi.fn(), resetForSignOut: vi.fn() }),
}));

const VARIANT = '00000000-0000-4000-8000-0000000005a1';
const good = (overrides: Partial<Good>): Good => ({ id: 'g13', name: '홍실 아크릴 블록', ip: 'hong-sil-quest', type: '아크릴', price: 12000, badge: null,
  stock: 'ok', stockQty: 20, img: 'none', options: [{ id: VARIANT, name: '기본', code: 'G13', price: 12000, stockQty: 20, isDefault: true, attributes: {} }],
  ...overrides });

function render(goods: Good[]) {
  return renderToStaticMarkup(
    <StorePresentationProvider value={DEFAULT_STORE_PRESENTATION}>
      <Wishlist followedIps={[]} lines={goods.map((item) => ({ goodId: item.id, good: item, brand: '홍실' }))} tab="goods"
        viewerId="00000000-0000-4000-8000-000000000501" />
    </StorePresentationProvider>,
  );
}

/* 1014-039 "얘만 사고 싶어"(ADR-0030): 살 수 있는 위시 카드에는 담기와 함께 [구매하기]가 선다. 누르면 상품 상세와 같은 구매 시트
   (옵션·수량·직접 입력)가 열리고, 시트의 [구매하기]는 그 상품만 주문하는 바로구매다 — 장바구니에 담지 않는다. */
describe('위시 카드 [구매하기]', () => {
  it('살 수 있는 굿즈 카드에 담기 다음으로 구매하기를 두고, 시트는 누르기 전에는 그리지 않는다', () => {
    const html = render([good({}), good({ id: 'g14', name: '홍실 옵션 굿즈', options: [
      { id: '00000000-0000-4000-8000-0000000005b1', name: '레드', code: 'G14-R', price: 9000, stockQty: 4, isDefault: true, attributes: {} },
      { id: '00000000-0000-4000-8000-0000000005b2', name: '블루', code: 'G14-B', price: 9000, stockQty: 4, isDefault: false, attributes: {} }] })]);
    expect(html).toContain('<button aria-expanded="false" aria-haspopup="dialog" aria-label="홍실 아크릴 블록 구매하기" class="wc-btn primary wc-wish__buy"');
    expect(html).toContain('aria-label="홍실 옵션 굿즈 구매하기"');
    expect(html).not.toContain('role="dialog"');
    expect(html.indexOf('홍실 아크릴 블록 장바구니에 한 개 담기')).toBeLessThan(html.indexOf('홍실 아크릴 블록 구매하기'));
  });

  it('품절·판매 기간 밖 굿즈 카드에는 구매하기를 두지 않는다', () => {
    const html = render([good({ stock: 'soldout', stockQty: 0, options: [{ id: VARIANT, name: '기본', code: 'G13', price: 12000, stockQty: 0, isDefault: true, attributes: {} }] })]);
    expect(html).not.toContain('wc-wish__buy');
  });
});
