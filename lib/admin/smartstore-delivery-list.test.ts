import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { smartStoreDeliveryListSheet, type DeliveryListSheetBase } from './smartstore-delivery-list';
import { smartStoreDeliveryLine } from './smartstore-delivery-list.fixture';
import { buildAdminListExportWorkbook } from './list-export.server';
import { encryptAdminWorkbook } from './encrypted-workbook.server';
import { listExportContact } from './list-export-sheets';
import type { AdminListExportSheet } from './list-export';
import { parseTrackingWorkbook } from './tracking-workbook.server';
import officecrypto from 'officecrypto-tool';

const HEADERS = ['주문번호', '상품주문번호', '배송건번호', '구매자', '수취인', '연락처', '우편번호', '주소', '배송메시지', '출고지', '배송 방식', '택배사', '운송장번호',
  '상품번호', '상품코드', '상품명', '옵션', '수량', '상품별 할인액', '품목 실결제액(배송비 제외)', '결제일', '결제수단', '주문일시', '발주확인일', '발송 예정일',
  '발송처리일', '배송완료일', '주문 상태', '배송비 형태', '배송비 합계', '제주/도서 추가배송비', '배송비 할인액'];
const base: DeliveryListSheetBase = { screen: 'dispatch', title: '발주(주문)확인/발송관리 - 신규주문', recordCount: 1, conditions: [['탭', '신규주문']], notes: ['한 행은 상품주문 한 개입니다.'], filters: { tab: 'new' } };
const line = smartStoreDeliveryLine();
const shipment = { id: line.shipmentId, orderId: line.orderId, originName: '김포', createdAt: '2026-10-20T14:00:00Z', confirmedAt: '2026-10-20T14:30:00Z',
  paymentMethod: 'bank_transfer', expectedShipDate: '2026-10-22', delayReason: '입고 지연' };
const source = { shipments: [shipment], contacts: new Map([[line.orderId, listExportContact({ recipientName: '다른 이름', phone: '010', postalCode: '1', address1: '주소', deliveryNote: '문 앞' })]]) };
function sheetFor(lines = [line], overrides: Partial<DeliveryListSheetBase> = {}, shipments = source) { return smartStoreDeliveryListSheet({ ...base, ...overrides }, lines, shipments); }
function values(sheet: AdminListExportSheet, row = 0) { return Object.fromEntries(sheet.columns.map((column, i) => [column.header, sheet.rows[row][i]])); }

describe('ICONS 표준 양식 배송현황 목록', () => {
  it('두 화면 모두 표준 열·공용 모양·화면 이름 시트로 암호화해 내려받는다', async () => {
    for (const screen of ['dispatch', 'shipping'] as const) {
      const sheet = sheetFor([line], { screen, title: screen === 'dispatch' ? '발주(주문)확인/발송관리 - 신규주문' : '배송현황 관리 - 배송중' });
      const plain = await buildAdminListExportWorkbook(sheet, new Date('2026-10-21T00:00:00Z'));
      const encrypted = encryptAdminWorkbook(plain, '1234');
      expect(officecrypto.isEncrypted(encrypted.bytes)).toBe(true);
      const decrypted = await officecrypto.decrypt(encrypted.bytes, { password: '1234' });
      const book = new ExcelJS.Workbook(); await book.xlsx.load(decrypted as never);
      expect(book.worksheets.map(item => item.name)).toEqual([screen === 'dispatch' ? '발주(주문)확인 발송관리 - 신규주문' : '배송현황 관리 - 배송중', '내려받기 정보']);
      const actual = book.worksheets[0];
      expect(actual.getRow(1).values).toEqual([undefined, ...HEADERS]);
      expect(actual.columnCount).toBe(HEADERS.length);
      expect(actual.autoFilter).toBe('A1:AF2');
      expect(actual.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      expect(actual.getRow(1).height).toBe(22);
      for (let c = 1; c <= HEADERS.length; c++) {
        expect(actual.getCell(1, c).font).toMatchObject({ name: '맑은 고딕', size: 10, bold: true });
        expect(actual.getCell(1, c).fill).toMatchObject({ fgColor: { argb: 'FFEFF2F0' } });
      }
      const cell = (header: string) => actual.getCell(2, HEADERS.indexOf(header) + 1);
      expect(cell('상품주문번호').value).toBe('2026102120000001');
      expect(cell('주문번호').value).toBe('2026102110000001');
      expect(cell('상품주문번호').numFmt).toBe('@');
      expect(cell('발송처리일').value).toBe('2026-10-21 00:01');
      expect(cell('결제일').value).toBe('2026-10-21 00:00');
      expect(cell('주문일시').value).toBe('2026-10-20 23:00');
      expect(cell('운송장번호').value).toBe('001234567890');
      expect(cell('상품명').type).toBe(ExcelJS.ValueType.String);
      expect(cell('수량').value).toBe(2);
      expect(cell('품목 실결제액(배송비 제외)').value).toBe(19000);
      expect(cell('품목 실결제액(배송비 제외)').numFmt).toBe('#,##0');
      expect(cell('연락처').value).toBe('01000000000');
      expect(cell('우편번호').value).toBe('00123');
    }
    /* 두 워크북을 만들고 다시 읽는 무거운 왕복이라, 부하가 큰 CI 러너에서 기본 5초를 넘긴 적이 있다(PR #608). */
  }, 20_000);
  it('출고지·배송메시지·주문일시·결제수단을 실제 값으로 싣고 없는 값은 비운다', () => {
    expect(values(sheetFor())).toMatchObject({
      출고지: '김포', '배송 방식': '택배', 배송메시지: '문 앞', 주문일시: '2026-10-20 23:00', 결제수단: '무통장 입금', 발주확인일: '2026-10-20 23:30', '발송 예정일': '2026-10-22',
      수취인: '합성 수취인', 주소: '합성 기본주소 합성 상세주소', '주문 상태': '배송중', 배송완료일: null,
    });
    expect(values(sheetFor([line], {}, { ...source, contacts: new Map() })).배송메시지).toBeNull();
  });
  it('구매자는 화면과 같은 표시 이름을 쓴다: 닉네임이 없으면 회원 ID 앞 6자리로 만든다', () => {
    expect(values(sheetFor()).구매자).toBe('합성 구매자');
    expect(values(sheetFor([smartStoreDeliveryLine({ buyerName: '', buyerId: 'de000000-0000-4000-8000-000000000001' })])).구매자).toBe('fan_de0000');
  });
  it('표준 열만 쓰고 발송지연 탭에만 지연 메모가 붙는다', () => {
    const sheet = sheetFor();
    expect(sheet.columns.map(column => column.header)).toEqual(HEADERS);
    expect(sheet.notes).toEqual(base.notes);
    const delayed = sheetFor([line], { filters: { tab: 'delayed' } });
    expect(delayed.columns.map(column => column.header)).toEqual([...HEADERS, '지연 메모']);
    expect(values(delayed)).toMatchObject({ '지연 메모': '입고 지연', '발송 예정일': '2026-10-22' });
  });
  it('품목 실결제액을 쓰고 배송비를 배송건번호의 첫 행에 한 번만 기록한다', () => {
    const sheet = sheetFor([line, smartStoreDeliveryLine({ itemId: '60000000-0000-4000-8000-000000000004', productOrderNumber: '2026102120000002', itemTotal: 7000 })]);
    expect(values(sheet)).toMatchObject({ '품목 실결제액(배송비 제외)': 19000, '배송비 합계': 3000, 배송건번호: '2026102130000001', '배송비 형태': '선결제' });
    expect(values(sheet, 1)).toMatchObject({ '품목 실결제액(배송비 제외)': 7000, '배송비 합계': 0, '제주/도서 추가배송비': 0 });
  });
  it('내려받은 목록은 운송장번호를 바꿔 회신으로 올릴 수 있다', async () => {
    const book = new ExcelJS.Workbook(); await book.xlsx.load(await buildAdminListExportWorkbook(sheetFor([smartStoreDeliveryLine({ trackingNumber: null })]), new Date('2026-10-21T00:00:00Z')) as never);
    book.worksheets[0].getCell(2, HEADERS.indexOf('운송장번호') + 1).value = '001234567890';
    const parsed = await parseTrackingWorkbook(Buffer.from(await book.xlsx.writeBuffer()), [{ code: 'hanjin', label: '한진택배', active: true, trackingUrlTemplate: 'https://example.test/{trackingNumber}' }]);
    expect(parsed.issues).toEqual([]); expect(parsed.rows).toHaveLength(1);
  });
  it('빈 목록은 머리글을 유지하고, 중복 품목·누락 배송 건·불완전한 번호·깨진 날짜는 거절한다', () => {
    expect(sheetFor([], { recordCount: 0 }).columns).toHaveLength(HEADERS.length);
    expect(() => sheetFor([line, line])).toThrow('상품주문번호');
    expect(() => sheetFor([])).toThrow('배송 목록');
    expect(() => sheetFor([line], {}, { ...source, shipments: [] })).toThrow('배송 목록');
    expect(() => sheetFor([smartStoreDeliveryLine({ orderNumber: '0011ABCD' })])).toThrow('상품주문번호');
    expect(() => sheetFor([smartStoreDeliveryLine({ shippedAt: 'not-a-date' })])).toThrow('날짜');
  });
});
