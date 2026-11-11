import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { buildShipmentExport } from './shipment-workbook.server';
import { DEFAULT_SHIPMENT_EXPORT_COLUMNS } from './shipment-workbook';
import type { ShipmentExportData } from './shipment-dispatch';
import type { SmartStoreShipmentDetail } from './smartstore-shipment-workbook';
import { parseTrackingWorkbook, TRACKING_IMPORT_FILE_LIMIT_BYTES } from './tracking-workbook.server';
import { parseSmartStoreReplyText } from './smartstore-tracking-workbook.server';
import { parseDelimitedText } from './spreadsheet-text';
import { shipmentExportRowsCsv } from './shipment-workbook';
import { trackingImportCommand } from './warehouse-templates.server';
import { encryptAdminWorkbook } from './encrypted-workbook.server';

const HEADERS = ['주문번호', '상품주문번호', '배송건번호', '구매자', '수취인', '연락처', '우편번호', '주소', '배송메시지', '출고지', '택배사', '운송장번호',
  '상품번호', '상품코드', '상품명', '옵션', '옵션코드', '바코드', 'ERP 품명', '수량', '상품별 할인액', '품목 실결제액(배송비 제외)', '결제일', '결제수단', '주문일시', '발주확인일', '발송 예정일',
  '배송비 형태', '배송비 합계', '제주/도서 추가배송비', '배송비 할인액'];
const detail: SmartStoreShipmentDetail = {
  orderNumber: '2026102010000001', productOrderNumber: '2026102020000001', shipmentNumber: '2026102030000001',
  itemId: '60000000-0000-4000-8000-000000000001', goodId: 'test-good', buyerName: '합성 구매자', buyerId: '60000000-0000-4000-8000-000000000002', buyerPhone: '',
  address1: '합성 기본 주소', address2: '합성 상세 주소', orderedAt: '2026-10-19T16:30:00Z', paidAt: '2026-10-19T16:35:00Z', confirmedAt: '2026-10-19T17:00:00Z',
  expectedShipDate: '2026-10-21', shippedAt: null, exportedAt: null, goodType: 'keyring', paymentMethod: 'card', productPrice: null, optionPrice: null,
  itemDiscount: 6000, sellerDiscount: 6000, itemTotal: 24000, regionalShippingFee: 0, shippingDiscount: 0,
};
const line = { shipmentId: '60000000-0000-4000-8000-000000000003', orderId: '60000000-0000-4000-8000-000000000004', recipient: '합성 수취인', phone: '01001234567',
  postalCode: '00123', address: '합성 기본 주소 합성 상세 주소', goodCode: '000123', variantCode: '000123-RED', goodName: '=합성 상품', optionName: '빨강', qty: 2, unitPrice: 12500,
  deliveryNote: '문 앞\n부탁합니다', carrier: '한진택배', barcode: '0880000000011', erpCode: 'ERP-RED', erpName: 'ERP 합성 키링 빨강', smartstore: detail };
const shipment = { id: line.shipmentId, updatedAt: '2026-10-20T00:00:00Z', originId: '60000000-0000-4000-8000-000000000005', originName: '김포',
  template: 'wms_csv', shippingFee: 3000, columns: [...DEFAULT_SHIPMENT_EXPORT_COLUMNS], lines: [line] };
const carriers = [{ code: 'hanjin', label: '한진택배', active: true, trackingUrlTemplate: 'https://example.test/{trackingNumber}' }];
async function load(bytes: Buffer) { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes as never); return workbook; }
function value(sheet: ExcelJS.Worksheet, header: string, row = 2) { return sheet.getCell(row, HEADERS.indexOf(header) + 1); }
async function exported() { return load((await buildShipmentExport({ shipments: [shipment] }, 'xlsx', 'smartstore')).bytes); }

describe('ICONS 표준 양식 출고지시', () => {
  it('머리글 1행·공용 모양·화면 이름 시트로 쓰고 맨 뒤에 내려받기 정보를 둔다', async () => {
    const workbook = await exported();
    expect(workbook.worksheets.map(sheet => sheet.name)).toEqual(['발주(주문)확인 발송관리', '내려받기 정보']);
    const sheet = workbook.worksheets[0];
    expect(sheet.getRow(1).values).toEqual([undefined, ...HEADERS]);
    expect(sheet.columnCount).toBe(HEADERS.length);
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.autoFilter).toBe('A1:AE2');
    expect(sheet.getRow(1).height).toBe(22);
    for (let column = 1; column <= HEADERS.length; column++) {
      expect(sheet.getCell(1, column).font).toMatchObject({ name: '맑은 고딕', size: 10, bold: true });
      expect(sheet.getCell(1, column).fill).toMatchObject({ fgColor: { argb: 'FFEFF2F0' } });
    }
    expect(sheet.model.merges ?? []).toEqual([]);
    const info = workbook.getWorksheet('내려받기 정보')!;
    const lines = new Map<string, string[]>();
    info.eachRow(row => { const key = String(row.getCell(1).value); lines.set(key, [...(lines.get(key) ?? []), String(row.getCell(2).value)]); });
    expect(lines.get('화면')).toEqual(['발주(주문)확인/발송관리']);
    expect(lines.get('양식')).toEqual(['ICONS 표준 양식']);
    expect(lines.get('출고지')).toEqual(['김포']);
    expect(lines.get('건수')).toEqual(['1건 · 엑셀 1행']);
    expect(lines.get('안내')!.join(' ')).toContain('엑셀 일괄 운송장 등록');
    expect(lines.get('개인정보')![0]).toContain('개인정보');
    const everyText = [...lines.values()].flat().join(' ');
    expect(everyText).not.toMatch(/네이버|스마트스토어|발송처리/);
  });

  it('번호는 텍스트, 날짜는 KST 문자열, 금액은 #,##0 숫자로 쓴다', async () => {
    const sheet = (await exported()).worksheets[0];
    expect(value(sheet, '상품주문번호').value).toBe(detail.productOrderNumber);
    expect(value(sheet, '상품주문번호').value).not.toBe(line.shipmentId);
    expect(value(sheet, '배송건번호').value).toBe(detail.shipmentNumber);
    for (const [header, expected] of [['연락처', line.phone], ['우편번호', line.postalCode], ['상품코드', line.goodCode], ['옵션코드', line.variantCode], ['바코드', line.barcode]]) {
      expect(value(sheet, header).value).toBe(expected); expect(value(sheet, header).numFmt).toBe('@');
    }
    // 빈 운송장 칸도 입력 전에 텍스트 서식이어야 앞자리 0을 지킨다.
    expect(value(sheet, '운송장번호').value).toBeNull();
    expect(value(sheet, '운송장번호').numFmt).toBe('@');
    expect(value(sheet, '주문일시').value).toBe('2026-10-20 01:30');
    expect(value(sheet, '결제일').value).toBe('2026-10-20 01:35');
    expect(value(sheet, '발주확인일').value).toBe('2026-10-20 02:00');
    expect(value(sheet, '발송 예정일').value).toBe('2026-10-21');
    expect(value(sheet, '결제수단').value).toBe('카드');
    expect(value(sheet, '품목 실결제액(배송비 제외)').value).toBe(24000);
    expect(value(sheet, '품목 실결제액(배송비 제외)').numFmt).toBe('#,##0');
    expect(value(sheet, '상품별 할인액').value).toBe(6000);
    expect(value(sheet, '수량').type).toBe(ExcelJS.ValueType.Number);
    expect(value(sheet, '수량').numFmt).toBe('#,##0');
    expect(value(sheet, '상품명').type).toBe(ExcelJS.ValueType.String);
    expect(value(sheet, '상품명').value).toBe('=합성 상품');
    expect(value(sheet, '배송메시지').value).toBe('문 앞\n부탁합니다');
    const bank = await load((await buildShipmentExport({ shipments: [{ ...shipment, lines: [{ ...line, smartstore: { ...detail, paymentMethod: 'bank_transfer' } }] }] }, 'xlsx', 'smartstore')).bytes);
    expect(value(bank.worksheets[0], '결제수단').value).toBe('무통장 입금');
  });

  it('옵션의 바코드(앞자리 0 보존)·ERP 품명을 옵션코드 뒤에 싣고 값이 없으면 빈칸으로 둔다(1027T-046)', async () => {
    const sheet = (await exported()).worksheets[0];
    expect(HEADERS.slice(HEADERS.indexOf('옵션코드'), HEADERS.indexOf('수량') + 1)).toEqual(['옵션코드', '바코드', 'ERP 품명', '수량']);
    expect(value(sheet, '바코드').value).toBe('0880000000011');
    expect(value(sheet, '바코드').type).toBe(ExcelJS.ValueType.String);
    expect(value(sheet, 'ERP 품명').value).toBe('ERP 합성 키링 빨강');
    // ERP 코드는 ICONS 표준 양식에 싣지 않는다(요청은 품명·바코드).
    expect(HEADERS).not.toContain('ERP 코드');
    const blank = await load((await buildShipmentExport({ shipments: [{ ...shipment, lines: [{ ...line, barcode: '  ', erpName: '' }] }] }, 'xlsx', 'smartstore')).bytes);
    expect(value(blank.worksheets[0], '바코드').value).toBeNull();
    expect(value(blank.worksheets[0], '바코드').numFmt).toBe('@');
    expect(value(blank.worksheets[0], 'ERP 품명').value).toBeNull();
    // 바코드·ERP 키가 없는 옛 응답 행도 빈칸으로 내보낸다.
    const legacy = Object.fromEntries(Object.entries(line).filter(([key]) => !['barcode', 'erpCode', 'erpName'].includes(key))) as typeof line;
    const old = await load((await buildShipmentExport({ shipments: [{ ...shipment, lines: [legacy] }] }, 'xlsx', 'smartstore')).bytes);
    expect(value(old.worksheets[0], '바코드').value).toBeNull();
    expect(value(old.worksheets[0], 'ERP 품명').value).toBeNull();
    const info = new Map<string, string[]>();
    (await exported()).getWorksheet('내려받기 정보')!.eachRow(row => { const key = String(row.getCell(1).value); info.set(key, [...(info.get(key) ?? []), String(row.getCell(2).value)]); });
    expect(info.get('안내')!.join(' ')).toContain('바코드·ERP 품명');
  });

  it('출고지를 한 시트에 모으고 배송비를 배송 건의 첫 행에 한 번만 쓴다', async () => {
    const secondLine = { ...line, smartstore: { ...detail, itemId: '60000000-0000-4000-8000-000000000006' } };
    const other = { ...shipment, id: '60000000-0000-4000-8000-000000000007', originId: '60000000-0000-4000-8000-000000000008', originName: '남양주', template: 'seowon_xlsx', shippingFee: 4000,
      lines: [{ ...line, smartstore: { ...detail, itemId: '60000000-0000-4000-8000-000000000009' } }] };
    const book = await load((await buildShipmentExport({ shipments: [{ ...shipment, lines: [line, secondLine] }, other] }, 'xlsx', 'smartstore')).bytes);
    expect(book.worksheets.map(sheet => sheet.name)).toEqual(['발주(주문)확인 발송관리', '내려받기 정보']);
    expect(book.worksheets[0].rowCount).toBe(4);
    expect(book.worksheets[0].autoFilter).toBe('A1:AE4');
    expect([2, 3, 4].map(row => value(book.worksheets[0], '배송비 합계', row).value)).toEqual([3000, 0, 4000]);
    expect([2, 3, 4].map(row => value(book.worksheets[0], '출고지', row).value)).toEqual(['김포', '김포', '남양주']);
    expect(book.getWorksheet('내려받기 정보')!.getCell('B3').value).toBe('김포, 남양주');
  });

  it('선물·착불·합포장이 있으면 배송 운영 안내를 내려받기 정보 앞에 두고 회신도 그대로 읽는다', async () => {
    const gift = { ...shipment, isGift: true };
    const book = await load((await buildShipmentExport({ shipments: [gift] }, 'xlsx', 'smartstore')).bytes);
    expect(book.worksheets.map(sheet => sheet.name)).toEqual(['발주(주문)확인 발송관리', '배송 운영 안내', '내려받기 정보']);
    value(book.worksheets[0], '운송장번호').value = '001234567890';
    const parsed = await parseTrackingWorkbook(Buffer.from(await book.xlsx.writeBuffer()), carriers);
    expect(parsed.issues).toEqual([]); expect(parsed.rows).toHaveLength(1);
    book.getWorksheet('내려받기 정보')!.getCell('B1').value = { formula: '1+1' };
    await expect(parseTrackingWorkbook(Buffer.from(await book.xlsx.writeBuffer()), carriers)).rejects.toThrow('허용되지 않는 셀');
  });

  it('운송장번호만 채운 파일을 안내 없이 그대로 회신으로 읽는다', async () => {
    const file = await buildShipmentExport({ shipments: [shipment] }, 'xlsx', 'smartstore');
    expect(file.name).toMatch(/^icons-출고지시-\d{8}-\d{4}\.xlsx$/);
    const downloaded = encryptAdminWorkbook(file.bytes, '1234');
    await expect(parseTrackingWorkbook(downloaded.bytes, carriers)).rejects.toThrow('파일 비밀번호를 입력');
    await expect(parseTrackingWorkbook(downloaded.bytes, carriers, '4321')).rejects.toThrow('맞지 않습니다');
    expect(await parseTrackingWorkbook(downloaded.bytes, carriers, '1234')).toEqual(await parseTrackingWorkbook(file.bytes, carriers));
    const book = await load(file.bytes);
    const sheet = book.worksheets[0];
    value(sheet, '운송장번호').value = '001234567890';
    const parsed = await parseTrackingWorkbook(Buffer.from(await book.xlsx.writeBuffer()), carriers);
    expect(parsed.issues).toEqual([]);
    if (!('kind' in parsed) || parsed.kind !== 'smartstore') throw new Error('Expected ICONS standard reply');
    expect(trackingImportCommand(parsed, '')).toEqual({ name: 'admin_import_item_tracking_batch', args: { target_rows: [{ line: 2, reference: detail.productOrderNumber, carrier: 'hanjin', trackingNumber: '001234567890' }] } });
    const filled = encryptAdminWorkbook(Buffer.from(await book.xlsx.writeBuffer()), '1234');
    expect(await parseTrackingWorkbook(filled.bytes, carriers, '1234')).toEqual(parsed);
    // 실제 Agile 암호화·복호화를 다섯 번 해 CI 러너에서 5초 기본 제한을 넘긴다.
  }, 20_000);

  it('품목 1,000줄 회신이 업로드 한도 안에 들어간다', async () => {
    const shipments = Array.from({ length: 1000 }, (_, index) => {
      const id = randomUUID(), orderId = randomUUID();
      return { ...shipment, id, lines: [{ ...line, shipmentId: id, orderId, recipient: `합성 수취인 ${index}`, phone: `010${String(index).padStart(8, '0')}`,
        address: `합성 기본 주소 ${index}번길 합성 상세 ${index}호`, smartstore: { ...detail, itemId: randomUUID(), buyerName: `합성 구매자 ${index}` } }] };
    });
    const book = await load((await buildShipmentExport({ shipments }, 'xlsx', 'smartstore')).bytes);
    const sheet = book.worksheets[0];
    for (let index = 2; index <= sheet.rowCount; index++) value(sheet, '운송장번호', index).value = '001234567890';
    const bytes = Buffer.from(await book.xlsx.writeBuffer());
    expect(bytes.length).toBeLessThan(TRACKING_IMPORT_FILE_LIMIT_BYTES);
    const parsed = await parseTrackingWorkbook(bytes, carriers);
    expect(parsed.rows).toHaveLength(1000); expect(parsed.issues).toEqual([]);
  });

  it('구매자는 화면과 같은 표시 이름을 쓴다: 닉네임이 없으면 회원 ID 앞 6자리로 만든다', async () => {
    const nameless = await load((await buildShipmentExport({ shipments: [{ ...shipment, lines: [{ ...line, smartstore: { ...detail, buyerName: '' } }] }] }, 'xlsx', 'smartstore')).bytes);
    expect(value(nameless.worksheets[0], '구매자').value).toBe('fan_600000');
    expect(value((await exported()).worksheets[0], '구매자').value).toBe('합성 구매자');
  });

  it('긴 칸의 너비가 흔한 값(주소·연락처·배송메시지·상품명)을 자르지 않는다', async () => {
    const sheet = (await exported()).worksheets[0];
    const width = (header: string) => sheet.getColumn(HEADERS.indexOf(header) + 1).width!;
    expect(width('연락처')).toBeGreaterThanOrEqual(16);
    expect(width('주소')).toBeGreaterThanOrEqual(61);
    expect(width('배송메시지')).toBeGreaterThanOrEqual(40);
    expect(width('상품명')).toBeGreaterThanOrEqual(43);
    expect(width('주문번호')).toBeGreaterThanOrEqual(16);
  });

  it('내려받은 CSV에 운송장번호를 채워 그대로 회신으로 읽는다(쉼표·줄바꿈·수식 방어 값 포함)', async () => {
    const file = await buildShipmentExport({ shipments: [{ ...shipment, lines: [{ ...line, address: '서울시, 상세주소' }] }] }, 'csv', 'smartstore');
    const { rows: [head, row] } = parseDelimitedText(file.bytes.toString('utf8'), ',');
    expect(head).toEqual(HEADERS);
    expect(row[HEADERS.indexOf('배송메시지')]).toBe('문 앞\n부탁합니다');
    row[HEADERS.indexOf('운송장번호')] = '123456789012';
    const parsed = parseSmartStoreReplyText(shipmentExportRowsCsv(head, [row]), carriers)!;
    expect(parsed.issues).toEqual([]);
    expect(trackingImportCommand(parsed, '')).toEqual({ name: 'admin_import_item_tracking_batch', args: { target_rows: [{ line: 2, reference: detail.productOrderNumber, carrier: 'hanjin', trackingNumber: '123456789012' }] } });
  });

  it('품목 번호가 없거나 겹치거나 금액·날짜 기록이 깨지면 파일을 만들지 않는다', async () => {
    const missing = { ...line, smartstore: undefined };
    await expect(buildShipmentExport({ shipments: [{ ...shipment, lines: [missing] }] }, 'xlsx', 'smartstore')).rejects.toThrow('상품주문 정보');
    await expect(buildShipmentExport({ shipments: [{ ...shipment, lines: [line, line] }] }, 'xlsx', 'smartstore')).rejects.toThrow('상품주문번호가 중복');
    for (const bad of [-1, NaN, 0.5]) await expect(buildShipmentExport({ shipments: [{ ...shipment, lines: [{ ...line, smartstore: { ...detail, itemTotal: bad } }] }] } as ShipmentExportData, 'xlsx', 'smartstore')).rejects.toThrow('금액');
    await expect(buildShipmentExport({ shipments: [{ ...shipment, lines: [{ ...line, smartstore: { ...detail, confirmedAt: 'not-a-date' } }] }] }, 'xlsx', 'smartstore')).rejects.toThrow('날짜');
  });

  it('CSV도 같은 열·같은 이름을 쓰고 수식처럼 보이는 값을 막는다', async () => {
    const file = await buildShipmentExport({ shipments: [shipment] }, 'csv', 'smartstore');
    expect(file.name).toMatch(/^icons-출고지시-\d{8}-\d{4}\.csv$/);
    const text = file.bytes.toString('utf8');
    expect(text.slice(1).split('\r\n')[0]).toBe(HEADERS.map(header => `"${header}"`).join(','));
    expect(text).toContain('"\'=합성 상품"');
    expect(text).toContain('"2026-10-20 01:30"');
    const gift = await buildShipmentExport({ shipments: [{ ...shipment, isGift: true }] }, 'csv', 'smartstore');
    expect(gift.name).toMatch(/^icons-출고지시-\d{8}-\d{4}\.zip$/);
    const [instruction, operational] = Object.keys((await JSZip.loadAsync(gift.bytes)).files);
    expect(instruction).toMatch(/^icons-출고지시-\d{8}-\d{4}\.csv$/);
    expect(operational).toMatch(/^icons-배송운영안내-\d{8}-\d{4}\.csv$/);
  });
});
