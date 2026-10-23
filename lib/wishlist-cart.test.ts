import { describe, expect, it, vi } from 'vitest';
import type { Good } from './data';
import { addWishGoodToCart, wishCartState } from './wishlist-cart';

const VARIANT = '00000000-0000-4000-8000-0000000006a1';

function good(overrides: Partial<Good> = {}): Good {
  return {
    id: 'g13',
    name: '홍실 아크릴 블록',
    ip: 'hong-sil-quest',
    type: '아크릴',
    price: 12000,
    badge: null,
    stock: 'ok',
    stockQty: 3,
    img: 'none',
    options: [{ id: VARIANT, name: '기본', code: 'G13', price: 12000, stockQty: 3, isDefault: true, attributes: {} }],
    ...overrides,
  } as Good;
}

const READY = { quantityInCart: 0, ready: true, working: false };

describe('wishCartState', () => {
  it('adds one unit of a single-option good', () => {
    expect(wishCartState(good(), READY)).toEqual({
      kind: 'add', variantId: VARIANT, stockQty: 3, label: '장바구니 담기', ariaLabel: '홍실 아크릴 블록 장바구니에 한 개 담기', unavailable: false,
    });
  });

  it('sends goods that need a choice to the detail page like the listing button', () => {
    const twoOptions = good({ options: [...good().options!, { id: '00000000-0000-4000-8000-0000000006a2', name: '블루', code: 'G13-B', price: 12000, stockQty: 1, isDefault: false, attributes: {} }] });
    expect(wishCartState(twoOptions, READY)).toEqual({ kind: 'choose', href: '/shop/g13', label: '옵션 선택', ariaLabel: '홍실 아크릴 블록 옵션 선택' });
    expect(wishCartState(good({ orderQuantityLimitEnabled: true, minOrderQty: 2, maxOrderQty: 5 }), READY)).toMatchObject({ kind: 'choose', label: '수량 선택' });
    expect(wishCartState(good({ customInputs: { enabled: true } as Good['customInputs'] }), READY)).toMatchObject({ kind: 'choose', label: '옵션 선택' });
  });

  it('says why a good cannot be added', () => {
    expect(wishCartState(good({ stock: 'soldout' }), READY)).toMatchObject({ label: '품절', unavailable: true });
    expect(wishCartState(good({ options: [{ ...good().options![0], stockQty: 0 }] }), READY)).toMatchObject({ label: '품절', unavailable: true });
    expect(wishCartState(good({ allowCardPayment: false, allowBankTransfer: false }), READY)).toMatchObject({ label: '판매 준비 중', unavailable: true });
    expect(wishCartState(good(), { ...READY, ready: false })).toMatchObject({ label: '준비 중', unavailable: true });
    expect(wishCartState(good(), { ...READY, working: true })).toMatchObject({ label: '담는 중', unavailable: true });
    expect(wishCartState(good(), { ...READY, quantityInCart: 3 })).toMatchObject({
      label: '담김 · 3', ariaLabel: '홍실 아크릴 블록, 장바구니 3개, 재고 한도 3개', unavailable: true,
    });
  });
});

describe('addWishGoodToCart', () => {
  it('adds exactly one unit through the cart selection contract and reports only a confirmed add', async () => {
    const addSelection = vi.fn(async () => true);
    const onAdded = vi.fn();

    expect(await addWishGoodToCart(addSelection, good(), wishCartState(good(), READY), onAdded)).toBe(true);
    expect(addSelection).toHaveBeenCalledWith('g13', [{ goodId: 'g13', variantId: VARIANT, qty: 1, stockQty: 3 }]);
    expect(onAdded).toHaveBeenCalledWith([{ name: '홍실 아크릴 블록', option: null, quantity: 1 }]);
  });

  /* DESIGN §9 "서버 확인 전 완료 금지" — 카트가 반영을 거절하면 결과 모달을 열지 않는다. */
  it('does not report a rejected add and never calls the cart while unavailable', async () => {
    const rejected = vi.fn(async () => false);
    const onAdded = vi.fn();
    expect(await addWishGoodToCart(rejected, good(), wishCartState(good(), READY), onAdded)).toBe(false);
    expect(onAdded).not.toHaveBeenCalled();

    const untouched = vi.fn(async () => true);
    expect(await addWishGoodToCart(untouched, good(), wishCartState(good({ stock: 'soldout' }), READY), onAdded)).toBe(false);
    expect(await addWishGoodToCart(untouched, good(), wishCartState(good(), { ...READY, quantityInCart: 3 }), onAdded)).toBe(false);
    expect(untouched).not.toHaveBeenCalled();
    expect(onAdded).not.toHaveBeenCalled();
  });
});
