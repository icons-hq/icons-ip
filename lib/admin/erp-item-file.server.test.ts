import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildErpImportPlan } from './erp-item-import';
import { readErpItemFile, readErpWorkbookCell } from './erp-item-file.server';

async function workbookBytes(build: (sheet: ExcelJS.Worksheet, workbook: ExcelJS.Workbook) => void): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('품목');
  build(sheet, workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('ERP 품목 XLSX 읽기', () => {
  it('제목 행·숫자 셀·0 채움 서식을 문자열 표로 읽고 미리보기와 이어진다', async () => {
    const bytes = await workbookBytes((sheet) => {
      sheet.getCell('A1').value = 'ERP 품목 생성 현황';
      sheet.getRow(3).values = ['품목코드', '품목명', '품목그룹1', '품목그룹2', '출고단가', '바코드'];
      sheet.getRow(4).values = [123, '아크릴 키링', '문구', '키링', 12000, '0088012345678'];
      sheet.getCell('A4').numFmt = '000000';
      sheet.getRow(5).values = ['K-2', { richText: [{ text: '키링 ' }, { text: '거치대' }] }, '문구', '', { formula: 'E4-4000', result: 8000 }, 8801234567890];
    });
    const read = await readErpItemFile('품목.xlsx', bytes);
    expect(read.sheetName).toBe('품목');
    expect(read.table[0]).toEqual(['ERP 품목 생성 현황']);
    expect(read.table[1]).toEqual([]);
    expect(read.table[3]).toEqual(['000123', '아크릴 키링', '문구', '키링', '12000', '0088012345678']);
    expect(read.table[4]).toEqual(['K-2', '키링 거치대', '문구', '', '', '8801234567890']);
    expect(read.numericColumns).toEqual([0, 4, 5]);
    expect(read.warnings[0]).toContain('수식 셀 1개(E5)');

    const plan = buildErpImportPlan(read.table, { numericColumns: read.numericColumns });
    expect(plan.headerIndex).toBe(2);
    expect(plan.rows).toEqual([
      { row: 4, code: '000123', name: '아크릴 키링', category: '문구 > 키링', salePrice: 12000, barcode: '0088012345678' },
      { row: 5, code: 'K-2', name: '키링 거치대', category: '문구', salePrice: null, barcode: '8801234567890' },
    ]);
    expect(plan.warnings.join('\n')).toContain('바코드 열에 숫자 형식 셀이 있습니다');
  });

  it('숨긴 시트를 건너뛰고 값이 있는 첫 시트를 읽는다', async () => {
    const bytes = await workbookBytes((sheet, workbook) => {
      sheet.state = 'hidden';
      sheet.getCell('A1').value = '숨김';
      workbook.addWorksheet('빈 시트');
      const visible = workbook.addWorksheet('ERP');
      visible.getRow(1).values = ['품번', '품명'];
    });
    expect(await readErpItemFile('a.xlsx', bytes)).toMatchObject({ sheetName: 'ERP', table: [['품번', '품명']] });
  });

  it('지수 표기 없이 큰 정수를 읽고 정밀도를 잃은 셀을 알린다', () => {
    expect(readErpWorkbookCell({ value: 8801234567890, numFmt: 'General', text: '8.80123E+12' })).toEqual({ text: '8801234567890', numeric: true, lossy: false });
    expect(readErpWorkbookCell({ value: 1e21, numFmt: '', text: '' })).toMatchObject({ text: '1000000000000000000000', lossy: true });
    expect(readErpWorkbookCell({ value: 12.5, numFmt: '', text: '' })).toEqual({ text: '12.5', numeric: true });
    expect(readErpWorkbookCell({ value: { error: '#N/A' } as ExcelJS.CellErrorValue, numFmt: '', text: '' })).toEqual({ text: '' });
    expect(readErpWorkbookCell({ value: new Date('2026-10-07T00:00:00Z'), numFmt: '', text: '' })).toEqual({ text: '2026-10-07' });
  });

  it('행 수·형식 상한을 넘으면 한국어 안내로 거절한다', async () => {
    const csv = ['품번,품명', ...Array.from({ length: 5_200 }, (_, index) => `C${index},품목`)].join('\n');
    await expect(readErpItemFile('a.csv', Buffer.from(csv))).rejects.toThrow('5,000행까지');
    await expect(readErpItemFile('a.pdf', Buffer.from('x'))).rejects.toThrow('XLSX 또는 CSV 파일을 올려주세요.');
    await expect(readErpItemFile('a.csv', Buffer.alloc(0))).rejects.toThrow('900KB');
  });
});
