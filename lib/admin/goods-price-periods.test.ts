import { describe, expect, it } from 'vitest';
import { parseAdminGoodsPricePeriods, parseGoodsPricePeriodInput, toKstDateTimeInput } from './goods-price-periods';

describe('explicit price-period configuration', () => {
  it('keeps an unconfigured draft and refuses to activate it with missing values', () => {
    expect(parseGoodsPricePeriodInput({ state: 'draft', discountPrice: '', startsAt: '', endsAt: '' }))
      .toEqual({ state: 'draft', discountPrice: null, startsAt: null, endsAt: null });
    expect(parseGoodsPricePeriodInput({ state: 'active', discountPrice: '', startsAt: '', endsAt: '' })).toBeNull();
    expect(parseGoodsPricePeriodInput({ state: 'draft', discountPrice: '0', startsAt: '', endsAt: '' })).toBeNull();
  });
  it('converts explicit KST calendar inputs and preserves exact stored instants for stopping an offer', () => {
    expect(parseGoodsPricePeriodInput({ state: 'active', discountPrice: '8000', startsAt: '2026-09-10T12:00', endsAt: '2026-09-11T12:00' }))
      .toEqual({ state: 'active', discountPrice: 8000, startsAt: '2026-09-10T03:00:00.000Z', endsAt: '2026-09-11T03:00:00.000Z' });
    expect(toKstDateTimeInput('2026-09-10T03:00:00Z')).toBe('2026-09-10T12:00');
    const stopped = { state: 'disabled', discountPrice: 8000, startsAt: '2026-09-10T03:00:00.123456+00:00', endsAt: '2026-09-11T03:00:00.123456+00:00' };
    expect(parseGoodsPricePeriodInput(stopped)).toEqual(stopped);
  });
  it('rejects equal/reversed bounds, impossible dates and unknown fields', () => {
    expect(parseGoodsPricePeriodInput({ state: 'active', discountPrice: 8000, startsAt: '2026-09-10T12:00', endsAt: '2026-09-10T12:00' })).toBeNull();
    expect(parseGoodsPricePeriodInput({ state: 'draft', discountPrice: null, startsAt: '2026-02-31T12:00', endsAt: null })).toBeNull();
    expect(parseGoodsPricePeriodInput({ state: 'draft', discountPrice: null, startsAt: null, endsAt: null, regularPrice: 20000 })).toBeNull();
  });
  it('retains an unconfigured discount draft for an existing zero-price option', () => {
    const period = { id: '00000000-0000-4000-8000-000000000001', goodId: 'free-option',
      variantId: '00000000-0000-4000-8000-000000000002', state: 'draft', regularPrice: 0,
      discountPrice: null, startsAt: null, endsAt: null, revision: 1,
      createdAt: '2026-09-10T00:00:00Z', updatedAt: '2026-09-10T00:00:00Z' };
    expect(parseAdminGoodsPricePeriods([period])).toEqual([period]);
  });
});
