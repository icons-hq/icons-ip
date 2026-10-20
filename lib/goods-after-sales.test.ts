import { describe, expect, it } from 'vitest';
import { EMPTY_GOODS_AFTER_SALES, parseGoodsAfterSalesSnapshot, parseGoodsAfterSalesValues, parseGoodsAfterSalesTemplate, parseGoodsAfterSalesTemplatePage } from './goods-after-sales';
const values = { phone: '02-123-4567', guide: 'A/S 안내\n둘째 줄', sellerSpecialNotes: '배송 기간' };
describe('operational after-sales content', () => {
  it('normalizes multiline content, supports unicode boundaries and excludes unrelated notice fields', () => {
    expect(parseGoodsAfterSalesValues({ phone: ' 02-123-4567 ', guide: ' A/S 안내\r\n둘째 줄\t ', sellerSpecialNotes: ' 배송\r기간 ', noticeAsContact: '다른 연락처' })).toEqual({ phone: values.phone, guide: values.guide, sellerSpecialNotes: '배송\n기간' });
    expect(parseGoodsAfterSalesValues({ phone: '가'.repeat(20), guide: '😀'.repeat(1300), sellerSpecialNotes: '나'.repeat(1300) })).not.toBeNull();
    for (const invalid of [{ ...values, phone: '가'.repeat(21) }, { ...values, guide: '😀'.repeat(1301) }, { ...values, sellerSpecialNotes: '나'.repeat(1301) }, { ...values, phone: '02\n123' }, { ...values, guide: '안내\x01' }, { ...values, guide: null }, { ...values, phone: '' }, { ...values, guide: '' }]) expect(parseGoodsAfterSalesValues(invalid)).toBeNull();
  });
  it('permits clearing only the complete product document, never a template or partial record', () => {
    expect(parseGoodsAfterSalesValues(EMPTY_GOODS_AFTER_SALES)).toBeNull();
    expect(parseGoodsAfterSalesValues(EMPTY_GOODS_AFTER_SALES, true)).toEqual(EMPTY_GOODS_AFTER_SALES);
    expect(parseGoodsAfterSalesValues({ ...EMPTY_GOODS_AFTER_SALES, sellerSpecialNotes: '메모만' }, true)).toBeNull();
    const snapshot = { ...EMPTY_GOODS_AFTER_SALES, goodId: 'good-1', goodName: '상품', revision: 0, updatedAt: null };
    expect(parseGoodsAfterSalesSnapshot(snapshot)).toEqual(snapshot);
    expect(parseGoodsAfterSalesSnapshot({ ...snapshot, ...values })).toBeNull();
    expect(parseGoodsAfterSalesSnapshot({ ...snapshot, revision: 4, updatedAt: '2026-10-14T00:00:00Z' })?.revision).toBe(4);
    expect(parseGoodsAfterSalesSnapshot(null)).toBeNull();
  });
  it('rejects malformed, duplicated or empty template rows', () => {
    const row = { ...values, id: '94000000-0000-4000-8000-000000000301', revision: 1, archived: false, createdAt: '2026-10-14T00:00:00Z' };
    expect(parseGoodsAfterSalesTemplate(row)).toEqual(row);
    expect(parseGoodsAfterSalesTemplate({ ...row, ...EMPTY_GOODS_AFTER_SALES })).toBeNull();
    expect(parseGoodsAfterSalesTemplatePage({ rows: [row], total: 21, page: 2, pageSize: 20 })?.total).toBe(21);
    expect(parseGoodsAfterSalesTemplatePage({ rows: [row, row], total: 2, page: 1, pageSize: 20 })).toBeNull();
  });
});
