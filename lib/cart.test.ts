import { describe, expect, it } from 'vitest';
const DEFAULT_VARIANT = '00000000-0000-4000-8000-000000000001';
import {
  cartItemsAfterSignOut,
  cartQuantityTotal,
  canonicalizeStoredCartItems,
  normalizeCartItems,
  parseStoredCart,
  serializeCart,
  setCartItemQuantity,
} from './cart';

describe('cart item normalization', () => {
  it('keeps only valid item identities and positive integer quantities', () => {
    expect(normalizeCartItems([
      { goodId: ' g1 ', variantId: DEFAULT_VARIANT, qty: 2 },
      { goodId: '', qty: 3 },
      { goodId: 'g2', variantId: DEFAULT_VARIANT, qty: 1.5 },
      { goodId: 'g3', qty: -1 },
      null,
    ])).toEqual([{ goodId: 'g1', variantId: DEFAULT_VARIANT, qty: 2 }]);
  });

  it('deduplicates the same good with the greatest quantity', () => {
    expect(normalizeCartItems([
      { goodId: 'g1', variantId: DEFAULT_VARIANT, qty: 2 },
      { goodId: 'g2', variantId: DEFAULT_VARIANT, qty: 1 },
      { goodId: 'g1', variantId: DEFAULT_VARIANT, qty: 5 },
      { goodId: 'g2', variantId: DEFAULT_VARIANT, qty: 1 },
    ])).toEqual([
      { goodId: 'g1', variantId: DEFAULT_VARIANT, qty: 5 },
      { goodId: 'g2', variantId: DEFAULT_VARIANT, qty: 1 },
    ]);
  });
});

describe('versioned cart storage', () => {
  it('round-trips only the version and item identity/quantity fields', () => {
    const stored = serializeCart([
      { goodId: 'g1', variantId: DEFAULT_VARIANT, qty: 2, name: 'tampered' } as never,
    ]);

    expect(JSON.parse(stored)).toEqual({
      version: 2,
      items: [{ goodId: 'g1', variantId: DEFAULT_VARIANT, qty: 2 }],
    });
    expect(parseStoredCart(stored)).toEqual([{ goodId: 'g1', variantId: DEFAULT_VARIANT, qty: 2 }]);
  });

  it('rejects malformed JSON and unknown storage versions', () => {
    expect(parseStoredCart('{')).toEqual([]);
    expect(parseStoredCart(JSON.stringify({ version: 3, items: [{ goodId: 'g1', variantId: DEFAULT_VARIANT, qty: 2 }] }))).toEqual([]);
    expect(parseStoredCart(null)).toEqual([]);
  });
});

describe('cart mutations', () => {
  it('sets, appends, and removes quantities without mutating the input', () => {
    const initial = [{ goodId: 'g1', variantId: DEFAULT_VARIANT, qty: 1 }];
    const changed = setCartItemQuantity(initial, 'g1', 3, DEFAULT_VARIANT);

    expect(changed).toEqual([{ goodId: 'g1', variantId: DEFAULT_VARIANT, qty: 3 }]);
    expect(initial).toEqual([{ goodId: 'g1', variantId: DEFAULT_VARIANT, qty: 1 }]);
    expect(setCartItemQuantity(changed, 'g2', 2, DEFAULT_VARIANT)).toEqual([
      { goodId: 'g1', variantId: DEFAULT_VARIANT, qty: 3 },
      { goodId: 'g2', variantId: DEFAULT_VARIANT, qty: 2 },
    ]);
    expect(setCartItemQuantity(changed, 'g1', 0, DEFAULT_VARIANT)).toEqual([]);
  });

  it('sums quantities for the shared badge', () => {
    expect(cartQuantityTotal([{ goodId: 'g1', variantId: DEFAULT_VARIANT, qty: 3 }, { goodId: 'g2', variantId: DEFAULT_VARIANT, qty: 2 }])).toBe(5);
  });

  it('clears a server cart on sign-out but preserves an unmerged local cart', () => {
    const localItems = [{ goodId: 'g1', variantId: DEFAULT_VARIANT, qty: 2 }];

    expect(cartItemsAfterSignOut('server', localItems)).toEqual([]);
    expect(cartItemsAfterSignOut('local', localItems)).toEqual(localItems);
  });
});

describe('옵션별 장바구니 계약 (#439)',()=>{
  const blue='00000000-0000-4000-8000-000000000001';
  const red='00000000-0000-4000-8000-000000000002';
  it('같은 상품의 서로 다른 옵션을 독립 행으로 유지한다',()=>{
    expect(normalizeCartItems([{goodId:'goods',variantId:blue,qty:2},{goodId:'goods',variantId:red,qty:3},{goodId:'goods',variantId:blue,qty:1}]))
      .toEqual([{goodId:'goods',variantId:blue,qty:2},{goodId:'goods',variantId:red,qty:3}]);
  });
  it('지정한 옵션만 수량을 바꾸거나 지운다',()=>{
    const items=[{goodId:'goods',variantId:blue,qty:2},{goodId:'goods',variantId:red,qty:3}];
    expect(setCartItemQuantity(items,'goods',4,blue)).toEqual([{...items[0],qty:4},items[1]]);
    expect(setCartItemQuantity(items,'goods',0,red)).toEqual([items[0]]);
  });
  it('이전 v1 저장본은 기본 옵션 해석을 위해 보존하고 v2는 옵션 식별자를 보존한다',()=>{
    expect(parseStoredCart(JSON.stringify({version:1,items:[{goodId:'goods',qty:2}]}))).toEqual([{goodId:'goods',qty:2}]);
    const items=[{goodId:'goods',variantId:blue,qty:2}];
    expect(JSON.parse(serializeCart(items)).version).toBe(2);expect(parseStoredCart(serializeCart(items))).toEqual(items);
  });
  it('잘못된 옵션 식별자를 기본 옵션으로 조용히 바꾸지 않는다',()=>{
    expect(normalizeCartItems([{goodId:'goods',variantId:'bad',qty:2}])).toEqual([]);
  });
});

describe('옵션 필수 계약과 이전 장바구니 이관 (#443)', () => {
  const variantId = '00000000-0000-4000-8000-000000000001';
  it('이전 기본 옵션 수량과 명시된 동일 옵션 수량을 합쳐 보존한다', () => {
    expect(canonicalizeStoredCartItems([{ goodId: 'g1', qty: 2 }, { goodId: 'g1', variantId, qty: 3 }], new Map([['g1', variantId]])))
      .toEqual({ ok: true, items: [{ goodId: 'g1', variantId, qty: 5 }] });
  });
  it('공개 기본 옵션을 확인하지 못하면 원래 항목을 삭제하지 않고 이관을 실패시킨다', () => {
    expect(canonicalizeStoredCartItems([{ goodId: 'g1', qty: 2 }], new Map())).toEqual({ ok: false, unresolved: [{ goodId: 'g1', qty: 2 }] });
  });
  it('현재 카트와 수량 변경은 옵션 식별자가 없으면 받아들이지 않는다', () => {
    expect(normalizeCartItems([{ goodId: 'g1', qty: 2 }])).toEqual([]);
    expect(setCartItemQuantity([], 'g1', 2, undefined as never)).toEqual([]);
  });
});
