import { describe, expect, it } from 'vitest';
import { parsePurchaseCostInput, parseAdminPurchaseCosts, parsePurchaseCostHistory } from './goods-purchase-costs';

describe('private KRW purchase costs', () => {
  it('distinguishes an unset pair from an explicit zero cost with its tax basis', () => {
    expect(parsePurchaseCostInput({ unitCostKrw: '', taxBasis: '' })).toEqual({ unitCostKrw: null, taxBasis: null });
    expect(parsePurchaseCostInput({ unitCostKrw: '0', taxBasis: 'included' })).toEqual({ unitCostKrw: 0, taxBasis: 'included' });
    expect(parsePurchaseCostInput({ unitCostKrw: 0, taxBasis: 'exempt' })).toEqual({ unitCostKrw: 0, taxBasis: 'exempt' });
  });
  it('requires both values and preserves the chosen amount instead of deriving VAT', () => {
    expect(parsePurchaseCostInput({ unitCostKrw: '1250', taxBasis: 'excluded' })).toEqual({ unitCostKrw: 1250, taxBasis: 'excluded' });
    for (const input of [
      { unitCostKrw: '', taxBasis: 'included' }, { unitCostKrw: '0', taxBasis: '' },
      { unitCostKrw: '-1', taxBasis: 'included' }, { unitCostKrw: '1.5', taxBasis: 'included' },
      { unitCostKrw: '1e3', taxBasis: 'included' }, { unitCostKrw: 2147483648, taxBasis: 'included' },
      { unitCostKrw: '1250', taxBasis: 'unknown' },
    ]) expect(parsePurchaseCostInput(input)).toBeNull();
  });
  it('keeps empty lookup rows empty and validates the revision for stale-save protection', () => {
    const row = { variant_id: '00000000-0000-4000-8000-000000000001', good_id: 'good-1',
      unit_cost_krw: null, tax_basis: null, revision: null, updated_at: null };
    expect(parseAdminPurchaseCosts([row])).toEqual([{ variantId: row.variant_id, goodId: row.good_id,
      unitCostKrw: null, taxBasis: null, revision: null, updatedAt: null }]);
    expect(parseAdminPurchaseCosts([{ ...row, unit_cost_krw: 0, tax_basis: 'included' }])).toBeNull();
    expect(parseAdminPurchaseCosts([{ ...row, revision: 1, updated_at: '2026-09-10T00:00:00Z' }])?.[0].unitCostKrw).toBeNull();
  });
  it('retains first-write absence and a later explicit clear in history', () => {
    const entry = { id: '00000000-0000-4000-8000-000000000002', variantId: '00000000-0000-4000-8000-000000000001',
      revision: 1, before: null, after: { unitCostKrw: 0, taxBasis: 'exempt' }, actorName: '관리자', changedAt: '2026-09-10T00:00:00Z' };
    expect(parsePurchaseCostHistory([entry])).toEqual([entry]);
    expect(parsePurchaseCostHistory([{ ...entry, after: { unitCostKrw: null, taxBasis: 'included' } }])).toBeNull();
  });
});
