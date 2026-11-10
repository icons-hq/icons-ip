import { describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
vi.mock('server-only', () => ({}));
import { buildCustomerDemographicWorkbook } from './customer-demographics-workbook.server';
import { DEMOGRAPHIC_AGE_LABELS, type DemographicReport } from './customer-demographics';
describe('demographic workbook disclosure boundary', () => {
  it('exports only protected counts and no hidden totals or personal identifiers', async () => {
    const data: DemographicReport = { scope: 'members', grain: null, from: null, to: null, ageAsOf: '2026-10-19', minimumCount: 10, asOf: '2026-10-19T00:00:00Z',
      cells: Object.keys(DEMOGRAPHIC_AGE_LABELS).flatMap(ageBand => ['female', 'male', 'other', 'undisclosed'].map(gender => ({ ageBand, gender, count: null }))) as DemographicReport['cells'] };
    data.cells[0].count = 10;
    const book = new ExcelJS.Workbook(); await book.xlsx.load(await buildCustomerDemographicWorkbook(data) as never);
    const values = book.getWorksheet('성별·연령별 고객수')!.getSheetValues();
    expect(values).toHaveLength(42);
    expect(book.getWorksheet('성별·연령별 고객수')!.getCell('C2').value).toBe(10);
    expect(book.getWorksheet('성별·연령별 고객수')!.getCell('C3').value).toBe('비공개');
    expect(JSON.stringify(values)).not.toMatch(/userId|email|birth_date|rawCount|total/);
    data.cells[0].count = 9; await expect(buildCustomerDemographicWorkbook(data)).rejects.toThrow('Invalid protected');
  });
});
