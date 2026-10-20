import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { EMPTY_GOODS_AFTER_SALES, type GoodsAfterSalesSnapshot } from '@/lib/goods-after-sales';
import { emptyGoodsSizeChartValues, type GoodsSizeChartSnapshot } from '@/lib/goods-size-chart';
import { emptyGoodsWorkbookRow, exportGoodsWorkbookRows, GOODS_WORKBOOK_V6_VERSION, planGoodsWorkbookImport,
  type GoodsImportExisting, type GoodsWorkbookContext } from './goods-workbook';
import { buildGoodsWorkbook, parseGoodsWorkbookWithKc } from './goods-workbook-file';
import { emptyGoodsCustomInputWorkbookRow } from './goods-custom-input-workbook';
import { GOODS_AFTER_SALES_WORKBOOK_HEADERS, GOODS_AFTER_SALES_WORKBOOK_SHEET, GOODS_SIZE_WORKBOOK_HEADERS, GOODS_SIZE_WORKBOOK_SHEET,
  emptyGoodsAfterSalesWorkbookRow, emptyGoodsSizeWorkbookRow, exportGoodsAfterSalesWorkbookRows, exportGoodsSizeWorkbookRows,
  planGoodsAfterSalesWorkbook, planGoodsSizeWorkbook } from './goods-guidance-workbook';

const afterSales: GoodsAfterSalesSnapshot = { goodId: 'guidance-test', goodName: '안내 시험', revision: 3, updatedAt: '2026-10-14T00:00:00Z',
  phone: '02-123-4567', guide: '기존 안내\n두 번째 줄', sellerSpecialNotes: '판매자 안내' };
const sizeChart: GoodsSizeChartSnapshot = { goodId: 'guidance-test', goodName: '안내 시험', revision: 2, updatedAt: '2026-10-14T00:00:00Z', values: {
  enabled: true, chart: { unit: 'cm', sizes: ['소형', '대형'], measurements: [{ name: '너비', values: ['10', '20.5'] }, { name: '높이', values: ['30.5', '50'] }], note: '측정 오차 안내' },
} };
const asRow = (change = {}) => ({ row: 5, values: { ...emptyGoodsAfterSalesWorkbookRow(), goodCode: '001', mode: '편집',
  phone: '02-123-4567', guide: '새 안내', sellerSpecialNotes: '', revision: '3', ...change } });
const sizeRows = () => exportGoodsSizeWorkbookRows([{ goodCode: '001', snapshot: sizeChart }]).map((values, index) => ({ row: index + 5, values }));
const record: GoodsImportExisting = { good: { id: 'guidance-test', code: '001', name: '안내 시험', type: '문구', ip_id: 'ip', price: 1000,
  archived_at: null, description: '기'.repeat(2100), description_format: 'plain' }, variants: [], fingerprint: 'fingerprint', afterSales, sizeChart };
const context: GoodsWorkbookContext = { existing: [record], ips: [{ id: 'ip', archived_at: null }], origins: [], presets: [], mediaUrl: () => null };
const product = { ...emptyGoodsWorkbookRow(), code: '001', ipId: 'ip', name: '안내 시험', price: '1000' };
const asValues = exportGoodsAfterSalesWorkbookRows([{ goodCode: '001', snapshot: afterSales }]);
const sizeValues = exportGoodsSizeWorkbookRows([{ goodCode: '001', snapshot: sizeChart }]);
async function bookWithGuidance() {
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await buildGoodsWorkbook([product], undefined, [], [], asValues, sizeValues)) as never);
  return book;
}
const bytes = async (book: ExcelJS.Workbook) => Buffer.from(await book.xlsx.writeBuffer());

describe('goods guidance workbook planning', () => {
  it('omitted rows preserve each child, including current revisions', () => {
    expect(planGoodsAfterSalesWorkbook(null, '001', afterSales).kind).toBe('keep');
    expect(planGoodsSizeWorkbook([], '001', sizeChart).kind).toBe('keep');
    expect(planGoodsAfterSalesWorkbook(asValues.map(values => ({ row: 5, values })), '001', afterSales).kind).toBe('keep');
    expect(planGoodsSizeWorkbook(sizeRows(), '001', sizeChart).kind).toBe('keep');
  });
  it('only an explicit empty A/S clear removes all three fields', () => {
    expect(planGoodsAfterSalesWorkbook([asRow({ mode: '전체 해제', phone: '', guide: '', sellerSpecialNotes: '' })], '001', afterSales))
      .toMatchObject({ kind: 'save', change: { expectedRevision: 3, values: EMPTY_GOODS_AFTER_SALES } });
    expect(planGoodsAfterSalesWorkbook([asRow({ mode: '전체 해제' })], '001', afterSales).kind).toBe('error');
    expect(planGoodsAfterSalesWorkbook([asRow({ phone: '', guide: '' })], '001', afterSales).kind).toBe('error');
  });
  it.each(['2', '-1', '3.0', '', '2147483648'])('rejects stale or invalid A/S revision %s', revision => {
    expect(planGoodsAfterSalesWorkbook([asRow({ revision })], '001', afterSales).kind).toBe('error');
  });
  it('rejects duplicate A/S rows and actual field limits', () => {
    expect(planGoodsAfterSalesWorkbook([asRow(), asRow()], '001', afterSales).kind).toBe('error');
    expect(planGoodsAfterSalesWorkbook([asRow({ guide: '가'.repeat(1301) })], '001', afterSales).kind).toBe('error');
    expect(planGoodsAfterSalesWorkbook([asRow({ guide: '😀'.repeat(1300) })], '001', afterSales).kind).toBe('save');
  });
  it('disable retains a populated table and never accepts hidden edited cells', () => {
    const row = { row: 5, values: { ...emptyGoodsSizeWorkbookRow(), goodCode: '001', mode: '표시 중지', revision: '2' } };
    expect(planGoodsSizeWorkbook([row], '001', sizeChart)).toMatchObject({ kind: 'save', change: { expectedRevision: 2, values: { ...sizeChart.values, enabled: false } } });
    expect(planGoodsSizeWorkbook([{ ...row, values: { ...row.values, note: '무시되면 안 됨' } }], '001', sizeChart).kind).toBe('error');
  });
  it('preserves order and normalizes decimals without converting units', () => {
    const rows = sizeRows().reverse(); rows.forEach(row => { row.values.unit = 'mm'; row.values.value1 = '10.0'; });
    expect(planGoodsSizeWorkbook(rows, '001', sizeChart)).toMatchObject({ kind: 'save', change: { values: { chart: { unit: 'mm',
      measurements: [{ name: '높이', values: ['10', '50'] }, { name: '너비', values: ['10', '20.5'] }] } } } });
  });
  it.each(['mismatched', 'gap', 'extra', 'duplicate', 'decimal', 'stale', 'eleven'])('rejects invalid size structure: %s', scenario => {
    const rows = sizeRows();
    if (scenario === 'mismatched') rows[1].values.note = '다른 안내';
    if (scenario === 'gap') rows.forEach(row => { row.values.size1 = ''; });
    if (scenario === 'extra') rows[0].values.value3 = '1';
    if (scenario === 'duplicate') rows[1].values.measurement = rows[0].values.measurement;
    if (scenario === 'decimal') rows[0].values.value1 = '1.23';
    if (scenario === 'stale') rows.forEach(row => { row.values.revision = '1'; });
    if (scenario === 'eleven') rows.push(...Array.from({ length: 9 }, () => structuredClone(rows[0])));
    expect(planGoodsSizeWorkbook(rows, '001', sizeChart).kind).toBe('error');
  });
  it('plans guidance only without rewriting or revalidating untouched legacy product values', () => {
    const rows = exportGoodsWorkbookRows(record, context).map(values => ({ row: 5, values }));
    const plan = planGoodsWorkbookImport(rows, { ...context, afterSalesRows: [asRow()] })[0];
    expect(plan).toMatchObject({ kind: 'update', guidanceOnly: true, fingerprint: 'fingerprint', images: [],
      target: { previous_id: 'guidance-test', code: '001' }, guidance: { afterSales: { expectedRevision: 3, values: { guide: '새 안내' } } } });
    expect(Object.keys(plan.target!)).toEqual(['previous_id', 'code']);
    expect(planGoodsWorkbookImport(rows, context)[0].kind).toBe('unchanged');
  });
  it('does not hide ordinary product edits or archived product restrictions in guidance-only mode', () => {
    const rows = exportGoodsWorkbookRows(record, context).map(values => ({ row: 5, values: { ...values, name: '변경 상품' } }));
    const plan = planGoodsWorkbookImport(rows, { ...context, afterSalesRows: [asRow()] })[0];
    expect(plan.kind).toBe('error'); expect(plan.guidanceOnly).toBeUndefined(); // Stored plain text may predate the current 2,000-character editing limit.
    const archived = { ...record, good: { ...record.good, archived_at: '2026-10-01' } };
    const archivedContext = { ...context, existing: [archived], afterSalesRows: [asRow()] };
    expect(planGoodsWorkbookImport(exportGoodsWorkbookRows(archived, archivedContext).map(values => ({ row: 5, values })), archivedContext)[0].errors.join(' ')).toContain('보관 상품');
  });
  it('plans new explicitly coded goods and rejects side rows without a matching product', () => {
    expect(planGoodsWorkbookImport([{ row: 5, values: product }], { ...context, existing: [], afterSalesRows: [asRow({ revision: '0' })] })[0])
      .toMatchObject({ kind: 'new', guidance: { afterSales: { expectedRevision: 0 } }, target: { code: '001' } });
    expect(() => planGoodsWorkbookImport([{ row: 5, values: product }], { ...context, afterSalesRows: [asRow({ goodCode: 'OTHER' })] })).toThrow('같은 상품코드');
  });
  it('keeps empty zero-revision snapshots absent and exports cleared revisions explicitly', () => {
    expect(exportGoodsAfterSalesWorkbookRows([{ goodCode: '001', snapshot: { ...afterSales, ...EMPTY_GOODS_AFTER_SALES, revision: 0, updatedAt: null } }])).toEqual([]);
    expect(exportGoodsAfterSalesWorkbookRows([{ goodCode: '001', snapshot: { ...afterSales, ...EMPTY_GOODS_AFTER_SALES } }])[0].mode).toBe('전체 해제');
    expect(exportGoodsSizeWorkbookRows([{ goodCode: '001', snapshot: { ...sizeChart, revision: 0, updatedAt: null, values: emptyGoodsSizeChartValues() } }])).toEqual([]);
  });
});

describe('actual v7 guidance workbook files', () => {
  it('round trips text codes, multiline A/S and every ordered size cell with explicit headers', async () => {
    const book = await bookWithGuidance();
    expect(book.getWorksheet(GOODS_AFTER_SALES_WORKBOOK_SHEET)!.getRow(4).values).toEqual([undefined, ...Object.values(GOODS_AFTER_SALES_WORKBOOK_HEADERS)]);
    expect(book.getWorksheet(GOODS_SIZE_WORKBOOK_SHEET)!.getRow(4).values).toEqual([undefined, ...Object.values(GOODS_SIZE_WORKBOOK_HEADERS)]);
    expect(book.getWorksheet(GOODS_AFTER_SALES_WORKBOOK_SHEET)!.getCell('A5').value).toBe('001');
    const parsed = await parseGoodsWorkbookWithKc(await bytes(book));
    expect(parsed.afterSalesRows?.map(row => row.values)).toEqual(asValues);
    expect(parsed.sizeRows?.map(row => row.values)).toEqual(sizeValues);
  });
  it('retains v6 custom input support but rejects new guidance sheets attached to a v6 workbook', async () => {
    const custom = { ...emptyGoodsCustomInputWorkbookRow(), goodCode: '001', mode: '전체 해제', revision: '0' };
    const book = new ExcelJS.Workbook(); await book.xlsx.load((await buildGoodsWorkbook([product], undefined, [], [custom])) as never);
    book.eachSheet(sheet => { if (sheet.name !== '작성 안내') sheet.getCell('A1').value = GOODS_WORKBOOK_V6_VERSION; });
    await expect(parseGoodsWorkbookWithKc(await bytes(book))).rejects.toThrow('v7');
    book.removeWorksheet(GOODS_AFTER_SALES_WORKBOOK_SHEET); book.removeWorksheet(GOODS_SIZE_WORKBOOK_SHEET);
    expect(await parseGoodsWorkbookWithKc(await bytes(book))).toMatchObject({ customInputRows: [{ values: custom }], afterSalesRows: null, sizeRows: null });
  });
  it('reports formula and numeric-code errors on their original side rows without evaluating formulas', async () => {
    const book = await bookWithGuidance();
    book.getWorksheet(GOODS_AFTER_SALES_WORKBOOK_SHEET)!.getCell('D5').value = { formula: '1+1', result: 2 };
    book.getWorksheet(GOODS_AFTER_SALES_WORKBOOK_SHEET)!.getCell('C5').value = 21234567;
    book.getWorksheet(GOODS_SIZE_WORKBOOK_SHEET)!.getCell('R5').value = { formula: '1+1', result: 2 };
    const parsed = await parseGoodsWorkbookWithKc(await bytes(book));
    expect(parsed.afterSalesRows?.[0].errors?.join()).toContain('수식'); expect(parsed.sizeRows?.[0].errors?.join()).toContain('수식');
    expect(parsed.afterSalesRows?.[0].errors?.join()).toContain('전화번호는 숫자 대신 텍스트');
    book.getWorksheet(GOODS_AFTER_SALES_WORKBOOK_SHEET)!.getCell('A5').value = 1;
    await expect(parseGoodsWorkbookWithKc(await bytes(book))).rejects.toThrow('같은 상품코드');
  });
  it('rejects orphan side rows, modified headers and excess row counts', async () => {
    const book = await bookWithGuidance(); book.getWorksheet(GOODS_SIZE_WORKBOOK_SHEET)!.getCell('A5').value = 'ORPHAN';
    await expect(parseGoodsWorkbookWithKc(await bytes(book))).rejects.toThrow('같은 상품코드');
    book.getWorksheet(GOODS_SIZE_WORKBOOK_SHEET)!.getCell('A4').value = '다른 열';
    await expect(parseGoodsWorkbookWithKc(await bytes(book))).rejects.toThrow('열 이름');
    await expect(buildGoodsWorkbook([product], undefined, [], [], Array.from({ length: 501 }, () => asValues[0]))).rejects.toThrow('500');
    await expect(buildGoodsWorkbook([product], undefined, [], [], [], Array.from({ length: 5001 }, () => sizeValues[0]))).rejects.toThrow('5,000');
  });
  it('does not deliver compressed files whose expanded contents cannot be read back', async () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({ ...product, code: String(i), description: String(i) + '가'.repeat(29000) }));
    await expect(buildGoodsWorkbook(rows)).rejects.toThrow('읽기 상한');
  });
});
