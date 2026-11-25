import { describe, expect, it } from 'vitest';
import { MAX_ADDITIONAL_GOODS, additionalCandidateVerdict, parseAdditionalGoodIds, parseAdminAdditionalGoods } from './goods-additional';
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

describe('추가 구성 후보 확인', () => {
  const found = (...ids: string[]) => ids.map((goodId) => ({ goodId, name: goodId, available: true }));
  it('판매 중인 상품만 담긴 검색 결과에 있으면 연결할 수 있다', () => {
    expect(additionalCandidateVerdict(found('hw-1', 'hw-10'), 'hw-1')).toBe('available');
  });
  it('결과에 없고 결과가 50개 미만이면 지금 고객이 살 수 없는 상품이다', () => {
    expect(additionalCandidateVerdict(found('hw-10'), 'hw-1')).toBe('unavailable');
    expect(additionalCandidateVerdict([], 'hw-1')).toBe('unavailable');
  });
  it('결과가 50개로 꽉 찼는데 없으면 단정하지 않고 저장할 때 DB가 가리게 둔다', () => {
    const full = found(...Array.from({ length: MAX_ADDITIONAL_GOODS }, (_, index) => `hw-${index + 10}`));
    expect(additionalCandidateVerdict(full, 'hw-1')).toBe('unknown');
    expect(additionalCandidateVerdict(full, 'hw-10')).toBe('available');
  });
});
