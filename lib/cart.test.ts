import { describe, expect, it } from 'vitest';
import {
  cartItemsAfterSignOut,
  cartQuantityTotal,
  normalizeCartItems,
  parseStoredCart,
  serializeCart,
  setCartItemQuantity,
} from './cart';

describe('cart item normalization', () => {
  it('keeps only valid item identities and positive integer quantities', () => {
    expect(normalizeCartItems([
      { goodId: ' g1 ', qty: 2 },
      { goodId: '', qty: 3 },
      { goodId: 'g2', qty: 1.5 },
      { goodId: 'g3', qty: -1 },
      null,
    ])).toEqual([{ goodId: 'g1', qty: 2 }]);
  });

  it('deduplicates the same good with the greatest quantity', () => {
    expect(normalizeCartItems([
      { goodId: 'g1', qty: 2 },
      { goodId: 'g2', qty: 1 },
      { goodId: 'g1', qty: 5 },
      { goodId: 'g2', qty: 1 },
    ])).toEqual([
      { goodId: 'g1', qty: 5 },
      { goodId: 'g2', qty: 1 },
    ]);
  });
});

describe('versioned cart storage', () => {
  it('round-trips only the version and item identity/quantity fields', () => {
    const stored = serializeCart([
      { goodId: 'g1', qty: 2, name: 'tampered' } as never,
    ]);

    expect(JSON.parse(stored)).toEqual({
      version: 1,
      items: [{ goodId: 'g1', qty: 2 }],
    });
    expect(parseStoredCart(stored)).toEqual([{ goodId: 'g1', qty: 2 }]);
  });

  it('rejects malformed JSON and unknown storage versions', () => {
    expect(parseStoredCart('{')).toEqual([]);
    expect(parseStoredCart(JSON.stringify({ version: 2, items: [{ goodId: 'g1', qty: 2 }] }))).toEqual([]);
    expect(parseStoredCart(null)).toEqual([]);
  });
});

describe('cart mutations', () => {
  it('sets, appends, and removes quantities without mutating the input', () => {
    const initial = [{ goodId: 'g1', qty: 1 }];
    const changed = setCartItemQuantity(initial, 'g1', 3);

    expect(changed).toEqual([{ goodId: 'g1', qty: 3 }]);
    expect(initial).toEqual([{ goodId: 'g1', qty: 1 }]);
    expect(setCartItemQuantity(changed, 'g2', 2)).toEqual([
      { goodId: 'g1', qty: 3 },
      { goodId: 'g2', qty: 2 },
    ]);
    expect(setCartItemQuantity(changed, 'g1', 0)).toEqual([]);
  });

  it('sums quantities for the shared badge', () => {
    expect(cartQuantityTotal([{ goodId: 'g1', qty: 3 }, { goodId: 'g2', qty: 2 }])).toBe(5);
  });

  it('clears a server cart on sign-out but preserves an unmerged local cart', () => {
    const localItems = [{ goodId: 'g1', qty: 2 }];

    expect(cartItemsAfterSignOut('server', localItems)).toEqual([]);
    expect(cartItemsAfterSignOut('local', localItems)).toEqual(localItems);
  });
});
