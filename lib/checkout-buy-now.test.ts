import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buyNowReturnPath, directCheckoutLinePayload, parseDirectCheckoutEntries, savePendingBuyNow, takePendingBuyNow } from './checkout-buy-now';

const VARIANT = '00000000-0000-4000-8000-000000000002';
const ADDON = '00000000-0000-4000-8000-000000000003';
const field = '00000000-0000-4000-8000-0000000000f1';
const customInputs = { revision: 1, fields: [{ id: field, name: '각인', value: 'ICONS' }] };

describe('바로구매 줄(ADR-0030)', () => {
  it('본품이 있는 줄만 받고, 같은 굿즈·옵션·직접입력값이 두 번 오면 받지 않는다', () => {
    expect(parseDirectCheckoutEntries('g2', [{ goodId: 'g2', variantId: VARIANT.toUpperCase(), qty: 2, customInputs }, { goodId: 'g3', variantId: ADDON, qty: 1 }]))
      .toEqual([{ goodId: 'g2', variantId: VARIANT, qty: 2, customInputs }, { goodId: 'g3', variantId: ADDON, qty: 1 }]);
    expect(parseDirectCheckoutEntries('g2', [{ goodId: 'g3', variantId: ADDON, qty: 1 }])).toBeNull();
    expect(parseDirectCheckoutEntries('g2', [{ goodId: 'g2', variantId: VARIANT, qty: 1 }, { goodId: 'g2', variantId: VARIANT, qty: 1 }])).toBeNull();
    /* 같은 옵션이라도 직접입력값이 다르면 다른 줄이다. */
    expect(parseDirectCheckoutEntries('g2', [{ goodId: 'g2', variantId: VARIANT, qty: 1 }, { goodId: 'g2', variantId: VARIANT, qty: 1, customInputs }])).toHaveLength(2);
    for (const broken of [[], null, [{ goodId: 'g2', variantId: 'x', qty: 1 }], [{ goodId: 'g2', variantId: VARIANT, qty: 0 }],
      [{ goodId: 'g2', variantId: VARIANT, qty: 1.5 }], [{ goodId: 'g2', variantId: VARIANT, qty: 1, customInputs: { revision: 0, fields: [] } }]]) {
      expect(parseDirectCheckoutEntries('g2', broken)).toBeNull();
    }
  });

  it('DB 초안 줄은 굿즈·옵션·수량·직접입력 개정·값이다', () => {
    expect(directCheckoutLinePayload({ goodId: 'g2', variantId: VARIANT, qty: 2, customInputs }))
      .toEqual({ good_id: 'g2', variant_id: VARIANT, qty: 2, input_revision: 1, input_values: { [field]: 'ICONS' } });
  });

  it('로그인 뒤 돌아올 주소는 굿즈 상세와 고른 옵션뿐이다 — 직접입력값을 싣지 않는다', () => {
    expect(buyNowReturnPath('g2', VARIANT)).toBe(`/shop/g2?variant=${VARIANT}`);
    expect(buyNowReturnPath('g2', null)).toBe('/shop/g2');
  });
});

describe('로그인 전 [구매하기]의 이어서 진행', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('window', { sessionStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    } });
  });
  afterEach(() => vi.unstubAllGlobals());
  const pending = { goodId: 'g2', entries: [{ goodId: 'g2', variantId: VARIANT, qty: 2, customInputs }],
    selection: { variantId: VARIANT, quantity: 2, additions: [], customInputValues: { g2: { [field]: 'ICONS' } } } };

  it('같은 굿즈 상세에서 한 번만 꺼내고, 꺼내면 지운다', () => {
    savePendingBuyNow(pending, 1_000);
    expect(takePendingBuyNow('g3', 2_000)).toBeNull();
    /* 다른 굿즈 상세가 꺼내도 지워진다 — 다른 상세에서 엉뚱하게 이어지지 않는다. */
    expect(store.size).toBe(0);
    savePendingBuyNow(pending, 1_000);
    expect(takePendingBuyNow('g2', 2_000)).toEqual({ ...pending, savedAt: 1_000 });
    expect(takePendingBuyNow('g2', 2_000)).toBeNull();
  });

  it('30분이 지났거나 모양이 틀린 값은 버린다', () => {
    savePendingBuyNow(pending, 0);
    expect(takePendingBuyNow('g2', 31 * 60 * 1000)).toBeNull();
    store.set('icons_buy_now_v1', '{"goodId":"g2","savedAt":0,"entries":[]}');
    expect(takePendingBuyNow('g2', 1)).toBeNull();
    store.set('icons_buy_now_v1', 'not json');
    expect(takePendingBuyNow('g2', 1)).toBeNull();
  });
});
