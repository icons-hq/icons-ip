import { describe, expect, it } from 'vitest';
import { DEFAULT_DETAIL_EXPERIENCES, normalizeExperienceGoodsIds, parseExperienceSection, parseOwnedInterestIds, parsePublicDetailExperience, parseShippingSavings, purchaseMessageLabel, readRecentGoods, recentGoodsKey } from './product-detail-experiences';
describe('PDP experience contracts', () => {
  it('requires truthful customer thresholds and exact sections', () => {
    expect(parseExperienceSection('messages', DEFAULT_DETAIL_EXPERIENCES.messages)).toEqual(DEFAULT_DETAIL_EXPERIENCES.messages);
    for (const minBuyers of [0, 9, 10.5, 1001, Infinity, '10', null]) expect(parseExperienceSection('messages', { ...DEFAULT_DETAIL_EXPERIENCES.messages, minBuyers })).toBeNull();
    expect(parseExperienceSection('discovery', { ...DEFAULT_DETAIL_EXPERIENCES.discovery, extra: true })).toBeNull();
  });
  it('rejects misleading count windows and duplicated messages', () => {
    const base = { discovery: DEFAULT_DETAIL_EXPERIENCES.discovery, nextChangeAt: null };
    expect(parsePublicDetailExperience({ ...base, messages: [{ kind: 'buyers', count: 10, window: 'today' }] })?.messages).toHaveLength(1);
    expect(parsePublicDetailExperience({ ...base, messages: [{ kind: 'buyers', count: 9, window: 'today' }] })).toBeNull();
    expect(parsePublicDetailExperience({ ...base, messages: [{ kind: 'repeatBuyers', count: 10, window: 'today' }] })).toBeNull();
    expect(parsePublicDetailExperience({ ...base, messages: [{ kind: 'newProduct' }, { kind: 'newProduct' }] })).toBeNull();
    expect(purchaseMessageLabel({ kind: 'repeatBuyers', count: 12, window: 'threeMonths' })).toBe('최근 3개월 12명 재구매');
  });
  it('isolates local history by account and stores only bounded catalog IDs', () => {
    const first = recentGoodsKey('92200000-0000-4000-8000-000000000007'), second = recentGoodsKey('92200000-0000-4000-8000-000000000008');
    expect(first).not.toBe(second); expect(first).not.toBe(recentGoodsKey(null));
    expect(readRecentGoods('{broken')).toEqual([]);
    expect(readRecentGoods(JSON.stringify({ version: 1, ids: ['g1', 'g1', 'https://external.test', '<script>', 'g2'] }))).toEqual(['g1', 'g2']);
    expect(normalizeExperienceGoodsIds(Array.from({ length: 50 }, (_, index) => `g${index}`))).toHaveLength(30);
    expect(parseOwnedInterestIds({ ownerId: 'arbitrary', cart: [], wishlist: [], repurchase: [] })).toBeNull();
  });
  it('accepts only positive shipping differences that match the quoted amounts', () => {
    const item = { goodId: 'g2', variantId: '92200000-0000-4000-8000-000000000007', variantName: '기본', qty: 2, separateFee: 6000, combinedFee: 0, savings: 6000 };
    expect(parseShippingSavings({ items: [item], nextChangeAt: null })?.items[0].savings).toBe(6000);
    expect(parseShippingSavings({ items: [{ ...item, savings: 7000 }], nextChangeAt: null })).toBeNull();
    expect(parseShippingSavings({ items: [{ ...item, combinedFee: 6000, savings: 0 }], nextChangeAt: null })).toBeNull();
  });
});
