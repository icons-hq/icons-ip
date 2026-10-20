import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildRehearsalOrdersSql } from './admin-rehearsal-orders.mjs';
import { buildRehearsalWorkbooks } from './admin-rehearsal-workbooks.mjs';
import {
  buildGoodsWorkbook,
  parseGoodsWorkbook,
  parseGoodsWorkbookWithKc,
} from '../lib/admin/goods-workbook-file';
import { planGoodsWorkbookImport } from '../lib/admin/goods-workbook';
import { GOODS_WORKBOOK_VERSION } from '../lib/admin/goods-workbook';
import { GOODS_KC_WORKBOOK_HEADERS, GOODS_KC_WORKBOOK_SHEET } from '../lib/admin/goods-kc-workbook';
import { GOODS_CUSTOM_INPUT_WORKBOOK_HEADERS, GOODS_CUSTOM_INPUT_WORKBOOK_SHEET } from '../lib/admin/goods-custom-input-workbook';
import { GOODS_AFTER_SALES_WORKBOOK_HEADERS, GOODS_AFTER_SALES_WORKBOOK_SHEET, GOODS_SIZE_WORKBOOK_HEADERS, GOODS_SIZE_WORKBOOK_SHEET } from '../lib/admin/goods-guidance-workbook';
describe('reproducible rehearsal fixtures', () => {
  it('isolates run identities and emits 100 insert-only orders behind the staging guard', () => {
    const result = buildRehearsalOrdersSql({ run: 'qa-20260908' });
    expect(result).toEqual(buildRehearsalOrdersSql({ run: 'qa-20260908' }));
    expect(result.customerId).not.toBe(
      buildRehearsalOrdersSql({ run: 'qa-20260909' }).customerId,
    );
    expect(result.sql).toContain('app.staging_seed_enabled');
    expect(result.sql).toContain('on conflict(id) do nothing');
    expect(result.sql).toContain('private.create_order_shipments');
    expect(result.sql).not.toMatch(
      /delete from|update public.orders|update public.goods|encrypted_password/i,
    );
    expect(() => buildRehearsalOrdersSql({ run: 'bad;drop-table' })).toThrow();
  });
  it('uses the real template and round trips 30 products with two options', async () => {
    const files = await buildRehearsalWorkbooks({
      template: await buildGoodsWorkbook([]),
      run: 'qa-20260908',
      ipId: 'demo-maple-placeholder',
    });
    const generatedWorkbook = new ExcelJS.Workbook();
    await generatedWorkbook.xlsx.load(files['goods-draft.xlsx']);
    const generatedSheet = generatedWorkbook.getWorksheet('상품');
    expect(generatedSheet.getCell('A1').text).toBe(GOODS_WORKBOOK_VERSION);
    for (const [name, headers] of [[GOODS_KC_WORKBOOK_SHEET, GOODS_KC_WORKBOOK_HEADERS], [GOODS_CUSTOM_INPUT_WORKBOOK_SHEET, GOODS_CUSTOM_INPUT_WORKBOOK_HEADERS],
      [GOODS_AFTER_SALES_WORKBOOK_SHEET, GOODS_AFTER_SALES_WORKBOOK_HEADERS], [GOODS_SIZE_WORKBOOK_SHEET, GOODS_SIZE_WORKBOOK_HEADERS]]) {
      const sheet = generatedWorkbook.getWorksheet(name);
      expect(sheet.getCell('A1').text).toBe(GOODS_WORKBOOK_VERSION);
      expect(sheet.getRow(4).values).toEqual([undefined, ...Object.values(headers)]);
      expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 4 });
    }
    expect((await parseGoodsWorkbookWithKc(files['goods-draft.xlsx'])).customInputRows).toEqual([]);
    expect(await parseGoodsWorkbookWithKc(files['goods-draft.xlsx'])).toMatchObject({ afterSalesRows: [], sizeRows: [] });
    expect(generatedSheet?.autoFilter).toBe(`A4:${generatedSheet?.getColumn(generatedSheet.getRow(4).cellCount).letter}64`);
    const draft = await parseGoodsWorkbook(files['goods-draft.xlsx']);
    expect(draft).toHaveLength(60);
    expect(new Set(draft.map((row) => row.values.code)).size).toBe(30);
    expect(
      draft.every(
        (row) =>
          row.values.publish === '초안' &&
          row.values.noticeMaker &&
          row.values.originCode === 'gimpo' &&
          row.values.allowCardPayment === '예' &&
          row.values.variantActive === '사용' &&
          row.values.descriptionFormat === 'plain' &&
          row.values.orderQuantityLimitEnabled === '아니오' &&
          row.values.memberPurchaseLimitEnabled === '아니오',
      ),
    ).toBe(true);
    const failed = await parseGoodsWorkbook(files['goods-draft-errors.xlsx']);
    expect(failed.filter((row) => row.values.stockQty === '-1')).toHaveLength(
      2,
    );
    expect(
      (await parseGoodsWorkbook(files['goods-publish.xlsx'])).every(
        (row) => row.values.publish === '공개',
      ),
    ).toBe(true);
    const plan = planGoodsWorkbookImport(draft, {
      existing: [],
      ips: [{ id: 'demo-maple-placeholder', archived_at: null }],
      presets: [],
      origins: [{ id: '00000000-0000-4000-8000-000000042201', code: 'gimpo', is_active: true }],
      imageNames: ['rehearsal.png'],
      mediaUrl: (path) => path,
    });
    expect(plan).toHaveLength(30);
    expect(plan.every((group) => group.kind === 'new' && !group.target.publish && group.target.variants.length === 2)).toBe(true);
    expect(plan.every((group) => group.target.allow_card_payment === true && group.target.variants.every((variant) => variant.isActive === true))).toBe(true);
    const publish = await parseGoodsWorkbookWithKc(files['goods-publish.xlsx']);
    expect(publish.rows.every((row) => row.values.publish === '공개')).toBe(true);
    expect(publish.kcRows).toEqual([]);
    expect(planGoodsWorkbookImport(publish.rows, {
      existing: [],
      ips: [{ id: 'demo-maple-placeholder', archived_at: null }],
      presets: [],
      origins: [{ id: '00000000-0000-4000-8000-000000042201', code: 'gimpo', is_active: true }],
      imageNames: ['rehearsal.png'],
      mediaUrl: (path) => path,
    }).every((group) => !Object.hasOwn(group.target ?? {}, 'kc_update'))).toBe(true);
    expect(files['goods-images.zip'].subarray(0, 2).toString()).toBe('PK');
  });
});
