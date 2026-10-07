import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { emptyGoodsKcWorkbookRow, GOODS_KC_WORKBOOK_HEADERS, GOODS_KC_WORKBOOK_SHEET } from './goods-kc-workbook';
import { buildGoodsWorkbook, parseGoodsWorkbookWithKc } from './goods-workbook-file';
import {
  emptyGoodsWorkbookRow,
  exportGoodsWorkbookRows,
  GOODS_WORKBOOK_HEADERS,
  GOODS_WORKBOOK_KEYS,
  GOODS_WORKBOOK_V3_VERSION,
  partitionGoodsExports,
  planGoodsWorkbookImport,
  type GoodsImportExisting,
  type GoodsWorkbookContext,
  type GoodsWorkbookRow,
} from './goods-workbook';
const variantId = '00000000-0000-4000-8000-000000000001';
const existing: GoodsImportExisting = {
  fingerprint: 'sha',
  good: {
    id: 'existing-good',
    code: 'GO-001',
    name: '기존 상품',
    search_keywords: ['  여름 굿즈  ', 'KUMA'],
    display_order: 7,
    ip_id: 'ip',
    price: 12000,
    compare_at_price: null,
    type: '문구',
    badge: null,
    stock: 'ok',
    allow_bank_transfer: true,
    sale_restriction: 'none',
    published_at: '2026-09-01',
    first_published_at: '2026-09-01',
    archived_at: null,
    origin_id: 'origin',
    shipping_fee_type: 'policy',
    individual_fee: 0,
    image_path: 'public-media/catalog/good/a.png',
    gallery_paths: [],
    detail_image_path: null,
    description: null,
    notice_maker: '제조사',
    notice_origin: '한국',
    notice_material: '종이',
    notice_size: 'A5',
    notice_made_on: '2026-09',
    notice_as_manager: 'CS',
    notice_as_contact: '02-000',
  },
  variants: [
    {
      id: variantId,
      code: 'GO-001-01',
      name: '기본 옵션',
      attributes: {},
      price: 12000,
      stock_qty: 7,
      is_default: true,
      sort_order: 0,
      archived_at: null,
    },
  ],
};
const context: GoodsWorkbookContext = {
  existing: [existing],
  ips: [{ id: 'ip', archived_at: null }],
  origins: [{ id: 'origin', code: 'gimpo', is_active: true }],
  presets: [],
  imageNames: [],
  mediaUrl: (path) => `https://example.test/${path}`,
};
const row = (
  values: Partial<ReturnType<typeof emptyGoodsWorkbookRow>> = {},
  number = 5,
) => ({
  row: number,
  values: {
    ...emptyGoodsWorkbookRow(),
    name: '신규 상품',
    ipId: 'ip',
    ...values,
  },
});
/** 추가 이미지 4칸 시절 v3 양식 — v4에서 갤러리 5~9 열이 없는 순서 그대로 실제 XLSX로 만든다. */
async function v3Workbook(rows: GoodsWorkbookRow[]) {
  const keys = GOODS_WORKBOOK_KEYS.filter((key) => !/^gallery(Url|File)[4-8]$/.test(key));
  expect(keys).toHaveLength(GOODS_WORKBOOK_KEYS.length - 10);
  expect(keys.slice(keys.indexOf('galleryFile3'), keys.indexOf('galleryFile3') + 2)).toEqual(['galleryFile3', 'detailImageUrl']);
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('상품');
  sheet.getCell('A1').value = GOODS_WORKBOOK_V3_VERSION;
  sheet.getRow(4).values = keys.map((key) => GOODS_WORKBOOK_HEADERS[key]);
  rows.forEach((values, index) => {
    sheet.getRow(index + 5).values = keys.map((key) => values[key] || null);
  });
  // v3 파일의 KC 검토 시트도 같은 v3 버전 표기를 쓴다.
  const kc = book.addWorksheet(GOODS_KC_WORKBOOK_SHEET);
  kc.getCell('A1').value = GOODS_WORKBOOK_V3_VERSION;
  kc.getRow(4).values = Object.values(GOODS_KC_WORKBOOK_HEADERS);
  return Buffer.from(await book.xlsx.writeBuffer());
}
describe('goods Excel planning', () => {
  it('대표·추가 카테고리를 XLSX로 왕복하고 추가 분류 공란은 명시 해제한다', async () => {
    const primary = '00000000-0000-4000-8000-000000051111';
    const extra = '00000000-0000-4000-8000-000000051121';
    const record = { ...existing, good: { ...existing.good, category_id: primary, additional_category_ids: [extra] } };
    const ctx = { ...context, existing: [record], categories: [
      { id: primary, code: 'primary-leaf', archived_at: null }, { id: extra, code: 'extra-leaf', archived_at: null },
    ] };
    const parsed = await parseGoodsWorkbookWithKc(await buildGoodsWorkbook(exportGoodsWorkbookRows(record, ctx)));
    expect(parsed.rows[0].values).toMatchObject({ categoryCode: 'primary-leaf', additionalCategoryCodes: 'extra-leaf' });
    expect(planGoodsWorkbookImport(parsed.rows, ctx)[0].kind).toBe('unchanged');
    const cleared = { ...parsed.rows[0], values: { ...parsed.rows[0].values, additionalCategoryCodes: '' } };
    expect(planGoodsWorkbookImport([cleared], ctx)[0]).toMatchObject({ kind: 'update', target: { category_id: primary, additional_category_ids: [] } });
    const invalid = { ...cleared, values: { ...cleared.values, additionalCategoryCodes: 'unknown' } };
    expect(planGoodsWorkbookImport([invalid], ctx)[0]).toMatchObject({ kind: 'error', errors: expect.arrayContaining([expect.stringContaining('추가 카테고리')]) });
  });
  it('round-trips discount display through an actual workbook and validates explicit changes', async () => {
    const record = { ...existing, good: { ...existing.good, show_discount_rate: false } };
    const ctx = { ...context, existing: [record] };
    const exported = exportGoodsWorkbookRows(record, ctx);
    expect(exported[0].showDiscountRate).toBe('아니오');
    const parsed = await parseGoodsWorkbookWithKc(await buildGoodsWorkbook(exported));
    expect(parsed.rows[0].values.showDiscountRate).toBe('아니오');
    expect(planGoodsWorkbookImport(parsed.rows, ctx)[0]).toMatchObject({ kind: 'unchanged' });
    const plan = (value: string) => planGoodsWorkbookImport([{ ...parsed.rows[0], values: { ...parsed.rows[0].values, showDiscountRate: value } }], ctx)[0];
    expect(plan('예')).toMatchObject({ kind: 'update', target: { show_discount_rate: true, price: 12000 } });
    expect(plan('임의')).toMatchObject({ kind: 'error', errors: expect.arrayContaining([expect.stringContaining('할인율 표시')]) });
    expect(plan('')).toMatchObject({ target: { show_discount_rate: true } });
  });
  it('CRLF HTML과 검증 이미지 경로가 실제 XLSX에서 LF로 바뀌어도 무수정으로 계획한다', async () => {
    const path = 'public-media/catalog/good/22222222-2222-4222-8222-222222222222.webp';
    const description = `<h2>구성품</h2>\r\n<p>키링 &amp; 스티커</p>\r\n<img src="${path}" alt="구성" loading="lazy" decoding="async" />`;
    const record = { ...existing, good: { ...existing.good, description, description_format: 'html', description_image_paths: [path], search_keywords: ['0', '키링', '스티커'], display_order: 0 } };
    const ctx = { ...context, existing: [record] };
    const parsed = await parseGoodsWorkbookWithKc(await buildGoodsWorkbook(exportGoodsWorkbookRows(record, ctx)));
    expect(parsed.rows[0].values).toMatchObject({ description: `<h2>구성품</h2>\n<p>키링 &amp; 스티커</p>\n<img src="${path}" alt="구성" loading="lazy" decoding="async" />`, descriptionFormat: 'html', searchKeywords: '0\n키링\n스티커', displayOrder: '0' });
    expect(planGoodsWorkbookImport(parsed.rows, { ...ctx, kcRows: parsed.kcRows })[0]).toMatchObject({ kind: 'unchanged', target: null });
    expect(record.good.description).toBe(description);
    expect(record.good.description_image_paths).toEqual([path]);
  });
  it('plain 줄바꿈과 여러 키워드는 왕복하며 0·공란·실제 문구와 이미지 변경은 계속 구분한다', async () => {
    const description = '0\r\n첫 설명\r\n\r\n마지막 설명';
    const record = { ...existing, good: { ...existing.good, description, description_format: 'plain', search_keywords: ['0', '키링', '스티커'], display_order: 0 },
      variants: [{ ...existing.variants[0], erp_code: '00000123' }] };
    const ctx = { ...context, existing: [record] };
    const exported = exportGoodsWorkbookRows(record, ctx);
    const parsePlan = async (edits: Partial<typeof exported[number]>) => {
      const parsed = await parseGoodsWorkbookWithKc(await buildGoodsWorkbook([{ ...exported[0], ...edits }]));
      return planGoodsWorkbookImport(parsed.rows, { ...ctx, kcRows: parsed.kcRows })[0];
    };
    expect(await parsePlan({ searchKeywords: '0\r\n키링\r\n스티커' })).toMatchObject({ kind: 'unchanged', target: null });
    expect(await parsePlan({ description: '0\r\n수정한 설명\r\n\r\n마지막 설명' })).toMatchObject({ kind: 'update', target: { description: '0\n수정한 설명\n\n마지막 설명' } });
    expect(await parsePlan({ displayOrder: '' })).toMatchObject({ kind: 'update', target: { display_order: null } });
    expect(await parsePlan({ description: '0' })).toMatchObject({ kind: 'update', target: { description: '0' } });
    expect(await parsePlan({ description: '' })).toMatchObject({ kind: 'update', target: { description: null } });
    expect(await parsePlan({ searchKeywords: '0\r\n다른 키워드' })).toMatchObject({ kind: 'update', target: { search_keywords: ['0', '다른 키워드'] } });
    expect(await parsePlan({ erpCode: '00000124' })).toMatchObject({ kind: 'update', target: { variants: [{ erpCode: '00000124' }] } });
    const imagePath = 'public-media/catalog/good/33333333-3333-4333-8333-333333333333.webp';
    expect(await parsePlan({ descriptionFormat: 'html', description: `<p>새 HTML</p>\r\n<img src="${imagePath}" alt="새 이미지">` })).toMatchObject({ kind: 'update', target: { description_format: 'html', description_image_paths: [imagePath] } });
    expect(record.good.description).toBe(description);
    expect(record.good.display_order).toBe(0);
    expect(record.variants[0].erp_code).toBe('00000123');
  });
  it('HTML 형식과 코드·이미지 경로를 무수정 왕복하고 다른 항목 수정에도 보존한다', () => {
    const path = 'public-media/catalog/good/22222222-2222-4222-8222-222222222222.webp';
    const description = `<h2>구성품</h2>\n<p>키링 &amp; 스티커</p><img src="${path}" alt="구성" loading="lazy" decoding="async" />`;
    const record = { ...existing, good: { ...existing.good, description, description_format: 'html', description_image_paths: [path] } };
    const ctx = { ...context, existing: [record] };
    const exported = exportGoodsWorkbookRows(record, ctx);
    expect(exported[0]).toMatchObject({ descriptionFormat: 'html', description });
    expect(planGoodsWorkbookImport([{ row: 5, values: exported[0] }], ctx)[0].kind).toBe('unchanged');
    expect(planGoodsWorkbookImport([{ row: 5, values: { ...exported[0], name: '이름만 변경' } }], ctx)[0]).toMatchObject({ kind: 'update', target: { description, description_format: 'html', description_image_paths: [path] } });
  });
  it('plans KC-only changes in the same atomic product payload and never discards them as an unchanged product', () => {
    const record = { ...existing, good: { ...existing.good, published_at: null } };
    const kc = { ...emptyGoodsKcWorkbookRow(), goodCode: 'GO-001', modelIndex: '1', variantCodes: 'GO-001-01', modelName: 'TEST 전용 모델' };
    const ctx = { ...context, existing: [record], kcRows: [{ row: 5, values: kc }] };
    const goodsRows = exportGoodsWorkbookRows(record, ctx).map(values => ({ row: 5, values }));
    expect(planGoodsWorkbookImport(goodsRows, ctx)[0]).toMatchObject({ kind: 'update',
      target: { kc_update: { models: [{ modelName: 'TEST 전용 모델', variantCodes: ['GO-001-01'] }], expectedRevision: null } },
      kcSource: [{ row: 5, values: kc }] });
    expect(planGoodsWorkbookImport(goodsRows, { ...ctx, kcRows: undefined })[0].kind).toBe('unchanged');
    expect(() => planGoodsWorkbookImport(goodsRows, { ...ctx, kcRows: [{ row: 5, values: { ...kc, goodCode: 'MISSING' } }] })).toThrow('상품 시트');
  });
  it('ERP 식별자의 선행 0과 외부값 기준 시각을 보존하고 판매 조건을 왕복한다', () => {
    const record = { ...existing, good: { ...existing.good, allow_card_payment: false, order_quantity_limit_enabled: true,
      min_order_qty: 2, max_order_qty: 4, member_purchase_limit_enabled: true, member_lifetime_qty_limit: 7 },
      variants: [{ ...existing.variants[0], erp_code: '0000123', erp_name: 'ERP 아크릴', barcode: '00123456789', external_updated_at: '2026-09-10T00:00:00Z' }] };
    const ctx = { ...context, existing: [record] };
    const exported = exportGoodsWorkbookRows(record, ctx);
    expect(exported[0]).toMatchObject({ erpCode: '0000123', erpName: 'ERP 아크릴', barcode: '00123456789',
      allowCardPayment: '아니오', orderQuantityLimitEnabled: '예', minOrderQty: '2', maxOrderQty: '4', memberLifetimeQtyLimit: '7' });
    const plan = planGoodsWorkbookImport([{ row: 5, values: { ...exported[0], name: '메타데이터 수정' } }], ctx)[0];
    expect(plan).toMatchObject({ kind: 'update', target: { allow_card_payment: false, order_quantity_limit_enabled: true,
      min_order_qty: 2, max_order_qty: 4, member_purchase_limit_enabled: true, member_lifetime_qty_limit: 7,
      variants: [{ erpCode: '0000123', erpName: 'ERP 아크릴', barcode: '00123456789', externalUpdatedAt: '2026-09-10T00:00:00Z' }] } });
  });

  it('수치가 없는 한도 활성화와 0 한도는 적용 계획에서 거절한다', () => {
    expect(planGoodsWorkbookImport([row({ orderQuantityLimitEnabled: '예', minOrderQty: '', maxOrderQty: '' })], context)[0].kind).toBe('error');
    expect(planGoodsWorkbookImport([row({ memberPurchaseLimitEnabled: '예', memberLifetimeQtyLimit: '0' })], context)[0].kind).toBe('error');
  });
  it('검색 키워드와 진열 순서를 내보내고 같은 상품 행에서 왕복한다', () => {
    const exported = exportGoodsWorkbookRows(existing, context);
    expect(exported[0]).toMatchObject({ searchKeywords: '여름 굿즈\nKUMA', displayOrder: '7' });
    const group = planGoodsWorkbookImport(
      [{ row: 5, values: { ...exported[0], name: '수정 상품' } }],
      context,
    )[0];
    expect(group).toMatchObject({
      kind: 'update',
      target: { search_keywords: ['여름 굿즈', 'KUMA'], display_order: 7 },
    });
  });
  it('재고 경보 기준과 중지된 기본 옵션을 엑셀 수정에서도 보존한다', () => {
    const stopped = { ...existing, variants: [{ ...existing.variants[0], stock_qty: 10, low_stock_threshold: 3, archived_at: '2026-09-10T00:00:00Z' }] };
    const stoppedContext = { ...context, existing: [stopped] };
    const exported = exportGoodsWorkbookRows(stopped, stoppedContext);
    expect(exported[0]).toMatchObject({ stockQty: '10', lowStockThreshold: '3', variantActive: '중지' });
    const plan = planGoodsWorkbookImport([{ row: 5, values: { ...exported[0], name: '상품명만 수정' } }], stoppedContext)[0];
    expect(plan).toMatchObject({ kind: 'update', target: { variants: [{ id: variantId, stockQty: 10, lowStockThreshold: 3, isActive: false }] } });
  });
  it('영문 상품명을 내보내고 다른 상품 정보를 고쳐 가져와도 보존한다', () => {
    const translated = { ...existing, good: { ...existing.good, name_en: 'Acrylic Keyring' } };
    const translatedContext = { ...context, existing: [translated] };
    const rows = exportGoodsWorkbookRows(translated, translatedContext);
    expect(rows[0].nameEn).toBe('Acrylic Keyring');
    const result = planGoodsWorkbookImport([{ row: 5, values: { ...rows[0], name: '다른 한글 이름' } }], translatedContext)[0];
    expect(result).toMatchObject({ kind: 'update', target: { name_en: 'Acrylic Keyring', name: '다른 한글 이름' } });
  });
  it('treats an untouched export as zero changes, including blanks and storage paths', () => {
    const rows = exportGoodsWorkbookRows(existing, context).map(
      (values, index) => ({ row: index + 5, values }),
    );
    expect(planGoodsWorkbookImport(rows, context)[0]).toMatchObject({
      kind: 'unchanged',
      images: [],
      target: null,
    });
  });
  it('accepts a minimal draft with one option and resolves a product group by repeated code', () => {
    const groups = planGoodsWorkbookImport(
      [
        row({
          code: 'new-1',
          variantCode: 'new-1-a',
          variantName: '빨강',
          axis1: '색상',
          value1: '빨강',
          price: '12000',
          variantPrice: '14000',
          stockQty: '8',
        }),
        row(
          {
            code: 'NEW-1',
            variantCode: 'new-1-b',
            variantName: '파랑',
            axis1: '색상',
            value1: '파랑',
            price: '12000',
            variantPrice: '15000',
            stockQty: '9',
          },
          6,
        ),
      ],
      context,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      kind: 'new',
      rows: [5, 6],
      target: {
        code: 'NEW-1',
        publish: false,
        variants: [
          { code: 'NEW-1-A', extraPrice: 2000, stockQty: 8 },
          { code: 'NEW-1-B', extraPrice: 3000, stockQty: 9 },
        ],
      },
    });
  });
  it('keeps errors scoped to a complete product group and allows other products', () => {
    const groups = planGoodsWorkbookImport(
      [
        row({ code: 'bad', name: '첫 이름' }),
        row({ code: 'bad', name: '다른 이름' }, 6),
        row({ code: 'good' }, 7),
      ],
      context,
    );
    expect(groups.map((group) => group.kind)).toEqual(['error', 'new']);
    expect(groups[0].errors.join()).toContain('같은 상품');
  });
  it('highlights live price and stock edits and carries optimistic inventory baselines', () => {
    const values = exportGoodsWorkbookRows(existing, context)[0];
    const group = planGoodsWorkbookImport(
      [{ row: 5, values: { ...values, variantPrice: '13000', stockQty: '9' } }],
      context,
    )[0];
    expect(group.kind).toBe('update');
    expect(group.warnings).toContain(
      '공개 상품의 가격 또는 재고가 변경됩니다.',
    );
    expect(group.target).toMatchObject({
      variant_baseline: [variantId],
      variants: [{ id: variantId, stockQty: 9, expectedStockQty: 7 }],
    });
  });
  it('rejects incomplete publication but resolves notice presets and zip filenames', () => {
    expect(
      planGoodsWorkbookImport([row({ publish: '공개' })], context)[0].kind,
    ).toBe('error');
    const next = {
      ...context,
      presets: [
        {
          name: '문구',
          notice: {
            maker: '회사',
            origin: '한국',
            material: '종이',
            size: 'A5',
            madeOn: '2026-09',
            asManager: 'CS',
            asContact: '02-000',
          },
        },
      ],
      imageNames: ['cover.png'],
    };
    const group = planGoodsWorkbookImport(
      [
        row({
          publish: '공개',
          type: '문구',
          preset: '문구',
          originCode: 'gimpo',
          imageFile: 'cover.png',
        }),
      ],
      next,
    )[0];
    expect(group.kind).toBe('new');
    expect(group.images).toEqual([
      { field: 'image_path', source: 'cover.png', kind: 'file' },
    ]);
    expect(group.target).toMatchObject({ notice_maker: '회사', publish: true });
  });
  it('preserves zero values, rejects formulas supplied as row errors and caps option rows', () => {
    expect(
      planGoodsWorkbookImport([row({ price: '0', stockQty: '0' })], context)[0]
        .target,
    ).toMatchObject({ price: 0, variants: [{ stockQty: 0 }] });
    expect(
      planGoodsWorkbookImport(
        [{ ...row(), errors: ['수식은 허용되지 않습니다.'] }],
        context,
      )[0].kind,
    ).toBe('error');
    expect(() =>
      planGoodsWorkbookImport(
        Array.from({ length: 501 }, () => row()),
        context,
      ),
    ).toThrow('500행');
  });
  it('추가 이미지 9장을 v4 양식으로 왕복하고 9번째 칸만 바꾼 변경을 계획한다', async () => {
    const gallery = Array.from({ length: 9 }, (_, index) => `public-media/catalog/good/gallery-${index + 1}.webp`);
    const record = { ...existing, good: { ...existing.good, gallery_paths: gallery } };
    const ctx = { ...context, existing: [record] };
    const exported = exportGoodsWorkbookRows(record, ctx);
    expect(exported[0]).toMatchObject({ galleryUrl0: `https://example.test/${gallery[0]}`, galleryUrl8: `https://example.test/${gallery[8]}` });
    const parsed = await parseGoodsWorkbookWithKc(await buildGoodsWorkbook(exported));
    expect(parsed.rows[0].values.galleryUrl8).toBe(`https://example.test/${gallery[8]}`);
    expect(parsed.rows[0].layout).toBeUndefined();
    expect(planGoodsWorkbookImport(parsed.rows, { ...ctx, kcRows: parsed.kcRows })[0]).toMatchObject({ kind: 'unchanged' });
    const changed = planGoodsWorkbookImport([{ row: 5, values: { ...exported[0], galleryUrl8: 'https://img.example.com/new-9.png' } }], ctx)[0];
    expect(changed).toMatchObject({ kind: 'update', target: { gallery_paths: [...gallery.slice(0, 8), 'import-image:gallery_8'] } });
    expect(changed.images).toEqual([{ field: 'gallery_8', source: 'https://img.example.com/new-9.png', kind: 'url' }]);
  });
  it('갤러리 4칸 v3 양식도 올리고 기존 상품의 추가 이미지 5~9는 저장값을 유지한다', async () => {
    const gallery = Array.from({ length: 9 }, (_, index) => `public-media/catalog/good/gallery-${index + 1}.webp`);
    const record = { ...existing, good: { ...existing.good, gallery_paths: gallery } };
    const ctx = { ...context, existing: [record] };
    const exported = exportGoodsWorkbookRows(record, ctx)[0];
    const parsed = await parseGoodsWorkbookWithKc(await v3Workbook([exported]));
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ row: 5, layout: 'v3', values: { galleryUrl3: exported.galleryUrl3, galleryUrl4: '', galleryUrl8: '', detailImageUrl: exported.detailImageUrl } });
    expect(parsed.rows[0].values.name).toBe('기존 상품');
    // 파일에 없는 갤러리 5~9는 빈칸이 아니라 "그대로 둠"이다.
    expect(planGoodsWorkbookImport(parsed.rows, { ...ctx, kcRows: parsed.kcRows })[0]).toMatchObject({ kind: 'unchanged' });
    const removedFirst = { ...parsed.rows[0], values: { ...parsed.rows[0].values, galleryUrl0: '' } };
    const plan = planGoodsWorkbookImport([removedFirst], ctx)[0];
    expect(plan).toMatchObject({ kind: 'update', target: { gallery_paths: gallery.slice(1) }, images: [] });
    // 실패 행 파일은 v4로 다시 만들어지므로 유지한 추가 이미지 5~9가 열에 그대로 남는다.
    expect(plan.source[0].values.galleryUrl8).toBe(`https://example.test/${gallery[8]}`);
    expect(removedFirst.values.galleryUrl8).toBe('');
    // 새 상품은 v3 파일의 갤러리 1~4만 쓴다.
    const fresh = planGoodsWorkbookImport([{ row: 6, layout: 'v3', values: { ...row().values, galleryUrl0: 'https://img.example.com/1.png' } }], ctx)[0];
    expect(fresh).toMatchObject({ kind: 'new', target: { gallery_paths: ['import-image:gallery_0'] } });
  });
  it('never splits one product across export parts', () => {
    expect(
      partitionGoodsExports([
        { id: 'a', rows: 300 },
        { id: 'b', rows: 200 },
        { id: 'c', rows: 1 },
      ]),
    ).toEqual([['a', 'b'], ['c']]);
  });
});

it('카테고리 코드와 배송 안내 버전을 같은 값으로 엑셀 왕복한다', () => {
  const categoryId = '00000000-0000-4000-8000-000000047401';
  const nextContext = { ...context, categories: [{ id: categoryId, code: 'stationery', archived_at: null }] };
  const item: GoodsImportExisting = { ...existing, good: { ...existing.good, category_id: categoryId,
    shipping_notice_snapshot: { code: 'confirmed', templateVersion: 2 } } };
  nextContext.existing = [item];
  const [row] = exportGoodsWorkbookRows(item, nextContext);
  expect(row.categoryCode).toBe('stationery');
  expect(row.shippingNoticeTemplateVersion).toBe('2');
  row.name += ' 수정';
  const [plan] = planGoodsWorkbookImport([{ row: 5, values: row }], nextContext);
  expect(plan.errors).toEqual([]);
  expect(plan.target).toMatchObject({ category_id: categoryId, shipping_notice_template_code: 'confirmed', shipping_notice_template_version: 2 });
});

it('분류와 템플릿의 누락된 식별자를 묵시적으로 해제하지 않는다', () => {
  expect(() => exportGoodsWorkbookRows({ ...existing, good: { ...existing.good, category_id: 'unknown' } }, context)).toThrow('카테고리 코드');
  const [row] = exportGoodsWorkbookRows(existing, context);
  row.categoryCode = 'unknown'; row.shippingNoticeTemplateCode = 'confirmed'; row.shippingNoticeTemplateVersion = '';
  expect(planGoodsWorkbookImport([{ row: 5, values: row }], context)[0].errors.length).toBeGreaterThan(0);
});

it('매입단가 0원과 세금 구분은 관리자 엑셀에서만 왕복하고 staff는 수정할 수 없다', () => {
  const item: GoodsImportExisting = { ...existing, variants: existing.variants.map((variant) => ({ ...variant,
    purchase_cost_krw: 0, purchase_tax_basis: 'exempt', purchase_cost_revision: 7,
  })) };
  const adminContext = { ...context, existing: [item], canManageCosts: true };
  const [row] = exportGoodsWorkbookRows(item, adminContext);
  expect(row.purchaseCostKrw).toBe('0'); expect(row.purchaseTaxBasis).toBe('exempt');
  row.name += ' 수정';
  const [plan] = planGoodsWorkbookImport([{ row: 5, values: row }], adminContext);
  expect(plan.errors).toEqual([]);
  expect(plan.target?.variants).toEqual(expect.arrayContaining([expect.objectContaining({ purchaseCost: { unitCostKrw: 0, taxBasis: 'exempt', expectedRevision: 7 } })]));
  const [staffRow] = exportGoodsWorkbookRows(item, context);
  expect(staffRow.purchaseCostKrw).toBe(''); expect(staffRow.purchaseTaxBasis).toBe('');
  expect(planGoodsWorkbookImport([{ row: 5, values: row }], context)[0].errors.join(' ')).toContain('관리자만');
  row.purchaseTaxBasis = '';
  expect(planGoodsWorkbookImport([{ row: 5, values: row }], adminContext)[0].errors.join(' ')).toContain('함께');
});
