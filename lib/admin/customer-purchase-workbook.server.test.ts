import { describe, expect, it, vi } from 'vitest';
import ExcelJS from 'exceljs';
vi.mock('server-only', () => ({}));
import { buildCustomerPurchaseWorkbook } from './customer-purchase-workbook.server';
import { customerPurchaseFixture } from './customer-purchase-report.fixture';
import { normalizeCustomerPurchaseFilters } from './customer-purchase-report';

describe('고객 구매 분석 엑셀', () => {
  it('비교6행·전체39행을 재열고 실제숫자·금액차이·기준을 확인한다', async () => {
    const now = new Date('2026-10-13T16:00:00Z');
    const buffer = await buildCustomerPurchaseWorkbook(customerPurchaseFixture(), normalizeCustomerPurchaseFilters({}, now), now);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(buffer as never);
    expect(book.worksheets.map(sheet => sheet.name)).toEqual(['조회·비교 기간', '13개월 월간 추이', '조회 정보']);
    expect(book.worksheets.map(sheet => sheet.rowCount).slice(0, 2)).toEqual([7, 40]);
    expect(book.worksheets[0].getCell('J2').value).toBe(36000);
    expect(book.worksheets[0].getCell('M2').value).toBe(34000);
    expect(book.worksheets[0].getCell('F3').value).toBe(100);
    expect(book.worksheets[0].getCell('F4').value).toBe(100);
    expect(book.worksheets[2].getSheetValues().flat().join(' ')).toContain('180일');
  });
  it('금액 불일치는 빈 셀과 확인 건수로 보존한다', async () => {
    const data = customerPurchaseFixture(); data.comparison = null;
    Object.assign(data.current.rows[0], { itemSubtotal: null, couponAmount: null, productSalesAmount: null, storeCreditAmount: null, cashProductAmount: null, averagePerCustomer: null, monetaryIssueOrderCount: 1 });
    const book = new ExcelJS.Workbook(); await book.xlsx.load(await buildCustomerPurchaseWorkbook(data, normalizeCustomerPurchaseFilters({ compare: 'off' }, new Date('2026-10-13T16:00:00Z'))) as never);
    expect(book.worksheets[0].rowCount).toBe(4); expect(book.worksheets[0].getCell('J2').value).toBeNull(); expect(book.worksheets[0].getCell('O2').value).toBe(1);
  });
});
