import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { buildShipmentExport } from './shipment-workbook.server';
import { DEFAULT_SHIPMENT_EXPORT_COLUMNS } from './shipment-workbook';
import type { ShipmentExportData } from './shipment-dispatch';
import { parseTrackingWorkbook, type TrackingWorkbookParseResult } from './tracking-workbook.server';
import { trackingImportCommand, type SeowonTrackingParseResult, type WarehouseTrackingParseResult } from './warehouse-templates.server';
import { SEOWON_EXPORT_HEADERS } from './warehouse-templates';
import { matchSeowonReply } from './seowon-exchange';

function native<T extends WarehouseTrackingParseResult | SeowonTrackingParseResult>(parsed: TrackingWorkbookParseResult, kind: T['kind']): T {
  if (!('kind' in parsed) || parsed.kind !== kind) throw new Error(`expected ${kind} reply`);
  return parsed as T;
}
async function loadXlsx(bytes: Buffer) { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes as never); return workbook; }

const line = { shipmentId: '00000000-0000-4000-8000-000000000001', orderId: '00000000-0000-4000-8000-000000000002',
  recipient: '=HYPERLINK("https://example.test")', phone: '01001234567', postalCode: '00123', address: '서울시, 상세주소',
  goodCode: '000123', variantCode: '000123-RED', goodName: '상품', optionName: '파랑', qty: 2, unitPrice: 12500, deliveryNote: '문 앞\n부탁합니다', carrier: '한진택배' };
const shipment = { id: line.shipmentId, updatedAt: '2026-09-08T00:00:00Z', originId: 'gimpo', originName: '김포', template: 'standard', shippingFee: 3000, columns: [...DEFAULT_SHIPMENT_EXPORT_COLUMNS], lines: [line] };
describe('shipment workbook exchange', () => {
  it('round-trips a generated Gimpo export into an origin-scoped tracking command without losing IDs or leading zeros', async () => {
    const originId = '00000000-0000-4000-8000-000000000099';
    const secondOrder = '00000000-0000-4000-8000-000000000043';
    const gimpo = { ...shipment, originId, template: 'wms_csv', lines: [line, { ...line, optionName: '빨강' }] };
    const file = await buildShipmentExport({ shipments: [gimpo, { ...gimpo, lines: [{ ...line, orderId: secondOrder }] }] }, 'xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.bytes as never);
    const sheet = workbook.worksheets[0];
    for (let index = 2; index <= sheet.rowCount; index++) sheet.getCell(`U${index}`).value = '001234567890';
    const parsed = native<WarehouseTrackingParseResult>(await parseTrackingWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), []), 'gimpo');
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows.map(row => row.reference)).toEqual([line.orderId, line.orderId, secondOrder]);
    expect(trackingImportCommand(parsed, originId)).toEqual({
      name: 'admin_import_warehouse_tracking_batch', args: { target_origin_id: originId, target_rows: [
        { line: 2, reference: line.orderId, trackingNumber: '001234567890' },
        { line: 3, reference: line.orderId, trackingNumber: '001234567890' },
        { line: 4, reference: secondOrder, trackingNumber: '001234567890' },
      ] },
    });
    expect(() => trackingImportCommand(parsed, '')).toThrow('출고지를 선택');
  });
  it('exports the Seowon 송장양식 exactly: sheet, 7 original headers, widths, colours and one row per item', async () => {
    const file = await buildShipmentExport({ shipments: [{ ...shipment, originName: '남양주', template: 'seowon_xlsx', lines: [
      { ...line, recipient: '합성 수취인', goodName: '합성 키링', optionName: '빨강' },
      { ...line, recipient: '합성 수취인', goodName: '합성 엽서', optionName: '', qty: 1 },
    ] }] }, 'xlsx', '2026-10-12');
    expect(file.name).toBe('ICONS-출고지시-2026-10-12-남양주.xlsx');
    const workbook = await loadXlsx(file.bytes);
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(['송장양식']);
    const sheet = workbook.worksheets[0];
    expect(sheet.getRow(1).values).toEqual([undefined, '받는분전화번호', '받는분기타연락처', '받는분우편번호', '받는분주소(전체,분할)', '운임Type', '수량', '품목명', '받는분성명', '배송메시지']);
    expect(sheet.rowCount).toBe(3);
    expect(sheet.getRow(2).values).toEqual([undefined, '010-0123-4567', '', '00123', '서울시, 상세주소', '', 2, '합성 키링_빨강', '합성 수취인', '문 앞 부탁합니다']);
    expect(sheet.getRow(3).values).toEqual([undefined, '010-0123-4567', '', '00123', '서울시, 상세주소', '', 1, '합성 엽서_', '합성 수취인', '문 앞 부탁합니다']);
    expect([1, 2, 3, 4, 5, 6, 7].map(column => sheet.getColumn(column).width)).toEqual([18.3984375, 21, 18.3984375, 83.3984375, 11.69921875, 6.59765625, 62.5]);
    const fill = (address: string) => (sheet.getCell(address).fill as ExcelJS.FillPattern).fgColor;
    expect(['A1', 'D1'].map(fill)).toEqual([{ argb: 'FFFFFF00' }, { argb: 'FFFFFF00' }]);
    expect(['B1', 'C1', 'E1'].map(fill)).toEqual(Array(3).fill({ theme: 0, tint: -0.14999847407452621 }));
    expect(['F1', 'G1', 'F2', 'G2'].map(fill)).toEqual(Array(4).fill({ argb: 'FF92D050' }));
    expect(sheet.getCell('A1').font).toMatchObject({ name: '맑은 고딕', size: 10, bold: true });
    expect(sheet.getCell('D2').font).toMatchObject({ name: '맑은 고딕', size: 10 });
    // ExcelJS strips the escapes when re-reading; the written styles.xml keeps the original code.
    expect(await (await JSZip.loadAsync(file.bytes)).file('xl/styles.xml')!.async('string')).toContain('formatCode="#,##0_);[Red]\\(#,##0\\)"');
    expect(sheet.getCell('A2').numFmt).toBe('@');
    expect(sheet.getCell('G1').alignment).toMatchObject({ horizontal: 'left', vertical: 'middle' });
    for (const address of ['A2', 'C2', 'G2']) expect(sheet.getCell(address).type).toBe(ExcelJS.ValueType.String);
    expect(sheet.getCell('F2').type).toBe(ExcelJS.ValueType.Number);
  });
  it('round-trips a Seowon export with a 송장번호 column back to the exported shipments without order numbers', async () => {
    const lines = [{ ...line, goodName: '합성 키링', optionName: '빨강' }, { ...line, goodName: '합성 엽서', optionName: '', qty: 1 }];
    const second = { ...line, shipmentId: '00000000-0000-4000-8000-000000000003', orderId: '00000000-0000-4000-8000-000000000004', phone: '0212345678', goodName: '합성 키링', optionName: '빨강', qty: 1 };
    const seowon = { ...shipment, template: 'seowon_xlsx', lines };
    const file = await buildShipmentExport({ shipments: [seowon, { ...seowon, id: second.shipmentId, lines: [second] }] }, 'xlsx');
    const workbook = await loadXlsx(file.bytes);
    const sheet = workbook.worksheets[0];
    expect(sheet.getCell('A4').value).toBe('02-1234-5678');
    sheet.getCell('J1').value = '송장번호';
    sheet.getCell('J2').value = '6012345678901'; sheet.getCell('J3').value = 6012345678901; sheet.getCell('J4').value = '6012-3456-7890-2';
    const parsed = native<SeowonTrackingParseResult>(await parseTrackingWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()), []), 'seowon');
    expect(parsed.rows.map(row => [row.line, row.trackingNumber, row.error])).toEqual([[2, '6012345678901', undefined], [3, '6012345678901', undefined], [4, '6012345678902', undefined]]);
    const match = matchSeowonReply(parsed.rows, [
      { id: line.shipmentId, orderId: line.orderId, status: 'ready', trackingNumber: null, lines },
      { id: second.shipmentId, orderId: second.orderId, status: 'ready', trackingNumber: null, lines: [second] },
    ]);
    expect(match.issues).toEqual([]);
    expect(match.commands).toEqual([
      { line: 2, shipmentId: line.shipmentId, orderId: line.orderId, trackingNumber: '6012345678901', lines: [2, 3] },
      { line: 4, shipmentId: second.shipmentId, orderId: second.orderId, trackingNumber: '6012345678902', lines: [4] },
    ]);
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
    const nativeShipment = { ...shipment, lines: [{ ...line, recipient: '합성 수취인', goodName: '=합성,상품', optionName: '파랑', deliveryNote: '문 앞' }] };
    // 서원 송장양식은 XLSX 양식이고 회신도 XLSX로만 받으므로 CSV를 골라도 XLSX로 만든다.
    const seowon = await buildShipmentExport({ shipments: [{ ...nativeShipment, template: 'seowon_xlsx' }] }, 'csv', '2026-10-12');
    expect([seowon.extension, seowon.name]).toEqual(['xlsx', 'ICONS-출고지시-2026-10-12-김포.xlsx']);
    expect((await loadXlsx(seowon.bytes)).worksheets[0].getCell('G2').value).toBe('=합성,상품_파랑');
    const gimpo = await buildShipmentExport({ shipments: [{ ...nativeShipment, template: 'wms_csv' }] }, 'csv');
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
  it('downloads several warehouses as one ZIP of per-warehouse files so 서원 never receives 김포 rows', async () => {
    const second = { ...shipment, id: 'second', originId: 'namyangju', originName: '남양주', template: 'seowon_xlsx', lines: [{ ...line, recipient: '남양주 수취인' }] };
    const file = await buildShipmentExport({ shipments: [shipment, second] }, 'xlsx', '2026-10-12');
    expect([file.extension, file.mime, file.name]).toEqual(['zip', 'application/zip', 'ICONS-출고지시-2026-10-12-출고지별.zip']);
    const zip = await JSZip.loadAsync(file.bytes);
    expect(Object.keys(zip.files).sort()).toEqual(['ICONS-출고지시-2026-10-12-김포.xlsx', 'ICONS-출고지시-2026-10-12-남양주.xlsx']);
    const gimpo = await loadXlsx(await zip.file('ICONS-출고지시-2026-10-12-김포.xlsx')!.async('nodebuffer'));
    const seowon = await loadXlsx(await zip.file('ICONS-출고지시-2026-10-12-남양주.xlsx')!.async('nodebuffer'));
    expect(gimpo.worksheets.map(sheet => sheet.name)).toEqual(['1-김포']);
    expect(gimpo.worksheets[0].getCell('A2').value).toBe(line.shipmentId);
    expect(seowon.worksheets.map(sheet => sheet.name)).toEqual(['송장양식']);
    expect(seowon.worksheets[0].getRow(1).values).toEqual([undefined, ...SEOWON_EXPORT_HEADERS]);
    expect(seowon.worksheets[0].rowCount).toBe(2);
    expect(seowon.worksheets[0].getCell('H2').value).toBe('남양주 수취인');
    const csv = await JSZip.loadAsync((await buildShipmentExport({ shipments: [shipment, { ...shipment, originId: 'second', originName: '김포' }] }, 'csv', '2026-10-12')).bytes);
    expect(Object.keys(csv.files).sort()).toEqual(['ICONS-출고지시-2026-10-12-김포-2.csv', 'ICONS-출고지시-2026-10-12-김포.csv']);
  });
  it('rejects invalid export data before producing a file', async () => {
    await expect(buildShipmentExport({ shipments: [{ ...shipment, lines: [] }] }, 'xlsx')).rejects.toThrow('상품 정보');
    await expect(buildShipmentExport({ shipments: [{ ...shipment, template: 'seowon_xlsx', lines: [{ ...line, qty: 0 }] }] }, 'xlsx')).rejects.toThrow('수량');
    // 김포·서원 파일은 회신 업로드 한도(768KB)에 운송장 열을 더해도 들도록 512KB를 넘겨 만들지 않는다.
    const noisy = Array.from({ length: 600 }, (_, i) => ({ ...line, address: `${i}-${Array.from({ length: 1200 }, (_, j) => String.fromCharCode(0xac00 + ((i * 7919 + j * 104729) % 11172))).join('')}` }));
    await expect(buildShipmentExport({ shipments: [{ ...shipment, template: 'seowon_xlsx', lines: noisy }] }, 'xlsx')).rejects.toThrow('회신 업로드 한도');
    // 김포·서원 파일은 회신 업로드 한도(1,000줄)를 넘겨 만들지 않는다.
    const many = Array.from({ length: 1001 }, () => ({ ...line }));
    await expect(buildShipmentExport({ shipments: [{ ...shipment, template: 'seowon_xlsx', lines: many }] }, 'xlsx')).rejects.toThrow('1,000줄');
    await expect(buildShipmentExport({ shipments: [{ ...shipment, template: 'wms_csv', lines: many }] }, 'csv')).rejects.toThrow('1,000줄');
    await expect(buildShipmentExport({ shipments: [{ ...shipment, columns: [] }] } as ShipmentExportData, 'xlsx')).rejects.toThrow('양식');
  });
});
