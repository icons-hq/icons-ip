import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { smartStoreDeliveryListSheet } from './smartstore-delivery-list';
import { smartStoreDeliveryLine } from './smartstore-delivery-list.fixture';
import { buildAdminListExportWorkbook } from './list-export.server';
import { encryptAdminWorkbook } from './encrypted-workbook.server';
import format from './smartstore-delivery-format.json';
import type { AdminListExportSheet } from './list-export';
import officecrypto from 'officecrypto-tool';

const base: AdminListExportSheet = { screen: 'dispatch', title: '기존 목록', columns: [], rows: [], recordCount: 1, conditions: [], notes: [], filters: { tab: 'new' } };
function values(sheet: AdminListExportSheet, row = 0) { return Object.fromEntries(sheet.columns.map((column, i) => [column.header, sheet.rows[row][i]])); }

describe('첨부한 스마트스토어 배송현황관리 양식', () => {
  it('신규주문·배송현황 모두 원본 53열 순서와 단일 시트·색상·너비를 사용한다', async () => {
    for (const screen of ['dispatch', 'shipping'] as const) {
      const sheet = smartStoreDeliveryListSheet({ ...base, screen }, [smartStoreDeliveryLine()]);
      const plain = await buildAdminListExportWorkbook(sheet, new Date('2026-10-21T00:00:00Z'));
      const encrypted = encryptAdminWorkbook(plain, '1234');
      expect(officecrypto.isEncrypted(encrypted.bytes)).toBe(true);
      const decrypted = await officecrypto.decrypt(encrypted.bytes, { password: '1234' });
      const book = new ExcelJS.Workbook(); await book.xlsx.load(decrypted as never);
      expect(book.worksheets).toHaveLength(1);
      const actual = book.worksheets[0];
      expect(actual.name).toBe('배송현황관리');
      expect(actual.columnCount).toBe(53);
      expect(actual.getRow(1).values).toEqual([undefined, ...format.headers]);
      expect(actual.autoFilter).toBe('A1:BA1');
      expect(actual.views ?? []).toEqual([]);
      expect(actual.properties.defaultRowHeight).toBe(15);
      for (let c = 1; c <= 53; c++) {
        expect(actual.getColumn(c).width).toBe(28.5);
        expect(actual.getCell(1, c).font.bold).toBe(true);
        expect(actual.getCell(1, c).fill).toMatchObject({ fgColor: { argb: 'FFCCCCFF' } });
        expect(actual.getCell(1, c).alignment.horizontal).toBe('center');
      }
      expect(actual.getCell('A2').value).toBe('2026102120000001');
      expect(actual.getCell('B2').value).toBe('2026102110000001');
      expect(actual.getCell('A2').numFmt).toBe('@');
      expect(actual.getCell('C2').value).toEqual(new Date('2026-10-21T00:01:00Z'));
      expect(actual.getCell('C2').numFmt).toBe('yyyy/mm/dd hh:mm');
      expect(actual.getCell('I2').value).toBe('001234567890');
      expect(actual.getCell('Q2').type).toBe(ExcelJS.ValueType.String);
      expect(actual.getCell('V2').value).toBe(2);
      expect(actual.getCell('AB2').value).toBe(19000);
      expect(actual.getCell('AW2').value).toBe('01000000000');
      expect(actual.getCell('BA2').value).toBe('00123');
    }
  });
  it('상품별 실제 결제금액을 쓰고 배송비를 묶음의 첫 행에 한 번만 기록한다', () => {
    const sheet = smartStoreDeliveryListSheet(base, [smartStoreDeliveryLine(), smartStoreDeliveryLine({ itemId: '60000000-0000-4000-8000-000000000004', productOrderNumber: '2026102120000002', itemTotal: 7000 })]);
    expect(values(sheet)).toMatchObject({ '최종 상품별 총 주문금액': 19000, '배송비 합계': 3000, '배송비 묶음번호': '2026102130000001' });
    expect(values(sheet, 1)).toMatchObject({ '최종 상품별 총 주문금액': 7000, '배송비 합계': 0, '제주/도서 추가배송비': 0 });
    expect(values(sheet).상품가격).toBeNull();
    expect(values(sheet).옵션가격).toBeNull();
    expect(values(sheet).멤버십N배송).toBeNull();
    expect(values(sheet).자동구매확정예정일).toBeNull();
  });
  it('빈 목록은 헤더를 유지하고, 중복 품목·누락 배송 건·불완전한 번호는 거절한다', () => {
    expect(smartStoreDeliveryListSheet({ ...base, recordCount: 0 }, []).columns).toHaveLength(53);
    expect(() => smartStoreDeliveryListSheet(base, [smartStoreDeliveryLine(), smartStoreDeliveryLine()])).toThrow('상품주문번호');
    expect(() => smartStoreDeliveryListSheet(base, [])).toThrow('배송 목록');
    expect(() => smartStoreDeliveryListSheet(base, [smartStoreDeliveryLine({ orderNumber: '0011ABCD' })])).toThrow('상품주문번호');
  });
});
