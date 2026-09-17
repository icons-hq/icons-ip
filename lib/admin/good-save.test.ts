import { describe, expect, it } from 'vitest';
import { normalizeAdminGoodForm } from './catalog';
import { goodSaveFields } from './good-save';
import { emptyGoodsWorkbookRow, planGoodsWorkbookImport } from './goods-workbook';

function manual(values: Record<string, string>) {
  const form = new FormData();
  Object.entries({ name: '합성 상품', ipId: 'ip', ...values }).forEach(([key, value]) => form.set(key, value));
  const result = normalizeAdminGoodForm(form, { ipIds: new Set(['ip']), eventIds: new Set(), goodIpById: new Map(), verticalKeys: new Set() });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return goodSaveFields(result.value);
}

describe('manual and workbook goods persistence contract', () => {
  it('keeps omitted manual fields absent while explicit blanks and workbook blanks clear them', () => {
    const omitted = manual({});
    const cleared = manual({ nameEn: '', searchKeywords: '', displayOrder: '', categoryId: '', shippingNoticeTemplate: '', descriptionFormat: 'plain' });
    const [workbook] = planGoodsWorkbookImport([{ row: 5, values: { ...emptyGoodsWorkbookRow(), name: '합성 상품', ipId: 'ip' } }], {
      existing: [], ips: [{ id: 'ip', archived_at: null }], origins: [], presets: [], mediaUrl: () => null,
    });
    expect(workbook.errors).toEqual([]);
    for (const field of ['name_en', 'search_keywords', 'display_order', 'category_id', 'shipping_notice_template_code', 'description_format']) {
      expect(omitted).not.toHaveProperty(field);
      expect(workbook.target).toHaveProperty(field, cleared[field as keyof typeof cleared]);
    }
    expect(cleared).toMatchObject({ name_en: null, search_keywords: [], display_order: null, category_id: null, shipping_notice_template_code: null });
    expect(omitted.publish).toBe(null);
    expect(workbook.target?.publish).toBe(false);
  });

  it('uses the same normalized HTML, notice and sale policy fields for both inputs', () => {
    const html = '<h2>구성</h2><script>remove()</script><p>상품 설명</p>';
    const [workbook] = planGoodsWorkbookImport([{ row: 5, values: { ...emptyGoodsWorkbookRow(), name: '합성 상품', ipId: 'ip',
      descriptionFormat: 'html', description: html, noticeMaker: '제조사', allowCardPayment: '아니오', searchKeywords: '여름, 여름, 굿즈', displayOrder: '0' } }], {
      existing: [], ips: [{ id: 'ip', archived_at: null }], origins: [], presets: [], mediaUrl: () => null,
    });
    const form = manual({ descriptionFormat: 'html', description: html, noticeMaker: '제조사', allowCardPayment: 'false', searchKeywords: '여름, 여름, 굿즈', displayOrder: '0' });
    expect(workbook.errors).toEqual([]);
    for (const field of ['description', 'description_format', 'description_image_paths', 'notice_maker', 'allow_card_payment', 'search_keywords', 'display_order']) {
      expect(workbook.target).toHaveProperty(field, form[field as keyof typeof form]);
    }
    expect(form.description).not.toContain('script');
  });
});
