import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildShipmentExport } from './shipment-workbook.server';
import { DEFAULT_SHIPMENT_EXPORT_COLUMNS } from './shipment-workbook';
import type { ShipmentExportData } from './shipment-dispatch';

const line = { shipmentId: '00000000-0000-4000-8000-000000000001', orderId: '00000000-0000-4000-8000-000000000002',
  recipient: '=HYPERLINK("https://example.test")', phone: '01001234567', postalCode: '00123', address: '서울시, 상세주소',
  goodCode: '000123', variantCode: '000123-RED', goodName: '상품', optionName: '파랑', qty: 2, unitPrice: 12500, deliveryNote: '문 앞\n부탁합니다', carrier: '한진택배' };
const shipment = { id: line.shipmentId, updatedAt: '2026-09-08T00:00:00Z', originId: 'gimpo', originName: '김포', template: 'standard', shippingFee: 3000, columns: [...DEFAULT_SHIPMENT_EXPORT_COLUMNS], lines: [line] };
describe('shipment workbook exchange', () => {
  it('exports the seven Seowon headers and one row per shipment with unknown fields blank', async () => {
    const file = await buildShipmentExport({ shipments: [{ ...shipment, template: 'seowon_xlsx', lines: [
      { ...line, goodName: '합성 키링', optionName: '빨강' },
      { ...line, goodName: '합성 엽서', optionName: '', qty: 1 },
    ] }] }, 'xlsx');
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(file.bytes as never);
    const sheet = workbook.worksheets[0];
    expect(sheet.columnCount).toBe(7);
    expect(sheet.rowCount).toBe(2);
    expect(sheet.getRow(1).values).toEqual([undefined, '받는분전화번호', '받는분기타연락처', '받는분우편번호', '받는분주소(전체,분할)', '운임Type', '수량', '품목명']);
    expect(sheet.getRow(2).values).toEqual([undefined, '01001234567', '', '00123', '서울시, 상세주소', '', '', '합성 키링/빨강(2), 합성 엽서/(1)']);
    expect(sheet.getCell('A2').type).toBe(ExcelJS.ValueType.String);
    expect(sheet.getCell('C2').type).toBe(ExcelJS.ValueType.String);
  });
  it('exports the exact Gimpo columns from order snapshots and charges shipping only on each shipment first line', async () => {
    const gimpo = { ...shipment, template: 'wms_csv', lines: [
      { ...line, recipient: '합성 수취인', goodName: '합성 키링', optionName: '빨강' },
      { ...line, recipient: '합성 수취인', goodName: '합성 키링', optionName: '파랑', qty: 1, unitPrice: 9900 },
    ] };
    const file = await buildShipmentExport({ shipments: [gimpo, { ...gimpo, id: 'other-shipment', shippingFee: 1500, lines: [gimpo.lines[0]] }] }, 'xlsx');
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(file.bytes as never);
    const sheet = workbook.worksheets[0];
    expect(sheet.columnCount).toBe(21);
    expect(sheet.rowCount).toBe(4);
    expect(sheet.getRow(1).values).toEqual([undefined,
      '상품명(확정)+옵션(수집)+수량(조합용)', '상품명(확정)+옵션(확정)+수량(조합용)', '수취인주소(1)',
      '수취인명+쇼핑몰명(1)', '수취인전화번호1', '수취인전화번호2', '배송메세지', '주문번호(사방넷)',
      '주문번호(쇼핑몰)', '옵션별칭', '상품명(확정)', '옵션(수집)', '옵션(확정)', '공급단가', '주문금액/수량',
      '수량', 'EA(상품)', '수취인우편번호(1)', '수취인명', '배송비(수집)', '운송장번호',
    ]);
    expect(sheet.getRow(2).values).toEqual([undefined,
      '합성 키링/빨강(2)', ' 합성 키링/빨강(2)', '서울시, 상세주소', '합성 수취인/ICONS/', '01001234567', '',
      '문 앞\n부탁합니다', '', line.orderId, '', '합성 키링', '빨강', '빨강', '', 12500, 2, '', '00123', '합성 수취인', 3000, '',
    ]);
    expect(sheet.getCell('A3').value).toBe('합성 키링/파랑(1)');
    expect(sheet.getCell('O3').value).toBe(9900);
    expect(sheet.getCell('T3').value).toBe(0);
    expect(sheet.getCell('T4').value).toBe(1500);
    for (const address of ['E2', 'I2', 'R2']) expect(sheet.getCell(address).type).toBe(ExcelJS.ValueType.String);
    for (const address of ['O2', 'P2', 'T2']) expect(sheet.getCell(address).type).toBe(ExcelJS.ValueType.Number);
  });
  it('uses the same native profiles in CSV, retaining blanks and escaping formula-looking item names', async () => {
    const native = { ...shipment, lines: [{ ...line, recipient: '합성 수취인', goodName: '=합성,상품', optionName: '파랑', deliveryNote: '문 앞' }] };
    const seowon = await buildShipmentExport({ shipments: [{ ...native, template: 'seowon_xlsx' }] }, 'csv');
    expect(seowon.bytes.toString('utf8')).toBe('\uFEFF"받는분전화번호","받는분기타연락처","받는분우편번호","받는분주소(전체,분할)","운임Type","수량","품목명"\r\n'
      + '"01001234567","","00123","서울시, 상세주소","","","\'=합성,상품/파랑(2)"');
    const gimpo = await buildShipmentExport({ shipments: [{ ...native, template: 'wms_csv' }] }, 'csv');
    expect(gimpo.bytes.toString('utf8')).toBe('\uFEFF"상품명(확정)+옵션(수집)+수량(조합용)","상품명(확정)+옵션(확정)+수량(조합용)","수취인주소(1)","수취인명+쇼핑몰명(1)","수취인전화번호1","수취인전화번호2","배송메세지","주문번호(사방넷)","주문번호(쇼핑몰)","옵션별칭","상품명(확정)","옵션(수집)","옵션(확정)","공급단가","주문금액/수량","수량","EA(상품)","수취인우편번호(1)","수취인명","배송비(수집)","운송장번호"\r\n'
      + '"\'=합성,상품/파랑(2)","\' =합성,상품/파랑(2)","서울시, 상세주소","합성 수취인/ICONS/","01001234567","","문 앞","","00000000-0000-4000-8000-000000000002","","\'=합성,상품","파랑","파랑","","12500","2","","00123","합성 수취인","3000",""');
  });
  it('rejects unknown or conflicting profiles instead of silently exporting another warehouse format', async () => {
    await expect(buildShipmentExport({ shipments: [{ ...shipment, template: 'obsolete-profile' }] }, 'xlsx')).rejects.toThrow('양식');
    await expect(buildShipmentExport({ shipments: [shipment, { ...shipment, template: 'wms_csv' }] }, 'csv')).rejects.toThrow('양식');
  });
  it('rejects missing or invalid monetary snapshots instead of inventing a Gimpo price or shipping fee', async () => {
    const gimpo = { ...shipment, template: 'wms_csv' };
    for (const value of [undefined, NaN, -1, 0.5]) {
      await expect(buildShipmentExport({ shipments: [{ ...gimpo, shippingFee: value }] } as ShipmentExportData, 'csv')).rejects.toThrow('금액');
      await expect(buildShipmentExport({ shipments: [{ ...gimpo, lines: [{ ...line, unitPrice: value }] }] } as ShipmentExportData, 'csv')).rejects.toThrow('금액');
    }
  });
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
