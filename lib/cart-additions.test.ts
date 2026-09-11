import { describe, expect, it } from 'vitest';
import { prepareCartAddition, parseCartAdditionRequest, parseCartAdditionSnapshot } from './cart-additions';

const base = '00000000-0000-4000-8000-000000000001';
const extra = '00000000-0000-4000-8000-000000000002';
describe('atomic cart additions', () => {
  it('adds the whole selection while capturing each observed quantity for the server comparison', () => {
    expect(prepareCartAddition([{ goodId: 'base', variantId: base, qty: 2 }], [
      { goodId: 'base', variantId: base, qty: 3, stockQty: 8 },
      { goodId: 'extra', variantId: extra, qty: 2, stockQty: 4 },
    ])).toEqual({ ok: true, items: [
      { goodId: 'base', variantId: base, qty: 5 }, { goodId: 'extra', variantId: extra, qty: 2 },
    ], entries: [
      { goodId: 'base', variantId: base, qty: 3, expectedQty: 2 },
      { goodId: 'extra', variantId: extra, qty: 2, expectedQty: 0 },
    ] });
  });
  it('fails the whole addition when the extra item is over stock instead of retaining the base item', () => {
    const current = [{ goodId: 'base', variantId: base, qty: 2 }];
    expect(prepareCartAddition(current, [
      { goodId: 'base', variantId: base, qty: 1, stockQty: 8 },
      { goodId: 'extra', variantId: extra, qty: 3, stockQty: 2 },
    ])).toEqual({ ok: false, reason: 'stock' });
    expect(current).toEqual([{ goodId: 'base', variantId: base, qty: 2 }]);
  });
  it('aggregates repeated option quantities before checking stock and rejects integer overflow', () => {
    expect(prepareCartAddition([], [
      { goodId: 'base', variantId: base, qty: 2, stockQty: 3 },
      { goodId: 'base', variantId: base, qty: 2, stockQty: 3 },
    ])).toEqual({ ok: false, reason: 'stock' });
    expect(prepareCartAddition([], [{ goodId: 'base', variantId: base, qty: 2147483648, stockQty: 2147483648 }]))
      .toEqual({ ok: false, reason: 'input' });
  });
  it('does not silently remove malformed lines or accept a mismatching option owner', () => {
    expect(parseCartAdditionRequest([{ goodId: 'base', variantId: base, qty: 1, expectedQty: 0 },
      { goodId: 'extra', variantId: 'invalid', qty: 1, expectedQty: 0 }])).toBeNull();
    expect(prepareCartAddition([], [
      { goodId: 'base', variantId: base, qty: 1, stockQty: 2 },
      { goodId: 'extra', variantId: base, qty: 1, stockQty: 2 },
    ])).toEqual({ ok: false, reason: 'input' });
    expect(parseCartAdditionSnapshot([{ goodId: 'base', variantId: base, qty: 1 }, { goodId: 'extra', qty: 2 }])).toBeNull();
  });
});
