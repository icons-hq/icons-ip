import { describe, expect, it } from 'vitest';
import type { Good, GoodOption } from '@/lib/data';
import type { GoodsVariantSupply } from '@/lib/goods-preorders';
import { productCardChips } from '@/lib/product-card-chips';

type ChipGood = Pick<Good, 'options' | 'optionSaleMode' | 'badge' | 'shippingFeeType'>;

const NOW = '2026-11-17T00:00:00.000Z';

function supply(overrides: Partial<GoodsVariantSupply> = {}): GoodsVariantSupply {
  return {
    mode: 'preorder',
    availableQty: 10,
    policyId: '11111111-1111-4111-8111-111111111111',
    policyRevision: 1,
    state: 'open',
    startsAt: '2026-11-10T00:00:00.000Z',
    endsAt: '2026-12-10T00:00:00.000Z',
    expectedShipDate: '2026-12-20',
    calculatedAt: NOW,
    nextChangeAt: '2026-12-10T00:00:00.000Z',
    ...overrides,
  };
}

function option(overrides: Partial<GoodOption> = {}): GoodOption {
  return { id: 'o1', name: '단일', code: 'single', price: 1000, stockQty: 5, isDefault: true, attributes: {}, ...overrides };
}

function good(overrides: Partial<ChipGood> = {}): ChipGood {
  return { badge: null, ...overrides };
}

describe('productCardChips', () => {
  it('returns no chips for a plain good and for legacy projections without the new fields', () => {
    expect(productCardChips(good())).toEqual([]);
    expect(productCardChips(good({ options: [option()] }))).toEqual([]);
    expect(productCardChips({ badge: null })).toEqual([]);
  });

  describe('preorder', () => {
    it('chips an open preorder with remaining quantity', () => {
      expect(productCardChips(good({ options: [option({ supply: supply() })] }))).toEqual([{ kind: 'preorder', label: '예약판매' }]);
    });

    it('chips when any option is open even if another option is plain stock or sold out', () => {
      const options = [
        option({ id: 'o1', supply: supply({ availableQty: 0 }) }),
        option({ id: 'o2', isDefault: false, supply: supply() }),
      ];
      expect(productCardChips(good({ options })).map((chip) => chip.kind)).toEqual(['preorder']);
    });

    it.each([
      ['scheduled', { state: 'scheduled' as const, availableQty: 0 }],
      ['closed', { state: 'closed' as const, availableQty: 0 }],
      ['stopped', { state: 'stopped' as const, availableQty: 0 }],
      ['open without quantity', { state: 'open' as const, availableQty: 0 }],
    ])('does not chip a preorder that is %s', (_name, overrides) => {
      expect(productCardChips(good({ options: [option({ supply: supply(overrides) })] }))).toEqual([]);
    });

    it('does not chip a plain stock supply', () => {
      const stock = supply({ mode: 'stock', state: 'stock', policyId: null, policyRevision: null, startsAt: null, endsAt: null, expectedShipDate: null, nextChangeAt: null });
      expect(productCardChips(good({ options: [option({ supply: stock })] }))).toEqual([]);
    });
  });

  describe('free shipping', () => {
    it('chips only the free fee type', () => {
      expect(productCardChips(good({ shippingFeeType: 'free' }))).toEqual([{ kind: 'freeShipping', label: '무료배송' }]);
      expect(productCardChips(good({ shippingFeeType: 'policy' }))).toEqual([]);
      expect(productCardChips(good({ shippingFeeType: 'individual' }))).toEqual([]);
    });
  });

  describe('random sale', () => {
    it('chips random sale goods as 캡슐토이 and leaves select goods alone', () => {
      expect(productCardChips(good({ optionSaleMode: 'random' }))).toEqual([{ kind: 'random', label: '캡슐토이' }]);
      expect(productCardChips(good({ optionSaleMode: 'select' }))).toEqual([]);
    });
  });

  describe('operator badge', () => {
    it.each(['NEW', 'EXCLUSIVE'])('passes the stored %s badge through as a tag chip', (badge) => {
      expect(productCardChips(good({ badge }))).toEqual([{ kind: 'tag', label: badge }]);
    });

    it('drops the tag chip when the store presentation hides tags, and keeps it otherwise', () => {
      expect(productCardChips(good({ badge: 'NEW' }), { showTags: false })).toEqual([]);
      expect(productCardChips(good({ badge: 'NEW' }), { showTags: true })).toEqual([{ kind: 'tag', label: 'NEW' }]);
      expect(productCardChips(good({ badge: 'NEW' }), {})).toEqual([{ kind: 'tag', label: 'NEW' }]);
    });

    it('ignores an empty badge', () => {
      expect(productCardChips(good({ badge: '' }))).toEqual([]);
      expect(productCardChips(good({ badge: '  ' }))).toEqual([]);
    });

    it('does not turn the hidden tag setting into a drop of the other chips', () => {
      const chips = productCardChips(good({ badge: 'NEW', shippingFeeType: 'free', optionSaleMode: 'random' }), { showTags: false });
      expect(chips.map((chip) => chip.kind)).toEqual(['freeShipping', 'random']);
    });
  });

  it('orders chips preorder → free shipping → random → tag', () => {
    const chips = productCardChips(good({
      badge: 'EXCLUSIVE',
      shippingFeeType: 'free',
      optionSaleMode: 'random',
      options: [option({ supply: supply() })],
    }));

    expect(chips).toEqual([
      { kind: 'preorder', label: '예약판매' },
      { kind: 'freeShipping', label: '무료배송' },
      { kind: 'random', label: '캡슐토이' },
      { kind: 'tag', label: 'EXCLUSIVE' },
    ]);
  });
});
