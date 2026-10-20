import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import format from './smartstore-shipment-format.json';
import { buildShipmentExport } from './shipment-workbook.server';
import { DEFAULT_SHIPMENT_EXPORT_COLUMNS } from './shipment-workbook';
import type { ShipmentExportData } from './shipment-dispatch';
import type { SmartStoreShipmentDetail } from './smartstore-shipment-workbook';
import { parseTrackingWorkbook } from './tracking-workbook.server';
import { trackingImportCommand } from './warehouse-templates.server';
import { encryptAdminWorkbook } from './encrypted-workbook.server';

const detail: SmartStoreShipmentDetail = {
  itemId: '60000000-0000-4000-8000-000000000001', goodId: 'test-good', buyerName: '합성 구매자', buyerId: '60000000-0000-4000-8000-000000000002', buyerPhone: '',
  address1: '합성 기본 주소', address2: '합성 상세 주소', orderedAt: '2026-10-19T16:30:00Z', paidAt: '2026-10-19T16:35:00Z', confirmedAt: '2026-10-19T17:00:00Z',
  expectedShipDate: '2026-10-21', shippedAt: null, exportedAt: null, goodType: 'keyring', paymentMethod: 'card', productPrice: null, optionPrice: null,
  itemDiscount: 6000, sellerDiscount: 6000, itemTotal: 24000, regionalShippingFee: 0, shippingDiscount: 0,
};
const line = { shipmentId: '60000000-0000-4000-8000-000000000003', orderId: '60000000-0000-4000-8000-000000000004', recipient: '합성 수취인', phone: '01001234567',
  postalCode: '00123', address: '합성 기본 주소 합성 상세 주소', goodCode: '000123', variantCode: '000123-RED', goodName: '=합성 상품', optionName: '빨강', qty: 2, unitPrice: 12500,
  deliveryNote: '문 앞\n부탁합니다', carrier: '한진택배', smartstore: detail };
const shipment = { id: line.shipmentId, updatedAt: '2026-10-20T00:00:00Z', originId: '60000000-0000-4000-8000-000000000005', originName: '김포',
  template: 'wms_csv', shippingFee: 3000, columns: [...DEFAULT_SHIPMENT_EXPORT_COLUMNS], lines: [line] };
const carriers = [{ code: 'hanjin', label: '한진택배', active: true, trackingUrlTemplate: 'https://example.test/{trackingNumber}' }];
async function load(bytes: Buffer) { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes as never); return workbook; }
function value(sheet: ExcelJS.Worksheet, header: string, row = 3) { return sheet.getCell(row, format.headers.indexOf(header) + 1); }

describe('2026-10-20 Smart Store dispatch workbook', () => {
  it('matches the actual blank source sheet, 74 headers, merges, row heights, column widths and header styles', async () => {
    const sourceBytes = await readFile(new URL('./fixtures/smartstore-dispatch-20261020.xlsx', import.meta.url));
    expect(createHash('sha256').update(sourceBytes).digest('hex')).toBe(format.sha256);
    const source = (await load(sourceBytes)).worksheets[0];
    const actual = (await load((await buildShipmentExport({ shipments: [shipment] }, 'xlsx', 'smartstore')).bytes)).worksheets[0];
    expect(source.rowCount).toBe(2);
    expect(actual.name).toBe(source.name);
    expect(actual.columnCount).toBe(74);
    expect(actual.getRow(2).values).toEqual(source.getRow(2).values);
    expect(actual.model.merges).toEqual(source.model.merges);
    expect(actual.properties.defaultRowHeight).toBe(source.properties.defaultRowHeight);
    expect(actual.getRow(1).height).toBe(source.getRow(1).height);
    for (let column = 1; column <= 74; column++) {
      expect(actual.getColumn(column).width).toBe(source.getColumn(column).width);
      expect(actual.getColumn(column).numFmt).toBe(source.getColumn(column).numFmt);
      expect(actual.getCell(2, column).style).toEqual(source.getCell(2, column).style);
    }
    expect(actual.getCell('A1').style).toEqual(source.getCell('A1').style);
    expect(actual.autoFilter).toBe('A2:BV3');
  });
  it('uses actual item IDs, typed KST dates and amounts while leaving unsupported provider and missing snapshot fields blank', async () => {
    const sheet = (await load((await buildShipmentExport({ shipments: [shipment] }, 'xlsx', 'smartstore')).bytes)).worksheets[0];
    expect(value(sheet, '상품주문번호').value).toBe(detail.itemId);
    expect(value(sheet, '상품주문번호').value).not.toBe(line.shipmentId);
    for (const [header, expected] of [['수취인연락처1', line.phone], ['우편번호', line.postalCode], ['판매자 상품코드', line.goodCode], ['송장번호', '']]) {
      expect(value(sheet, header).value).toBe(expected); expect(value(sheet, header).numFmt).toBe('@');
    }
    expect(value(sheet, '주문일시').value).toEqual(new Date('2026-10-20T01:30:00Z'));
    expect(value(sheet, '발송기한').value).toEqual(new Date('2026-10-21T00:00:00Z'));
    expect(value(sheet, '최종 상품별 총 주문금액').value).toBe(24000);
    expect(value(sheet, '최종 상품별 할인액').value).toBe(6000);
    expect(value(sheet, '수량').type).toBe(ExcelJS.ValueType.Number);
    expect(value(sheet, '상품명').type).toBe(ExcelJS.ValueType.String);
    for (const header of ['상품가격', '옵션가격', '네이버페이 주문관리 수수료', '매출연동 수수료', '정산예정금액', '개인통관고유부호', '인증번호']) expect(value(sheet, header).value).toBeNull();
    expect(value(sheet, '구매자연락처').value).toBe('');
  });
  it('consolidates Gimpo and Namyangju with distinct origins and does not repeat shipping charges per item', async () => {
    const secondLine = { ...line, smartstore: { ...detail, itemId: '60000000-0000-4000-8000-000000000006' } };
    const other = { ...shipment, id: '60000000-0000-4000-8000-000000000007', originId: '60000000-0000-4000-8000-000000000008', originName: '남양주', template: 'seowon_xlsx', shippingFee: 4000,
      lines: [{ ...line, smartstore: { ...detail, itemId: '60000000-0000-4000-8000-000000000009' } }] };
    const book = await load((await buildShipmentExport({ shipments: [{ ...shipment, lines: [line, secondLine] }, other] }, 'xlsx', 'smartstore')).bytes);
    expect(book.worksheets).toHaveLength(1);
    expect(book.worksheets[0].rowCount).toBe(5);
    expect([3, 4, 5].map(row => value(book.worksheets[0], '배송비 합계', row).value)).toEqual([3000, 0, 4000]);
    expect([3, 4, 5].map(row => value(book.worksheets[0], '출고지', row).value)).toEqual(['김포', '김포', '남양주']);
  });
  it('round-trips the full export using the four input columns without rejecting untouched date cells', async () => {
    const file = await buildShipmentExport({ shipments: [shipment] }, 'xlsx', 'smartstore');
    const encrypted = encryptAdminWorkbook(file.bytes, 'Shipment-Test-1234');
    await expect(parseTrackingWorkbook(encrypted.bytes, carriers)).rejects.toThrow('암호를 해제');
    const book = await load(file.bytes);
    const sheet = book.worksheets[0];
    await expect(parseTrackingWorkbook(Buffer.from(await book.xlsx.writeBuffer()), carriers)).rejects.toThrow('1행을 삭제');
    sheet.unMergeCells('A1:C1'); sheet.unMergeCells('D1:F1'); sheet.spliceRows(1, 1); sheet.name = '발송처리';
    value(sheet, '송장번호', 2).value = '001234567890';
    const parsed = await parseTrackingWorkbook(Buffer.from(await book.xlsx.writeBuffer()), carriers);
    expect(parsed.issues).toEqual([]);
    if (!('kind' in parsed) || parsed.kind !== 'smartstore') throw new Error('Expected Smart Store tracking reply');
    expect(trackingImportCommand(parsed, '')).toEqual({ name: 'admin_import_item_tracking_batch', args: { target_rows: [{ line: 2, reference: detail.itemId, carrier: 'hanjin', trackingNumber: '001234567890' }] } });
  });
  it('accepts a full 1,000-order reply whose real UUIDs and distinct addresses exceed the old 256 KiB limit', async () => {
    const shipments = Array.from({ length: 1000 }, (_, index) => {
      const id = randomUUID(), orderId = randomUUID();
      return { ...shipment, id, lines: [{ ...line, shipmentId: id, orderId, recipient: `합성 수취인 ${index}`, phone: `010${String(index).padStart(8, '0')}`,
        address: `합성 기본 주소 ${index}번길 합성 상세 ${index}호`, smartstore: { ...detail, itemId: randomUUID(), buyerId: randomUUID(), buyerName: `합성 구매자 ${index}`,
          address1: `합성 기본 주소 ${index}번길`, address2: `합성 상세 ${index}호` } }] };
    });
    const book = await load((await buildShipmentExport({ shipments }, 'xlsx', 'smartstore')).bytes);
    const sheet = book.worksheets[0];
    sheet.unMergeCells('A1:C1'); sheet.unMergeCells('D1:F1'); sheet.spliceRows(1, 1); sheet.name = '발송처리';
    for (let index = 2; index <= sheet.rowCount; index++) value(sheet, '송장번호', index).value = '001234567890';
    const bytes = Buffer.from(await book.xlsx.writeBuffer());
    expect(bytes.length).toBeGreaterThan(256 * 1024);
    const parsed = await parseTrackingWorkbook(bytes, carriers);
    expect(parsed.rows).toHaveLength(1000); expect(parsed.issues).toEqual([]);
  });
  it('rejects missing or duplicate item IDs and corrupt monetary snapshots', async () => {
    const missing = { ...line, smartstore: undefined };
    await expect(buildShipmentExport({ shipments: [{ ...shipment, lines: [missing] }] }, 'xlsx', 'smartstore')).rejects.toThrow('상품주문 정보');
    await expect(buildShipmentExport({ shipments: [{ ...shipment, lines: [line, line] }] }, 'xlsx', 'smartstore')).rejects.toThrow('상품주문번호가 중복');
    for (const bad of [-1, NaN, 0.5]) await expect(buildShipmentExport({ shipments: [{ ...shipment, lines: [{ ...line, smartstore: { ...detail, itemTotal: bad } }] }] } as ShipmentExportData, 'xlsx', 'smartstore')).rejects.toThrow('금액');
  });
  it('uses the same 74-column order in CSV and keeps formula-looking content inert', async () => {
    const file = await buildShipmentExport({ shipments: [shipment] }, 'csv', 'smartstore');
    expect(file.bytes.toString('utf8')).toContain('"상품주문번호","주문번호","배송속성"');
    expect(file.bytes.toString('utf8')).toContain('"\'=합성 상품"');
    expect(file.bytes.toString('utf8')).toContain('"2026-10-20 01:30"');
  });
});
