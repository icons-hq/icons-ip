import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { settledExportFixture } from '@/test/fixtures/settled-export';
import { buildSettledWorkbook, SETTLED_EXPORT_HEADERS } from './settled-workbook.server';
import { loadSafeWorkbook, readSafeWorkbookCell } from './workbook-safety';

describe('거래확정 XLSX 파일', () => {
  it('8필수열·식별자·수식문자열·KST 자료형과 두 원장 합계를 실제 파일에서 보존한다', async () => {
    const bytes = await buildSettledWorkbook(settledExportFixture());
    const workbook = await loadSafeWorkbook(bytes, { fileBytes: 2 * 1024 * 1024 });
    const detail = workbook.getWorksheet('거래확정 품목')!;
    expect(detail.getRow(6).values).toEqual([undefined, ...SETTLED_EXPORT_HEADERS]);
    expect(detail.getCell('B7').type).toBe(ExcelJS.ValueType.String);
    expect(readSafeWorkbookCell(detail.getCell('C7'), true)).toEqual({ value: '000012345678' });
    expect(readSafeWorkbookCell(detail.getCell('N7'), true)).toEqual({ value: '0004951' });
    expect(detail.getCell('D7').type).toBe(ExcelJS.ValueType.String);
    expect(readSafeWorkbookCell(detail.getCell('D7'))).toEqual({ value: '=HYPERLINK("https://example.test","합성 ERP")' });
    expect(detail.getCell('A7').type).toBe(ExcelJS.ValueType.Date);
    expect((detail.getCell('H7').value as Date).toISOString()).toBe('2026-09-02T10:02:03.000Z');
    expect(detail.getCell('F10').value).toEqual({ formula: 'IF(COUNT(F7:F9)=ROWS(F7:F9),SUM(F7:F9),"")', result: 27001 });
    expect(detail.getCell('G10').result).toBe(5000);
    expect(detail.getCell('L10').result).toBe(1001);
    expect(detail.getCell('M10').result).toBe(1000);
    const order = workbook.getWorksheet('주문 대조')!;
    expect(order.getCell('J7').value).toBe(32001);
    expect(order.getCell('M7').value).toBe(32001);
    expect(order.getCell('N7').value).toBe(32001);
    expect(order.getCell('O7').value).toBe(0);
    expect(order.getCell('P7').value).toBe(0);
    expect(detail.views[0]).toMatchObject({ state: 'frozen', ySplit: 6, xSplit: 2 });
    expect(detail.autoFilter).toBeTruthy();
  });
  it('미기록 금액과 미완전 열의 합계를 빈칸으로 보존한다', async () => {
    const source = settledExportFixture(); source.orders[0].coupon!.terms = null;
    source.orders[0].items[0].erpName = null;
    source.orders[0].payments[0].approvedAt = null;
    const bytes = await buildSettledWorkbook(source);
    const workbook = await loadSafeWorkbook(bytes, { fileBytes: 2 * 1024 * 1024 });
    const detail = workbook.getWorksheet('거래확정 품목')!;
    expect(detail.getCell('D7').value).toBeNull();
    expect(detail.getCell('F7').value).toBeNull();
    expect(detail.getCell('H7').value).toBeNull();
    expect(detail.getCell('F10').result ?? '').toBe('');
    expect(String(detail.getCell('U7').value)).toContain('쿠폰 대상·금액');
    expect(workbook.getWorksheet('주문 대조')!.getCell('J7').value).toBe(32001);
  });
});
