import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildGoodsWorkbook, parseGoodsWorkbook, parseGoodsWorkbookWithKc } from './goods-workbook-file';
import { emptyGoodsKcWorkbookRow, GOODS_KC_WORKBOOK_SHEET } from './goods-kc-workbook';
import {
  emptyGoodsWorkbookRow,
  GOODS_WORKBOOK_HEADERS,
} from './goods-workbook';
const values = {
  ...emptyGoodsWorkbookRow(),
  code: '00001',
  name: '상품',
  ipId: 'ip',
  price: '0',
  variantPrice: '12000',
  stockQty: '0',
  noticeMadeOn: '2026-09',
  description: '두 줄\n설명',
};
describe('real xlsx boundary', () => {
  it('keeps KC model rows and textual option identifiers in a separate re-uploadable sheet', async () => {
    const kc = { ...emptyGoodsKcWorkbookRow(), goodCode: values.code, modelIndex: '1', variantCodes: '00001-01\n00001-02',
      family: '그 외', scheme: '해당 없음', modelName: 'TEST 전용 모델', publicNote: '첫 줄\n둘째 줄', basis: 'TEST 적용근거' };
    const bytes = await buildGoodsWorkbook([values], undefined, [kc]);
    expect(await parseGoodsWorkbookWithKc(bytes)).toMatchObject({ rows: [{ values }], kcRows: [{ row: 5, values: kc }] });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as never);
    expect(book.getWorksheet(GOODS_KC_WORKBOOK_SHEET)?.getCell('C5').value).toBe('00001-01\n00001-02');
    book.getWorksheet(GOODS_KC_WORKBOOK_SHEET)!.getCell('A5').value = { formula: '1+1', result: 2 };
    await expect(parseGoodsWorkbookWithKc(Buffer.from(await book.xlsx.writeBuffer()))).rejects.toThrow('수식');
  });
  it('round trips typed money, textual codes, blanks and multiline descriptions losslessly', async () => {
    const bytes = await buildGoodsWorkbook([values]);
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
    expect(await parseGoodsWorkbook(bytes)).toEqual([
      { row: 5, values, errors: [] },
    ]);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as never);
    expect(book.getWorksheet('상품')?.getCell('A5').value).toBe('00001');
    expect(book.getWorksheet('상품')?.getCell('G5').value).toBe(0);
    expect(book.getWorksheet('상품')?.views[0]).toMatchObject({
      state: 'frozen',
      xSplit: 2,
      ySplit: 4,
    });
  });
  it('reports formulas by original row without evaluating them', async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await buildGoodsWorkbook([values])) as never);
    book.getWorksheet('상품')!.getCell('G5').value = {
      formula: '1+1',
      result: 2,
    };
    const rows = await parseGoodsWorkbook(
      Buffer.from(await book.xlsx.writeBuffer()),
    );
    expect(rows[0].row).toBe(5);
    expect((rows[0].errors ?? []).join()).toContain('수식');
  });
  it('rejects mismatched headers and over 500 populated option rows', async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await buildGoodsWorkbook([values])) as never);
    book.getWorksheet('상품')!.getCell('A4').value = '잘못된 열';
    await expect(
      parseGoodsWorkbook(Buffer.from(await book.xlsx.writeBuffer())),
    ).rejects.toThrow('양식');
    await expect(
      buildGoodsWorkbook(Array.from({ length: 501 }, () => values)),
    ).rejects.toThrow('500');
  });
  it('exports only failed rows and retains the same re-uploadable headers', async () => {
    const bytes = await buildGoodsWorkbook([values], ['재고가 바뀌었습니다.']);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as never);
    expect(book.getWorksheet('상품')!.getRow(4).values).toContain(
      Object.values(GOODS_WORKBOOK_HEADERS)[0],
    );
    expect((await parseGoodsWorkbook(bytes))[0].values).toEqual(values);
  });
  it('round trips the full 500-row limit within the server processing budget', async () => {
    const rows = Array.from({ length: 500 }, (_, index) => ({
      ...values,
      code: `CODE-${String(index).padStart(4, '0')}`,
      name: `상품 ${index}`,
      stockQty: String(index),
    }));
    const started = performance.now();
    const bytes = await buildGoodsWorkbook(rows);
    expect((await parseGoodsWorkbook(bytes)).map((row) => row.values)).toEqual(
      rows,
    );
    expect(bytes.length).toBeLessThan(2 * 1024 * 1024);
    expect(performance.now() - started).toBeLessThan(10000);
  });
});
