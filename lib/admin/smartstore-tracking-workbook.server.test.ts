import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseTrackingWorkbook } from './tracking-workbook.server';
import { trackingImportCommand } from './warehouse-templates.server';

const item = '60000000-0000-4000-8000-000000000001';
const other = '60000000-0000-4000-8000-000000000002';
const headers = ['송장번호', '상품주문번호', '배송방법', '택배사'];
const carriers = [{ code: 'hanjin', label: '한진택배', active: true, trackingUrlTemplate: 'https://example.test/{trackingNumber}' },
  { code: 'inactive', label: '비활성택배', active: false, trackingUrlTemplate: 'https://example.test/{trackingNumber}' }];
async function bytes(rows: unknown[][], name = '발송처리', columns = headers) {
  const book = new ExcelJS.Workbook(); book.addWorksheet(name).addRows([columns, ...rows]);
  return Buffer.from(await book.xlsx.writeBuffer());
}

describe('Smart Store four-column tracking replies', () => {
  it('accepts reordered required columns and registered carrier names without guessing shipment IDs', async () => {
    const parsed = await parseTrackingWorkbook(await bytes([['001234567890', item, '택배, 등기, 소포', '한진택배']]), carriers);
    expect(parsed.issues).toEqual([]);
    expect(trackingImportCommand(parsed, '')).toEqual({ name: 'admin_import_item_tracking_batch', args: { target_rows: [
      { line: 2, reference: item, carrier: 'hanjin', trackingNumber: '001234567890' },
    ] } });
  });
  it('retains invalid item siblings and original file order in the atomic batch command', async () => {
    const parsed = await parseTrackingWorkbook(await bytes([[1234567890, item, '택배,등기,소포', 'hanjin'], ['001234567890', other, '택배,등기,소포', 'hanjin']]), carriers);
    expect(parsed.rows).toHaveLength(1); expect(parsed.issues[0]).toMatchObject({ line: 2, reference: item });
    expect(trackingImportCommand(parsed, '').args.target_rows).toEqual([
      { line: 2, reference: item, carrier: '', trackingNumber: '' },
      { line: 3, reference: other, carrier: 'hanjin', trackingNumber: '001234567890' },
    ]);
  });
  it('rejects non-parcel delivery, inactive carriers, numeric IDs, formulas and short references', async () => {
    const parsed = await parseTrackingWorkbook(await bytes([
      ['001234567890', item, '방문수령', 'hanjin'],
      ['001234567890', other, '택배,등기,소포', 'inactive'],
      ['001234567890', 2026102012345678, '택배,등기,소포', 'hanjin'],
      [{ formula: '1+1' }, item, '택배,등기,소포', 'hanjin'],
      ['001234567890', '00000001', '택배,등기,소포', 'hanjin'],
    ]), carriers);
    expect(parsed.rows).toEqual([]);
    expect(parsed.issues.map(issue => issue.line)).toEqual([2, 3, 4, 5, 6]);
    expect(parsed.issues[0].reason).toContain('주문 상세');
    expect(parsed.issues[3].reason).toContain('수식');
  });
  it('requires the dispatch sheet name and exactly one of each required header', async () => {
    await expect(parseTrackingWorkbook(await bytes([['001234567890', item, '택배,등기,소포', 'hanjin']], '발주발송관리'), carriers)).rejects.toThrow('시트명');
    await expect(parseTrackingWorkbook(await bytes([], '발송처리', ['상품주문번호', '배송방법', '택배사', '송장번호', '송장번호']), carriers)).rejects.toThrow('각각 하나');
    await expect(parseTrackingWorkbook(await bytes([], '발송처리', ['상품주문번호', '배송방법', '송장번호']), carriers)).rejects.toThrow('각각 하나');
    const book = new ExcelJS.Workbook();book.addWorksheet('발송처리').addRow([...headers, { formula: '1+1' }]);
    await expect(parseTrackingWorkbook(Buffer.from(await book.xlsx.writeBuffer()), carriers)).rejects.toThrow('헤더의 수식');
  });
});
