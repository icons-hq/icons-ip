import { describe, expect, it } from 'vitest';
import { parseGoodsBenefitSnapshot, parseGoodsBenefitValues, parseGoodsEventTemplatePage } from './goods-benefits';
const path = 'public-media/catalog/good/93800000-0000-4000-8000-000000000777.webp';
const values = { eventText: '  첫 구매 안내  ', giftText: '사은품 안내', giftImagePaths: [path] };
describe('product benefit content', () => {
  it('preserves only bounded informational values and distinct verified-path candidates', () => {
    expect(parseGoodsBenefitValues({ ...values, stock: 900 })).toEqual({ eventText: '첫 구매 안내', giftText: '사은품 안내', giftImagePaths: [path] });
    expect(parseGoodsBenefitValues({ eventText: '가'.repeat(40), giftText: '나'.repeat(100), giftImagePaths: [] })).not.toBeNull();
    for (const invalid of [{ ...values, eventText: '가'.repeat(41) }, { ...values, giftText: '나'.repeat(101) }, { ...values, eventText: 'line\nline' }, { ...values, giftText: '' }, { ...values, giftImagePaths: [path, path] }, { ...values, giftImagePaths: ['https://example.com/image.png'] }, { ...values, giftImagePaths: [path.replace('/good/', '/ip/')] }, { ...values, giftImagePaths: [null] }]) expect(parseGoodsBenefitValues(invalid)).toBeNull();
  });
  it('requires the saved revision and safe complete snapshots without inventing a failed-read default', () => {
    const data = { ...values, goodId: 'good-1', goodName: '상품', revision: 2, updatedAt: '2026-10-13T14:00:00Z', updatedBy: 'private', secret: 'private' };
    const parsed = parseGoodsBenefitSnapshot(data);
    expect(parsed?.revision).toBe(2); expect(JSON.stringify(parsed)).not.toContain('private');
    expect(parseGoodsBenefitSnapshot({ ...data, revision: -1 })).toBeNull();
    expect(parseGoodsBenefitSnapshot(null)).toBeNull();
    expect(parseGoodsBenefitSnapshot({ ...data, updatedAt: 'invalid' })).toBeNull();
  });
  it('keeps template counts and pages explicit and rejects duplicate or incomplete rows', () => {
    const row = { id: '93800000-0000-4000-8000-000000000301', eventText: '안내', revision: 1, archived: false, createdAt: '2026-10-13T14:00:00Z' };
    expect(parseGoodsEventTemplatePage({ rows: [row], total: 21, page: 2, pageSize: 20 })?.total).toBe(21);
    expect(parseGoodsEventTemplatePage({ rows: [row, row], total: 2, page: 1, pageSize: 20 })).toBeNull();
    expect(parseGoodsEventTemplatePage({ rows: [{ ...row, revision: 0 }], total: 1, page: 1, pageSize: 20 })).toBeNull();
    expect(parseGoodsEventTemplatePage({ rows: [], total: -1, page: 1, pageSize: 20 })).toBeNull();
  });
});
