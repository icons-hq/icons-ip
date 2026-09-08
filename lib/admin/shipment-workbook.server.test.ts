import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildShipmentExport } from './shipment-workbook.server';
import { DEFAULT_SHIPMENT_EXPORT_COLUMNS } from './shipment-workbook';
import type { ShipmentExportData } from './shipment-dispatch';

const line = { shipmentId: '00000000-0000-4000-8000-000000000001', orderId: '00000000-0000-4000-8000-000000000002',
  recipient: '=HYPERLINK("https://example.test")', phone: '01001234567', postalCode: '00123', address: '서울시, 상세주소',
  goodCode: '000123', variantCode: '000123-RED', goodName: '상품', optionName: '파랑', qty: 2, deliveryNote: '문 앞\n부탁합니다', carrier: '한진택배' };
const shipment = { id: line.shipmentId, updatedAt: '2026-09-08T00:00:00Z', originId: 'gimpo', originName: '김포', template: 'wms_csv', columns: [...DEFAULT_SHIPMENT_EXPORT_COLUMNS], lines: [line] };
describe('shipment workbook exchange', () => {
  it('round-trips distinct optional SKU strings with a custom warehouse header', async () => {
    const columns=[{key:'variantCode' as const,header:'WMS SKU'},...DEFAULT_SHIPMENT_EXPORT_COLUMNS];
    const file=await buildShipmentExport({shipments:[{...shipment,columns,lines:[line,{...line,variantCode:'000124-BLUE',optionName:'파랑'}]}]},'xlsx');
    const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(file.bytes as never);
    const sheet=workbook.worksheets[0];
    expect(sheet.getCell('A1').value).toBe('WMS SKU');
    expect(sheet.getCell('A2').value).toBe('000123-RED');
    expect(sheet.getCell('A3').value).toBe('000124-BLUE');
    expect(sheet.getCell('A2').type).toBe(ExcelJS.ValueType.String);
    expect(sheet.getCell('H2').value).toBe('000123');
    expect(sheet.getCell('H3').value).toBe('000123');
  });
  it('exports valid warehouse names that end in a quotation mark', async () => {
    const file = await buildShipmentExport({ shipments: [{ ...shipment, originName: "작가 '창고'" }] }, 'xlsx');
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(file.bytes as never);
    expect(workbook.worksheets).toHaveLength(1);
    expect(workbook.worksheets[0].getCell('A2').value).toBe(line.shipmentId);
  });
  it('round-trips IDs, leading zeros and formula-looking text as literal XLSX strings', async () => {
    const file = await buildShipmentExport({ shipments: [shipment] }, 'xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.bytes as never);
    const sheet = workbook.worksheets[0];
    for (const {key} of shipment.columns) {
      const expected=line[key];
      const column = shipment.columns.findIndex((candidate) => candidate.key === key) + 1;
      expect(sheet.getCell(2, column).value).toBe(expected);
      expect(sheet.getCell(2, column).type).toBe(key === 'qty' ? ExcelJS.ValueType.Number : ExcelJS.ValueType.String);
    }
  });
  it('uses separate warehouse sheets and preserves each configured column order', async () => {
    const second = { ...shipment, id: 'second', originId: 'namyangju', originName: '남양주', columns: [...shipment.columns].reverse() };
    const file = await buildShipmentExport({ shipments: [shipment, second] }, 'xlsx');
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(file.bytes as never);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['1-김포', '2-남양주']);
    expect(workbook.worksheets[1].getCell('A1').value).toBe('택배사');
    expect(workbook.worksheets[1].getCell('A2').value).toBe('한진택배');
  });
  it('rejects mixed warehouse CSV and invalid export data before producing a file', async () => {
    await expect(buildShipmentExport({ shipments: [shipment, { ...shipment, originId: 'second' }] }, 'csv')).rejects.toThrow('출고지를 하나');
    await expect(buildShipmentExport({ shipments: [{ ...shipment, lines: [] }] }, 'xlsx')).rejects.toThrow('상품 정보');
    await expect(buildShipmentExport({ shipments: [{ ...shipment, columns: [] }] } as ShipmentExportData, 'xlsx')).rejects.toThrow('양식');
  });
});
