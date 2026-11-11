import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { addSafeWorkbookInfoSheet, addWorkbookTable, tableColumn as column, workbookHeaderWidth } from './workbook-table';

async function reopen(book: ExcelJS.Workbook) {
  const reopened = new ExcelJS.Workbook(); await reopened.xlsx.load(await book.xlsx.writeBuffer() as never); return reopened;
}

describe('보고서형 표 쓰기', () => {
  it('머리글·열 서식·틀 고정·필터를 공용 표준으로 쓴다', async () => {
    const book = new ExcelJS.Workbook();
    addWorkbookTable(book, '표', [column('주문번호', 'code', 22), column('금액', 'amount'), column('수량', 'count'), column('주문일시', 'date')], [['0012', 1200, 3, '2026-10-01 09:00'], ['0013', null, 4, null]]);
    const sheet = (await reopen(book)).worksheets[0];
    expect(sheet.getCell('A1').font).toMatchObject({ name: '맑은 고딕', size: 10, bold: true });
    expect(sheet.getCell('A1').fill).toMatchObject({ fgColor: { argb: 'FFEFF2F0' } });
    expect(sheet.getRow(1).height).toBe(22);
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.autoFilter).toMatch(/A1:D3/);
    expect(sheet.getCell('A2').value).toBe('0012'); expect(sheet.getCell('A2').numFmt).toBe('@');
    expect(sheet.getCell('B2').value).toBe(1200); expect(sheet.getCell('B2').numFmt).toBe('#,##0'); expect(sheet.getCell('B2').alignment).toMatchObject({ horizontal: 'right' });
    expect(sheet.getCell('D2').numFmt).toBe('@'); expect(sheet.getCell('D3').value).toBeNull();
  });
  it('수식 문자열은 문자열로 남고 금액·수량의 소수나 문자는 빈칸이다', async () => {
    const book = new ExcelJS.Workbook();
    addWorkbookTable(book, '표', [column('이름'), column('금액', 'amount'), column('수량', 'count')], [['=HYPERLINK("https://example.test")', 10.5, '7']]);
    const sheet = (await reopen(book)).worksheets[0];
    expect(sheet.getCell('A2').type).toBe(ExcelJS.ValueType.String); expect(sheet.getCell('A2').value).toBe('=HYPERLINK("https://example.test")');
    expect(sheet.getCell('B2').value).toBeNull(); expect(sheet.getCell('C2').value).toBeNull();
  });
  it('number 칸은 소수와 문구를 지키고, 고정 서식을 주면 그 서식을 쓴다', async () => {
    const book = new ExcelJS.Workbook();
    addWorkbookTable(book, '표', [column('값', 'number'), column('사용률', 'number', 14, '0.0%')], [[12, 0.5], [3.25, null], ['비공개', 1], [Number.NaN, 0]]);
    const sheet = (await reopen(book)).worksheets[0];
    expect(sheet.getCell('A2').numFmt).toBe('#,##0'); expect(sheet.getCell('A3').value).toBe(3.25); expect(sheet.getCell('A3').numFmt).toBe('#,##0.00');
    expect(sheet.getCell('A4').value).toBe('비공개'); expect(sheet.getCell('A4').numFmt).toBe('@'); expect(sheet.getCell('A5').value).toBeNull();
    expect(sheet.getCell('B2').value).toBe(0.5); expect(sheet.getCell('B2').numFmt).toBe('0.0%');
  });
  it('0건이면 머리글만 남고, 긴 머리글은 잘리지 않을 너비를 갖는다', async () => {
    const book = new ExcelJS.Workbook();
    addWorkbookTable(book, '표', [column('아주 긴 머리글 이름입니다', 'text', 5)], []);
    const sheet = (await reopen(book)).worksheets[0];
    expect(sheet.rowCount).toBe(1); expect(sheet.autoFilter).toBeTruthy();
    expect(sheet.getColumn(1).width).toBe(workbookHeaderWidth('아주 긴 머리글 이름입니다'));
  });
  it('내려받기 정보 시트는 값을 문구로 적고 제어문자를 걷어낸다', async () => {
    const book = new ExcelJS.Workbook();
    addSafeWorkbookInfoSheet(book, [['건수', 12], ['검색어', '=1+1\u0001'], ['빈 값', '']]);
    const sheet = (await reopen(book)).worksheets[0];
    expect(sheet.name).toBe('내려받기 정보');
    expect(sheet.getCell('B1').value).toBe('12'); expect(sheet.getCell('B2').value).toBe('=1+1'); expect(sheet.getCell('B2').type).toBe(ExcelJS.ValueType.String);
    expect(sheet.getCell('A1').font).toMatchObject({ name: '맑은 고딕', size: 10, bold: true }); expect(sheet.getCell('B3').value).toBeFalsy();
  });
});
