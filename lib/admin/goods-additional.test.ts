import { describe, expect, it } from 'vitest';
import { parseAdditionalGoodIds, parseAdminAdditionalGoods } from './goods-additional';
describe('additional goods configuration boundary', () => {
  it('preserves an explicit empty set but rejects duplicates and malformed values', () => {
    expect(parseAdditionalGoodIds([])).toEqual([]);
    expect(parseAdditionalGoodIds(['g2', 'g1'])).toEqual(['g2', 'g1']);
    expect(parseAdditionalGoodIds(['g1', 'g1'])).toBeNull();
    expect(parseAdditionalGoodIds(['g1', null])).toBeNull();
  });
  it('keeps unavailable saved links reviewable and refuses an unversioned nonempty set', () => {
    expect(parseAdminAdditionalGoods({ revision: 2, items: [{ goodId: 'g1', name: '추가 상품', available: false }] }))
      .toEqual({ revision: 2, items: [{ goodId: 'g1', name: '추가 상품', available: false }] });
    expect(parseAdminAdditionalGoods({ revision: null, items: [{ goodId: 'g1', name: '추가 상품', available: true }] })).toBeNull();
  });
});
