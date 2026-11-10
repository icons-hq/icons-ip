import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { buildPgSettlementWorkbook } from './export.server';
import { settlementReportFixture } from './fixture';
import { normalizePgSettlementFilters } from './console';
const filters = normalizePgSettlementFilters({ from: '2026-10-01', to: '2026-10-31', mode: 'test' });
describe('settlement workbook', () => {
  it('reopens all four sheets with exact long decimals, safe string cells and snapshot provenance', async () => {
    const report = settlementReportFixture();
    report.transactions[0].amount = '9007199254740993.12345678'; report.transactions[0].method = '=1+1';
    const bytes = await buildPgSettlementWorkbook(report, filters, new Date('2026-10-13T13:00:00Z'));
    const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes as never);
    expect(book.worksheets.map(sheet => sheet.name)).toEqual(['건별 정산내역', '일별 정산내역', '수수료 내역', '조회 정보']);
    expect(book.worksheets[0].getCell('E2').value).toBe('9007199254740993.12345678');
    expect(book.worksheets[0].getCell('E2').numFmt).toBe('@');
    expect(book.worksheets[0].getCell('D2').type).toBe(ExcelJS.ValueType.String);
    expect(book.worksheets[0].getCell('D2').formula).toBeUndefined();
    expect(book.worksheets[1].getCell('D2').value).toBe(1);
    const values = JSON.stringify(book.worksheets[3].getSheetValues());
    expect(values).toContain(report.snapshot!.id); expect(values).toContain(report.fingerprint); expect(values).toContain('실입금');
    expect(JSON.stringify(book.worksheets.map(sheet => sheet.getSheetValues()))).not.toMatch(/paymentKey|scopeHash|mId|merchantId|profileId|상점 MID|프로필 ID|secretKey/);
  });
  it('exports a confirmed empty snapshot and refuses partial or over-limit rows', async () => {
    const report = settlementReportFixture(); report.snapshot!.recordCount = 0; report.coverage = 'empty'; report.transactions = []; report.daily = []; report.totals = []; report.fees = []; report.pagination.total = 0;
    const book = new ExcelJS.Workbook(); await book.xlsx.load(await buildPgSettlementWorkbook(report, filters, new Date()) as never);
    expect(book.worksheets[0].rowCount).toBe(1);
    await expect(buildPgSettlementWorkbook({ ...report, coverage: 'uncollected', snapshot: null }, filters, new Date())).rejects.toThrow('settlement_export_incomplete');
    await expect(buildPgSettlementWorkbook({ ...report, pagination: { ...report.pagination, total: 1 } }, filters, new Date())).rejects.toThrow('settlement_export_incomplete');
    const tooMany = Array(20001).fill(settlementReportFixture().transactions[0]);
    await expect(buildPgSettlementWorkbook({ ...report, transactions: tooMany, pagination: { ...report.pagination, total: 20001 } }, filters, new Date())).rejects.toThrow('settlement_export_incomplete');
  });
  it('exports and reopens the full 20,000-row boundary without truncating exact amounts', async () => {
    const report = settlementReportFixture();
    report.transactions = Array.from({ length: 20_000 }, (_, index) => ({ ...report.transactions[0], id: `record-${index}`, orderNumber: `order-${index}`, amount: '999999999999999999.12345678' }));
    report.pagination.total = 20_000;
    report.snapshot!.recordCount = 20_000;
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await buildPgSettlementWorkbook(report, filters, new Date()) as never);
    const sheet = book.worksheets[0];
    expect(sheet.rowCount).toBe(20_001);
    expect(sheet.getCell('A20001').value).toBe('order-19999');
    expect(sheet.getCell('E20001').value).toBe('999999999999999999.12345678');
    expect(sheet.getCell('E20001').numFmt).toBe('@');
  }, 30_000);
});
