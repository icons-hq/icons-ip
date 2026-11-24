import { describe, expect, it } from 'vitest';
import type { Good, GoodOption } from '@/lib/data';
import type { GoodsVariantSupply } from '@/lib/goods-preorders';
import { productCardChips, productCardUnavailableLabel } from '@/lib/product-card-chips';

type ChipGood = Pick<Good, 'options' | 'optionSaleMode' | 'badge' | 'badges' | 'shippingFeeType'>;

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

    /* 상품 표시문구 여러 개(migration 20261125140000): 운영자가 고른 순서대로 칩 하나씩, 같은 값은 한 번만. */
    it('chips every stored badge in the order the operator chose, once each', () => {
      expect(productCardChips(good({ badge: 'EXCLUSIVE', badges: ['EXCLUSIVE', 'NEW'] }))).toEqual([
        { kind: 'tag', label: 'EXCLUSIVE' },
        { kind: 'tag', label: 'NEW' },
      ]);
      expect(productCardChips(good({ badge: 'NEW', badges: ['NEW', 'new', ' '] }))).toEqual([{ kind: 'tag', label: 'NEW' }]);
      /* 빈 목록은 첫 값 거울이 남아 있어도 표시문구 없음이다(목록이 진실원). */
      expect(productCardChips(good({ badge: 'NEW', badges: [] }))).toEqual([]);
    });

    it('drops every badge chip when the store presentation hides tags', () => {
      expect(productCardChips(good({ badge: 'EXCLUSIVE', badges: ['EXCLUSIVE', 'NEW'], shippingFeeType: 'free' }), { showTags: false }))
        .toEqual([{ kind: 'freeShipping', label: '무료배송' }]);
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

/* 카드 판매 불가 문구는 상세 구매 패널과 같은 판정이다 — 접수 예정 예약판매는 재고 0이어도 'SOLD OUT'(null)이 아니다. */
describe('productCardUnavailableLabel', () => {
  const stockSupply = (availableQty: number) => supply({ mode: 'stock', state: 'stock', availableQty, policyId: null, policyRevision: null,
    startsAt: null, endsAt: null, expectedShipDate: null, nextChangeAt: null });
  const scheduled = supply({ state: 'scheduled', availableQty: 0, startsAt: '2026-12-02T02:00:00.000Z', endsAt: '2026-12-13T14:59:59.000Z',
    expectedShipDate: '2026-12-14', nextChangeAt: '2026-12-02T02:00:00.000Z' });

  it('labels a preorder whose reception has not opened yet instead of reading it as sold out', () => {
    expect(productCardUnavailableLabel({ options: [option({ stockQty: 0, supply: scheduled })] }, true)).toBe('예약 접수 예정');
    expect(productCardUnavailableLabel({ options: [
      option({ id: 'o1', stockQty: 0, supply: scheduled }),
      option({ id: 'o2', isDefault: false, stockQty: 0, supply: scheduled }),
    ] }, true)).toBe('예약 접수 예정');
  });

  it('leaves an open preorder with quantity to the 예약판매 chip, without any unavailable label', () => {
    const open = { options: [option({ stockQty: 10, supply: supply() })] };
    expect(productCardUnavailableLabel(open, false)).toBeNull();
    expect(productCardChips(good(open))).toEqual([{ kind: 'preorder', label: '예약판매' }]);
  });

  it.each([
    ['open without quantity', { state: 'open' as const, availableQty: 0 }, '예약 물량 마감'],
    ['closed', { state: 'closed' as const, availableQty: 0, endsAt: '2026-11-16T00:00:00.000Z', startsAt: '2026-11-01T00:00:00.000Z', nextChangeAt: null }, '예약 접수 종료'],
    ['stopped', { state: 'stopped' as const, availableQty: 0 }, '예약 접수 중지'],
  ])('labels a preorder that is %s', (_name, overrides, label) => {
    expect(productCardUnavailableLabel({ options: [option({ stockQty: 0, supply: supply(overrides) })] }, true)).toBe(label);
  });

  it('returns null for a really sold-out stock good, so the card keeps SOLD OUT', () => {
    expect(productCardUnavailableLabel({ options: [option({ stockQty: 0, supply: stockSupply(0) })] }, true)).toBeNull();
    expect(productCardUnavailableLabel({}, true)).toBeNull();
    /* 재고 옵션이 섞이면 상세처럼 예약 문구를 쓰지 않는다. */
    expect(productCardUnavailableLabel({ options: [option({ id: 'o1', stockQty: 0, supply: stockSupply(0) }), option({ id: 'o2', stockQty: 0, supply: scheduled })] }, true)).toBeNull();
  });

  it('puts the sale period before the preorder state, like the product detail', () => {
    const salePeriod = { state: 'scheduled' as const, startsAt: '2026-12-01T00:00:00Z', endsAt: '2026-12-31T00:00:00Z', calculatedAt: NOW, nextChangeAt: '2026-12-01T00:00:00Z' };
    expect(productCardUnavailableLabel({ salePeriod, options: [option({ stockQty: 0, supply: scheduled })] }, true)).toBe('판매 시작 전');
    expect(productCardUnavailableLabel({ salePeriod: { ...salePeriod, state: 'ended', nextChangeAt: null } }, false)).toBe('판매 종료');
  });
});
