import { describe, expect, it } from 'vitest';
import { parseGoodsVariantSupply, preorderSupplyLabel, preorderUnavailableLabel } from './goods-preorders';
const policyId = '00000000-0000-4000-8000-000000000001';
const regular = { mode: 'stock', availableQty: 5, policyId: null, policyRevision: null, state: 'stock',
  startsAt: null, endsAt: null, expectedShipDate: null, calculatedAt: '2026-09-10T00:00:00Z', nextChangeAt: null };
const open = { mode: 'preorder', availableQty: 5, policyId, policyRevision: 1, state: 'open',
  startsAt: '2026-09-09T00:00:00Z', endsAt: '2026-09-11T00:00:00Z', expectedShipDate: '2026-10-01',
  calculatedAt: '2026-09-10T00:00:00Z', nextChangeAt: '2026-09-11T00:00:00Z' };
describe('public preorder supply', () => {
  it('distinguishes physical availability from a complete approved preorder window', () => {
    expect(parseGoodsVariantSupply(regular)).toEqual(regular);
    expect(parseGoodsVariantSupply(open)).toEqual(open);
    expect(preorderSupplyLabel(parseGoodsVariantSupply(open))).toBe('예약판매');
  });
  it('does not treat missing dates, a malformed promise or an incomplete policy as normal stock', () => {
    expect(parseGoodsVariantSupply({ ...open, expectedShipDate: null })).toBeNull();
    expect(parseGoodsVariantSupply({ ...open, expectedShipDate: '2026-02-30' })).toBeNull();
    expect(parseGoodsVariantSupply({ ...open, policyRevision: null })).toBeNull();
    expect(parseGoodsVariantSupply(null)).toBeNull();
  });
  it('cannot expose preorder capacity before opening or after it closes', () => {
    const closed = { ...open, state: 'closed', availableQty: 0, calculatedAt: '2026-09-11T00:00:00Z', nextChangeAt: null };
    expect(parseGoodsVariantSupply(closed)).toEqual(closed);
    expect(parseGoodsVariantSupply({ ...closed, availableQty: 5 })).toBeNull();
    expect(preorderSupplyLabel(parseGoodsVariantSupply(closed))).toBe('예약 접수 종료');
    expect(parseGoodsVariantSupply({ ...open, state: 'open', calculatedAt: open.endsAt })).toBeNull();
  });
  it('uses preorder reception states for the sold-out CTA while retaining ordinary restock behavior', () => {
    const closed = parseGoodsVariantSupply({ ...open, state: 'closed', availableQty: 0, calculatedAt: open.endsAt, nextChangeAt: null })!;
    expect(preorderUnavailableLabel([{ stockQty: 0, supply: closed }], true)).toBe('예약 접수 종료');
    expect(preorderUnavailableLabel([{ stockQty: 0 }], true)).toBeNull();
    expect(preorderUnavailableLabel([{ stockQty: 5, supply: parseGoodsVariantSupply(open)! }], true)).toBe('현재 주문을 받지 않습니다');
  });
});
