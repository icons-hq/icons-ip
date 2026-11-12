import ExcelJS from 'exceljs';
import { findCountryName } from './country-names';
import { describe, expect, it } from 'vitest';
import { emptyGoodsKcWorkbookRow, GOODS_KC_WORKBOOK_LEGACY_HEADERS, GOODS_KC_WORKBOOK_SHEET } from './goods-kc-workbook';
import { buildGoodsWorkbook, parseGoodsWorkbookWithKc } from './goods-workbook-file';
import { emptyGoodsCustomInputWorkbookRow, exportGoodsCustomInputWorkbookRows } from './goods-custom-input-workbook';
import {
  emptyGoodsWorkbookRow,
  exportGoodsWorkbookRows,
  GOODS_WORKBOOK_CELL_MAX,
  GOODS_WORKBOOK_HEADERS,
  GOODS_WORKBOOK_KEYS,
  GOODS_WORKBOOK_LONG_DESCRIPTION_MARKER,
  GOODS_WORKBOOK_V3_VERSION,
  GOODS_WORKBOOK_V4_VERSION,
  GOODS_WORKBOOK_V7_VERSION,
  goodsWorkbookLayout,
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
    product_no: 1042,
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
    // 0901-015: 재고수량은 비울 수 없다 — 시험 행은 0을 직접 적는다.
    stockQty: '0',
    ...values,
  },
});
/**
 * 구형 양식의 실제 열 순서·열 이름으로 만든다. v3~v7은 상품번호가 없고 가격이 저장값 그대로(기준 판매가·소비자가·옵션 판매가)다.
 * v4는 옵션 축 3이, v3는 갤러리 5~9도 빠져 있다.
 */
async function v3Workbook(rows: GoodsWorkbookRow[], version = GOODS_WORKBOOK_V3_VERSION) {
  const columns = goodsWorkbookLayout(version)!.columns;
  const keys = columns.map((column) => column.key);
  expect(keys).not.toContain('productNo');
  expect(keys).toHaveLength(GOODS_WORKBOOK_KEYS.length - 1 - (version === GOODS_WORKBOOK_V3_VERSION ? 12 : version === GOODS_WORKBOOK_V4_VERSION ? 2 : 0));
  if (version === GOODS_WORKBOOK_V3_VERSION) expect(keys.slice(keys.indexOf('galleryFile3'), keys.indexOf('galleryFile3') + 2)).toEqual(['galleryFile3', 'detailImageUrl']);
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('상품');
  sheet.getCell('A1').value = version;
  sheet.getRow(4).values = columns.map((column) => column.header);
  rows.forEach((values, index) => {
    // 판매가·즉시할인·옵션가(v8)를 구형 저장값 열로 되돌린다.
    const discount = Number(values.instantDiscount || 0);
    const price = Number(values.salePrice || 0) - discount;
    const legacy: Record<string, string> = {
      'legacy:price': String(price), 'legacy:compareAtPrice': discount ? values.salePrice : '', 'legacy:variantPrice': String(price + Number(values.optionPrice || 0)),
    };
    sheet.getRow(index + 5).values = keys.map((key) => (key.startsWith('legacy:') ? legacy[key] : values[key as keyof GoodsWorkbookRow]) || null);
  });
  // 구형 파일의 KC 검토 시트도 같은 버전 표기와 그때의 열 이름을 쓴다.
  const kc = book.addWorksheet(GOODS_KC_WORKBOOK_SHEET);
  kc.getCell('A1').value = version;
  kc.getRow(4).values = Object.values(GOODS_KC_WORKBOOK_LEGACY_HEADERS);
  return Buffer.from(await book.xlsx.writeBuffer());
}
describe('goods Excel planning', () => {
  it.each([findCountryName('KR')!.name, '대한민국(경기도) / 중국', '대한민국(경기도 수원시 영통구)'])('제조국 %s는 XLSX 왕복에도 코드 치환 없이 같은 고시 문자열로 남는다', async value => {
    const record = { ...existing, good: { ...existing.good, notice_origin: value } };
    const ctx = { ...context, existing: [record] };
    const exported = exportGoodsWorkbookRows(record, ctx);
    const parsed = await parseGoodsWorkbookWithKc(await buildGoodsWorkbook(exported));
    expect(GOODS_WORKBOOK_HEADERS.noticeOrigin).toBe('제조국');
    expect(parsed.rows[0].values.noticeOrigin).toBe(value);
    expect(planGoodsWorkbookImport(parsed.rows, ctx)[0].kind).toBe('unchanged');
  });
  it('3축 옵션을 v5 실제 파일로 왕복하며 식별자·재고를 유지하고 구형 양식의 축 소실을 막는다', async () => {
    const record = { ...existing, variants: [{ ...existing.variants[0], name: '빨강 / M / 선물', attributes: { 색상: '빨강', 크기: 'M', 구성: '선물' } }] };
    const ctx = { ...context, existing: [record] };
    const exported = exportGoodsWorkbookRows(record, ctx);
    expect(exported[0]).toMatchObject({ axis1: '색상', value1: '빨강', axis2: '크기', value2: 'M', axis3: '구성', value3: '선물' });
    const parsed = await parseGoodsWorkbookWithKc(await buildGoodsWorkbook(exported));
    expect(planGoodsWorkbookImport(parsed.rows, ctx)[0].kind).toBe('unchanged');
    parsed.rows[0].values.stockQty = '5';
    expect(planGoodsWorkbookImport(parsed.rows, ctx)[0].target?.variants).toEqual([expect.objectContaining({ id: variantId, attributes: record.variants[0].attributes, stockQty: 5, expectedStockQty: 7 })]);
    for (const version of [GOODS_WORKBOOK_V3_VERSION, GOODS_WORKBOOK_V4_VERSION]) {
      const old = await parseGoodsWorkbookWithKc(await v3Workbook(exported, version));
      const plan = planGoodsWorkbookImport(old.rows, ctx)[0];
      expect(plan.kind).toBe('error'); expect(plan.target).toBeNull(); expect(plan.errors.join(' ')).toContain('최신 양식(v8)');
    }
  });
  it('상품열이 같아도 직접입력형만 변경하면 기존 writer payload로 계획하고 누락 시에는 보존한다', async () => {
    const config = { enabled: true, revision: 4, fields: [{ id: '00000000-0000-4000-8000-000000010001', name: 'TEST 이전 문구', active: true }] };
    const record = { ...existing, good: { ...existing.good, custom_inputs_enabled: config.enabled,
      custom_inputs_revision: config.revision, custom_input_fields: config.fields } };
    const ctx = { ...context, existing: [record] };
    const goodsRows = exportGoodsWorkbookRows(record, ctx);
    const custom = exportGoodsCustomInputWorkbookRows([{ goodCode: 'GO-001', config }]);
    custom[0].name = 'TEST 변경 문구';
    const parsed = await parseGoodsWorkbookWithKc(await buildGoodsWorkbook(goodsRows, undefined, [], custom));
    const result = planGoodsWorkbookImport(parsed.rows, { ...ctx, customInputRows: parsed.customInputRows });
    expect(result[0]).toMatchObject({ kind: 'update', customInputSource: parsed.customInputRows,
      target: { custom_inputs: { enabled: true, fields: [{ ...config.fields[0], name: 'TEST 변경 문구' }] }, custom_inputs_expected_revision: 4 } });
    expect(planGoodsWorkbookImport(parsed.rows, ctx)[0]).toMatchObject({ kind: 'unchanged', target: null });
    const failed = planGoodsWorkbookImport(parsed.rows, { ...ctx, customInputRows: parsed.customInputRows!.map(row => ({ ...row, values: { ...row.values, revision: '3' } })) });
    expect(failed[0]).toMatchObject({ kind: 'error', target: null });
  });
  it('직접입력형 오류는 해당 상품만 막고 정상 신규 상품의 서버 ID를 plan에 고정한다', () => {
    const custom = (goodCode: string, name: string) => ({ row: 5, values: { ...emptyGoodsCustomInputWorkbookRow(), goodCode,
      mode: '편집', enabled: '예', name, action: '사용', revision: '0' } });
    const rows = [row({ code: 'NEW-1' }), row({ code: 'NEW-2', name: '다른 새 상품' }, 6)];
    const results = planGoodsWorkbookImport(rows, { ...context, customInputRows: [custom('NEW-1', ''), custom('NEW-2', 'TEST 문구')],
      newCustomInputId: () => '00000000-0000-4000-8000-000000010003' });
    expect(results[0]).toMatchObject({ kind: 'error', target: null });
    expect(results[1]).toMatchObject({ kind: 'new', target: { custom_inputs_expected_revision: 0,
      custom_inputs: { enabled: true, fields: [{ id: '00000000-0000-4000-8000-000000010003', name: 'TEST 문구', active: true }] } } });
  });
  it('기존 2축 이하 상품은 v4 양식을 계속 읽고 동일한 수정 계획을 만든다', async () => {
    const exported = exportGoodsWorkbookRows(existing, context);
    const old = await parseGoodsWorkbookWithKc(await v3Workbook(exported, GOODS_WORKBOOK_V4_VERSION));
    expect(old.rows[0].layout).toBe('v4'); expect(old.rows[0].values.axis3).toBe('');
    expect(planGoodsWorkbookImport(old.rows, context)[0].kind).toBe('unchanged');
    old.rows[0].values.stockQty = '5';
    expect(planGoodsWorkbookImport(old.rows, context)[0].target?.variants).toEqual([expect.objectContaining({ id: variantId, stockQty: 5, expectedStockQty: 7 })]);
  });
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
  // Each case performs a real XLSX encode/decode. Give each independent case the
  // normal test deadline so CI CPU contention does not combine eight roundtrips.
  it.each([
    { label: '키워드 줄바꿈', edits: { searchKeywords: '0\r\n키링\r\n스티커' }, expected: { kind: 'unchanged', target: null } },
    { label: '설명 줄바꿈', edits: { description: '0\r\n수정한 설명\r\n\r\n마지막 설명' }, expected: { kind: 'update', target: { description: '0\n수정한 설명\n\n마지막 설명' } } },
    { label: '진열 순서 공란', edits: { displayOrder: '' }, expected: { kind: 'update', target: { display_order: null } } },
    { label: '문자열 0', edits: { description: '0' }, expected: { kind: 'update', target: { description: '0' } } },
    { label: '설명 공란', edits: { description: '' }, expected: { kind: 'update', target: { description: null } } },
    { label: '변경한 키워드', edits: { searchKeywords: '0\r\n다른 키워드' }, expected: { kind: 'update', target: { search_keywords: ['0', '다른 키워드'] } } },
    { label: 'ERP 선행 0', edits: { erpCode: '00000124' }, expected: { kind: 'update', target: { variants: [{ erpCode: '00000124' }] } } },
    { label: '변경한 이미지', edits: { descriptionFormat: 'html', description: '<p>새 HTML</p>\r\n<img src="public-media/catalog/good/33333333-3333-4333-8333-333333333333.webp" alt="새 이미지">' }, expected: { kind: 'update', target: { description_format: 'html', description_image_paths: ['public-media/catalog/good/33333333-3333-4333-8333-333333333333.webp'] } } },
  ])('plain 엑셀 왕복에서 $label 값을 보존하고 구분한다', async ({ edits, expected }) => {
    const description = '0\r\n첫 설명\r\n\r\n마지막 설명';
    const record = { ...existing, good: { ...existing.good, description, description_format: 'plain', search_keywords: ['0', '키링', '스티커'], display_order: 0 },
      variants: [{ ...existing.variants[0], erp_code: '00000123' }] };
    const ctx = { ...context, existing: [record] };
    const exported = exportGoodsWorkbookRows(record, ctx);
    const parsed = await parseGoodsWorkbookWithKc(await buildGoodsWorkbook([{ ...exported[0], ...edits }]));
    expect(planGoodsWorkbookImport(parsed.rows, { ...ctx, kcRows: parsed.kcRows })[0]).toMatchObject(expected);
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
  /*
   * 리뷰 재현(T3B-RV-1): R17이 상세 HTML 상한을 200,000자로 올린 뒤, 엑셀 한 칸(32,767자)보다 긴 설명은 내보낸 파일을
   * 그대로 다시 올려도 '셀 내용이 너무 깁니다'로 거절됐고, Excel에서 저장하면 잘린 설명이 정상 설명을 덮어쓸 수 있었다.
   * 긴 설명은 표식 문구로 내보내고, 표식을 그대로 두면 저장된 설명·형식을 유지한다.
   */
  it('엑셀 한 칸보다 긴 상세 HTML은 표식으로 내보내고 그대로 다시 올리면 기존 설명을 유지한다', async () => {
    const description = `<h2>상세</h2><p>${'가'.repeat(39980)}</p>`;
    expect(description.length).toBeGreaterThan(GOODS_WORKBOOK_CELL_MAX);
    const record = { ...existing, good: { ...existing.good, description, description_format: 'html', description_image_paths: [] } };
    const ctx = { ...context, existing: [record] };
    const exported = exportGoodsWorkbookRows(record, ctx);
    expect(exported[0]).toMatchObject({ descriptionFormat: 'html', description: GOODS_WORKBOOK_LONG_DESCRIPTION_MARKER });
    const parsed = await parseGoodsWorkbookWithKc(await buildGoodsWorkbook(exported));
    expect(parsed.rows[0].errors).toEqual([]);
    expect(parsed.rows[0].values.description).toBe(GOODS_WORKBOOK_LONG_DESCRIPTION_MARKER);
    expect(planGoodsWorkbookImport(parsed.rows, { ...ctx, kcRows: parsed.kcRows })[0]).toMatchObject({ kind: 'unchanged', target: null });
    /* 다른 항목을 고쳐도 설명은 표식이 아니라 저장된 원문으로 다시 저장한다. */
    const edited = planGoodsWorkbookImport([{ row: 5, values: { ...parsed.rows[0].values, name: '이름만 변경' } }], ctx)[0];
    expect(edited).toMatchObject({ kind: 'update', errors: [], target: { name: '이름만 변경', description, description_format: 'html' } });
    expect(edited.target?.description).not.toContain('상품 편집에서만 수정');
  });
  it('긴 설명 표식은 기존 상품에서만 쓰고 형식을 바꾸면 거절한다', () => {
    const description = `<p>${'나'.repeat(GOODS_WORKBOOK_CELL_MAX)}</p>`;
    const record = { ...existing, good: { ...existing.good, description, description_format: 'html', description_image_paths: [] } };
    const ctx = { ...context, existing: [record] };
    const exported = exportGoodsWorkbookRows(record, ctx)[0];
    const plain = planGoodsWorkbookImport([{ row: 5, values: { ...exported, descriptionFormat: 'plain' } }], ctx)[0];
    expect(plain).toMatchObject({ kind: 'error', target: null });
    expect(plain.errors.join(' ')).toContain('상세 설명 형식');
    const created = planGoodsWorkbookImport([row({ salePrice: '1000', optionPrice: '0', descriptionFormat: 'html', description: GOODS_WORKBOOK_LONG_DESCRIPTION_MARKER })], ctx)[0];
    expect(created).toMatchObject({ kind: 'error', target: null });
    expect(created.errors.join(' ')).toContain('상품 편집');
  });
  it('엑셀 한 칸에 들어가는 상세 HTML(32,767자)은 표식 없이 원문 그대로 내보낸다', () => {
    const description = `<p>${'다'.repeat(GOODS_WORKBOOK_CELL_MAX - 7)}</p>`;
    expect(description.length).toBe(GOODS_WORKBOOK_CELL_MAX);
    const record = { ...existing, good: { ...existing.good, description, description_format: 'html', description_image_paths: [] } };
    expect(exportGoodsWorkbookRows(record, context)[0].description).toBe(description);
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
          salePrice: '12000',
          optionPrice: '2000',
          stockQty: '8',
        }),
        row(
          {
            code: 'NEW-1',
            variantCode: 'new-1-b',
            variantName: '파랑',
            axis1: '색상',
            value1: '파랑',
            salePrice: '12000',
            optionPrice: '3000',
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
  it('판매가·즉시할인은 상품 수정 화면과 같은 뜻으로 저장값(할인가·할인 전 판매가)이 되고, 오류는 엑셀 열 이름으로 알린다(S36-012)', () => {
    const [discounted] = planGoodsWorkbookImport([row({ code: 'price-ok', salePrice: '12000', instantDiscount: '2000', optionPrice: '500' })], context);
    expect(discounted).toMatchObject({ kind: 'new', target: { price: 10000, compare_at_price: 12000, variants: [{ extraPrice: 500 }] } });
    for (const instantDiscount of ['', '0']) {
      const [plain] = planGoodsWorkbookImport([row({ code: 'price-plain', salePrice: '12000', instantDiscount })], context);
      expect(plain).toMatchObject({ kind: 'new', target: { price: 12000, compare_at_price: null } });
    }
    const [equal] = planGoodsWorkbookImport([row({ code: 'price-eq', salePrice: '12000', instantDiscount: '12000' })], context);
    expect(equal.errors).toEqual(['즉시할인은 1원 이상, 판매가 12,000원보다 작은 원 단위 정수로 입력하거나 비워 주세요.']);
    const [text] = planGoodsWorkbookImport([row({ code: 'price-text', salePrice: '12000', instantDiscount: '10%' })], context);
    expect(text.errors).toEqual(['즉시할인은 1원 이상, 판매가 12,000원보다 작은 원 단위 정수로 입력하거나 비워 주세요.']);
    const [regular] = planGoodsWorkbookImport([row({ code: 'price-bad', salePrice: '12,000원' })], context);
    expect(regular.errors).toEqual(['판매가는 0~2,147,483,647 원 단위 정수입니다.']);
    for (const group of [equal, text, regular]) expect(group.errors.join()).not.toMatch(/소비자가|기준 판매가/);
  });
  it('할인 중인 상품은 판매가(할인 전)·즉시할인(원)·옵션가(추가금액)로 내보내고 그대로 올리면 변경 없음이다', async () => {
    const record = { ...existing, good: { ...existing.good, price: 10000, compare_at_price: 12000 },
      variants: [{ ...existing.variants[0], price: 10500 }] };
    const ctx = { ...context, existing: [record] };
    const [exported] = exportGoodsWorkbookRows(record, ctx);
    expect(exported).toMatchObject({ productNo: '1042', code: 'GO-001', salePrice: '12000', instantDiscount: '2000', optionPrice: '500' });
    const parsed = await parseGoodsWorkbookWithKc(await buildGoodsWorkbook([exported]));
    expect(parsed.rows[0].values).toMatchObject({ productNo: '1042', salePrice: '12000', instantDiscount: '2000', optionPrice: '500' });
    expect(planGoodsWorkbookImport(parsed.rows, ctx)[0].kind).toBe('unchanged');
    // 즉시할인만 비우면 할인을 끈다(판매가 12,000원, 옵션 12,500원).
    const cleared = planGoodsWorkbookImport([{ ...parsed.rows[0], values: { ...parsed.rows[0].values, instantDiscount: '' } }], ctx)[0];
    expect(cleared).toMatchObject({ kind: 'update', target: { price: 12000, compare_at_price: null, variants: [{ extraPrice: 500 }] } });
    // 구형(v7) 파일의 같은 값도 그대로 올리면 변경 없음이다.
    const old = await parseGoodsWorkbookWithKc(await v3Workbook([exported], GOODS_WORKBOOK_V7_VERSION));
    expect(old.rows[0]).toMatchObject({ layout: 'v7', values: { productNo: '', salePrice: '12000', instantDiscount: '2000', optionPrice: '500' } });
    expect(planGoodsWorkbookImport(old.rows, ctx)[0].kind).toBe('unchanged');
  });
  it('상품번호 → 판매자상품코드 → 상품 URL 순서로 수정할 상품을 찾고, 서로 다른 상품을 가리키면 덮어쓰지 않는다(ADR-0038)', () => {
    const [values] = exportGoodsWorkbookRows(existing, context);
    expect(values.productNo).toBe('1042');
    // 상품번호만 있어도 같은 상품이다(판매자상품코드를 채워 묶고 경고로 알린다).
    const byNumber = planGoodsWorkbookImport([{ row: 5, values: { ...values, code: '', stockQty: '9' } }], context)[0];
    expect(byNumber).toMatchObject({ kind: 'update', code: 'GO-001', target: { previous_id: 'existing-good', variants: [{ id: variantId, stockQty: 9 }] } });
    expect(byNumber.warnings).toContain('판매자상품코드가 비어 있어 상품번호로 찾은 기존 상품을 수정합니다.');
    // 판매자상품코드만 있으면 지금처럼 그 상품이고, 상품번호는 비교에서 채운다.
    expect(planGoodsWorkbookImport([{ row: 5, values: { ...values, productNo: '' } }], context)[0].kind).toBe('unchanged');
    // 번호·코드가 모두 빈 행은 상품 URL로 찾는다.
    const byUrl = planGoodsWorkbookImport([{ row: 5, values: { ...values, productNo: '', code: '' } }], context)[0];
    expect(byUrl).toMatchObject({ kind: 'unchanged', code: 'GO-001' });
    const byUrlChanged = planGoodsWorkbookImport([{ row: 5, values: { ...values, productNo: '', code: '', stockQty: '3' } }], context)[0];
    expect(byUrlChanged.kind).toBe('update');
    expect(byUrlChanged.warnings).toContain('판매자상품코드·상품번호가 비어 있어 상품 URL로 찾은 기존 상품을 수정합니다.');
    // 상품번호와 판매자상품코드가 어긋나거나, 없는 번호·숫자가 아닌 번호는 오류다.
    const mismatch = planGoodsWorkbookImport([{ row: 5, values: { ...values, code: 'OTHER-CODE' } }], context)[0];
    expect(mismatch).toMatchObject({ kind: 'error', target: null });
    expect(mismatch.errors.join()).toContain('상품번호 1042와 판매자상품코드 OTHER-CODE가 서로 다른 상품을 가리킵니다');
    expect(planGoodsWorkbookImport([{ row: 5, values: { ...values, productNo: '999999' } }], context)[0].errors.join())
      .toContain('상품번호 999999인 상품을 찾을 수 없습니다');
    for (const productNo of ['1,042', '0', 'abc', '-1'])
      expect(planGoodsWorkbookImport([{ row: 5, values: { ...values, productNo } }], context)[0].errors.join())
        .toContain('상품번호는 내려받은 숫자 그대로 두거나, 새 상품이면 비워 주세요.');
    // 새 상품(번호·코드·URL이 기존과 다름)은 지금처럼 새로 만든다.
    expect(planGoodsWorkbookImport([row({ code: 'NEW-9', id: 'brand-new' })], context)[0].kind).toBe('new');
  });
  it('구형(v3~v7) 가격 열은 판매가·즉시할인·옵션가로 옮기고, 옮길 수 없는 값은 구형 열 이름으로 알린다', async () => {
    const { goodsWorkbookPricesFromLegacy } = await import('./goods-workbook');
    expect(goodsWorkbookPricesFromLegacy({ price: '10000', compareAtPrice: '12000', variantPrice: '10500' }))
      .toEqual({ values: { salePrice: '12000', instantDiscount: '2000', optionPrice: '500' }, errors: [] });
    expect(goodsWorkbookPricesFromLegacy({ price: '12000', compareAtPrice: '', variantPrice: '' }))
      .toEqual({ values: { salePrice: '12000', instantDiscount: '', optionPrice: '' }, errors: [] });
    expect(goodsWorkbookPricesFromLegacy({ price: '12000', compareAtPrice: '12000', variantPrice: '12000' }).errors).toEqual(['소비자가는 기준 판매가보다 커야 합니다.']);
    expect(goodsWorkbookPricesFromLegacy({ price: '12000', compareAtPrice: '12,000원', variantPrice: '' }).errors).toEqual(['기준 판매가·소비자가는 0 이상의 정수입니다.']);
    expect(goodsWorkbookPricesFromLegacy({ price: '12000', compareAtPrice: '', variantPrice: '11000' }).errors).toEqual(['옵션 판매가는 기준 판매가보다 낮게 입력할 수 없습니다.']);
  });
  it('재고수량 빈칸은 신규·수정 모두 그 행을 거절하고, 0을 직접 적으면 저장한다(0901-015)', () => {
    const blank = '5행: 재고수량(옵션 재고)을 입력해주세요. 재고가 없으면 0을 입력합니다.';
    const [fresh] = planGoodsWorkbookImport([row({ code: 'STOCK-NEW', stockQty: '' })], context);
    expect(fresh).toMatchObject({ kind: 'error', target: null });
    expect(fresh.errors).toContain(blank);
    expect(planGoodsWorkbookImport([row({ code: 'STOCK-NEW', stockQty: '  ' })], context)[0].errors).toContain(blank);
    expect(planGoodsWorkbookImport([row({ code: 'STOCK-NEW', stockQty: '0' })], context)[0])
      .toMatchObject({ kind: 'new', target: { variants: [{ stockQty: 0 }] } });
    // 기존 상품(재고 7) 행의 재고 칸을 지우면 0으로 덮지 않고 거절한다.
    const [values] = exportGoodsWorkbookRows(existing, context);
    expect(values.stockQty).toBe('7');
    const cleared = planGoodsWorkbookImport([{ row: 5, values: { ...values, stockQty: '' } }], context)[0];
    expect(cleared).toMatchObject({ kind: 'error', target: null });
    expect(cleared.errors).toContain(blank);
    expect(planGoodsWorkbookImport([{ row: 5, values: { ...values, stockQty: '0' } }], context)[0])
      .toMatchObject({ kind: 'update', target: { variants: [{ id: variantId, stockQty: 0, expectedStockQty: 7 }] } });
    // 숫자가 아닌 재고는 지금처럼 정수 오류다(빈칸 오류와 겹치지 않는다).
    const text = planGoodsWorkbookImport([row({ code: 'STOCK-TEXT', stockQty: '열 개' })], context)[0];
    expect(text.errors).toContain('5행: 옵션가·재고수량은 0~2,147,483,647 정수입니다.');
    expect(text.errors).not.toContain(blank);
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
      [{ row: 5, values: { ...values, optionPrice: '1000', stockQty: '9' } }],
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
      planGoodsWorkbookImport([row({ salePrice: '0', stockQty: '0' })], context)[0]
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
  it('추가 이미지 9장을 v5 양식으로 왕복하고 9번째 칸만 바꾼 변경을 계획한다', async () => {
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
