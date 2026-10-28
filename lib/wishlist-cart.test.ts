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
    /* 다른 카드의 담기로 카트가 바쁜 동안에는 담지 못하지만 '담는 중'은 누른 카드에만 보인다. */
    expect(wishCartState(good(), { ...READY, pending: true })).toMatchObject({ label: '장바구니 담기', unavailable: true });
    expect(wishCartState(good(), { ...READY, quantityInCart: 3 })).toMatchObject({
      label: '장바구니 · 3', ariaLabel: '홍실 아크릴 블록, 장바구니 3개, 재고 한도 3개', unavailable: true,
    });
  });

  /* L6 QA l6-qa-1: 판매 기간 밖 굿즈는 고를 옵션이 없어 품절 조건도 참이 되지만, 카드 위 표시·목록 담기 버튼·
     굿즈 상세처럼 판매 기간 문구를 먼저 말한다 — 버튼만 '품절'(재고 소진)로 부르면 같은 카드 안에서 모순된다. */
  it('names the sale period before sold-out when a good is outside its sale window', () => {
    const calculatedAt = '2026-10-26T00:00:00.000Z';
    const scheduled = { startsAt: '2026-10-29T00:00:00.000Z', endsAt: '2026-11-25T00:00:00.000Z', state: 'scheduled', calculatedAt, nextChangeAt: '2026-10-29T00:00:00.000Z' } as const;
    const ended = { startsAt: '2026-10-16T00:00:00.000Z', endsAt: '2026-10-25T00:00:00.000Z', state: 'ended', calculatedAt, nextChangeAt: null } as const;
    const noOption = { options: [], stock: 'soldout' as const, stockQty: 0 };

    expect(wishCartState(good({ ...noOption, salePeriod: scheduled }), READY)).toEqual({
      kind: 'add', variantId: null, stockQty: 0, label: '판매 시작 전', ariaLabel: '홍실 아크릴 블록 판매 시작 전', unavailable: true,
    });
    expect(wishCartState(good({ ...noOption, salePeriod: ended }), READY)).toEqual({
      kind: 'add', variantId: null, stockQty: 0, label: '판매 종료', ariaLabel: '홍실 아크릴 블록 판매 종료', unavailable: true,
    });
    /* 옵션이 남아 있어도(재고 있음) 판매 기간 밖이면 같은 문구로 막는다. */
    expect(wishCartState(good({ salePeriod: scheduled }), READY)).toMatchObject({ label: '판매 시작 전', ariaLabel: '홍실 아크릴 블록 판매 시작 전', unavailable: true });
    /* 판매 기간 안이면 품절은 그대로 품절이다. */
    const open = { ...scheduled, startsAt: '2026-10-20T00:00:00.000Z', state: 'open', nextChangeAt: scheduled.endsAt } as const;
    expect(wishCartState(good({ ...noOption, salePeriod: open }), READY)).toMatchObject({ label: '품절', ariaLabel: '홍실 아크릴 블록 품절', unavailable: true });
  });
});

/* D7② 옵션별 주문당 최대 수량 — 목록 담기 버튼과 같은 한도에서 멈춘다. D5② 랜덤 판매는 카탈로그가 접은 옵션 하나라 바로 담는다. */
describe('wishCartState 옵션별 구매 제한·랜덤 판매', () => {
  it('옵션별 주문당 최대 수량까지 담으면 더 담지 않는다', () => {
    const limited = good({ stockQty: 9, options: [{ id: VARIANT, name: '기본', code: 'G13', price: 12000, stockQty: 9, isDefault: true, attributes: {}, orderMaxQty: 2 }] });
    expect(wishCartState(limited, { ...READY, quantityInCart: 2 })).toMatchObject({ kind: 'add', unavailable: true,
      label: '장바구니 · 2', ariaLabel: '홍실 아크릴 블록, 장바구니 2개, 구매 한도 2개' });
    expect(wishCartState(limited, { ...READY, quantityInCart: 1 })).toMatchObject({ kind: 'add', unavailable: false, stockQty: 9 });
  });
  it('랜덤 판매 굿즈는 접힌 기본 옵션 키로 바로 담는다', () => {
    const random = good({ optionSaleMode: 'random', stockQty: 6,
      options: [{ id: VARIANT, name: '랜덤', code: '', price: 12000, stockQty: 6, isDefault: true, attributes: {}, orderMaxQty: null, memberMaxQty: null }] });
    expect(wishCartState(random, READY)).toMatchObject({ kind: 'add', variantId: VARIANT, stockQty: 6, unavailable: false });
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
