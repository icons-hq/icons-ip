import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { settledExportFixture, settledExportV2Fixture } from '@/test/fixtures/settled-export';
import { buildSettledWorkbook, SETTLED_EXPORT_HEADERS } from './settled-workbook.server';
import { loadSafeWorkbook, readSafeWorkbookCell } from './workbook-safety';

describe('거래확정 XLSX 파일', () => {
  it('보존된 검색 대상을 두 시트에 같은 문자열로 기록한다', async () => {
    const source = settledExportFixture(); source.filters.field = 'tracking'; source.filters.query = '=GAP1530';
    const bytes = await buildSettledWorkbook(source);
    const workbook = await loadSafeWorkbook(bytes, { fileBytes: 2 * 1024 * 1024 });
    for (const sheet of workbook.worksheets) {
      expect(sheet.getCell('A3').type).toBe(ExcelJS.ValueType.String);
      expect(sheet.getCell('A3').value).toContain('검색 대상: 운송장번호');
      expect(sheet.getCell('A3').value).toContain('검색어: =GAP1530');
    }
  });
  it('8필수열·식별자·수식문자열·KST 자료형과 두 원장 합계를 실제 파일에서 보존한다', async () => {
    const bytes = await buildSettledWorkbook(settledExportFixture());
    const workbook = await loadSafeWorkbook(bytes, { fileBytes: 2 * 1024 * 1024 });
    const detail = workbook.getWorksheet('거래확정 품목')!;
    expect(detail.getRow(6).values).toEqual([undefined, ...SETTLED_EXPORT_HEADERS]);
    expect(detail.getCell('B7').type).toBe(ExcelJS.ValueType.String);
    expect(readSafeWorkbookCell(detail.getCell('C7'), true)).toEqual({ value: '000012345678' });
    expect(readSafeWorkbookCell(detail.getCell('N7'), true)).toEqual({ value: '0004951' });
    expect(detail.getCell('D7').type).toBe(ExcelJS.ValueType.String);
    expect(readSafeWorkbookCell(detail.getCell('D7'))).toEqual({ value: '=HYPERLINK("https://example.test","합성 ERP")' });
    expect(detail.getCell('A7').type).toBe(ExcelJS.ValueType.Date);
    expect((detail.getCell('H7').value as Date).toISOString()).toBe('2026-09-02T10:02:03.000Z');
    expect(detail.getCell('F10').value).toEqual({ formula: 'IF(COUNT(F7:F9)=ROWS(F7:F9),SUM(F7:F9),"")', result: 27001 });
    expect(detail.getCell('G10').result).toBe(5000);
    expect(detail.getCell('L10').result).toBe(1001);
    expect(detail.getCell('M10').result).toBe(1000);
    const order = workbook.getWorksheet('주문 대조')!;
    expect(order.getCell('J7').value).toBe(32001);
    expect(order.getCell('M7').value).toBe(32001);
    expect(order.getCell('N7').value).toBe(32001);
    expect(order.getCell('O7').value).toBe(0);
    expect(order.getCell('P7').value).toBe(0);
    expect(detail.views[0]).toMatchObject({ state: 'frozen', ySplit: 6, xSplit: 2 });
    expect(detail.autoFilter).toBeTruthy();
  });
  it('미기록 금액과 미완전 열의 합계를 빈칸으로 보존한다', async () => {
    const source = settledExportFixture(); source.orders[0].coupon!.terms = null;
    source.orders[0].items[0].erpName = null;
    source.orders[0].payments[0].approvedAt = null;
    const bytes = await buildSettledWorkbook(source);
    const workbook = await loadSafeWorkbook(bytes, { fileBytes: 2 * 1024 * 1024 });
    const detail = workbook.getWorksheet('거래확정 품목')!;
    expect(detail.getCell('D7').value).toBeNull();
    expect(detail.getCell('F7').value).toBeNull();
    expect(detail.getCell('H7').value).toBeNull();
    expect(detail.getCell('F10').result ?? '').toBe('');
    expect(String(detail.getCell('U7').value)).toContain('쿠폰 대상·금액');
    expect(workbook.getWorksheet('주문 대조')!.getCell('J7').value).toBe(32001);
  });
});


it('v2 복수 할인·별도 착불은 추가 열에 보존하고 PG 대조 합계에 섞지 않는다', async () => {
  const workbook = await loadSafeWorkbook(await buildSettledWorkbook(settledExportV2Fixture()), { fileBytes: 2 * 1024 * 1024 });
  const detail = workbook.getWorksheet('거래확정 품목')!;const orders = workbook.getWorksheet('주문 대조')!;
  expect(detail.getCell('V10').result).toBe(2000);expect(detail.getCell('W10').result).toBe(2250);
  expect(detail.getCell('X9').value).toBe('외부 수납 확인');expect(detail.getCell('Y9').value).toBe(2);
  expect(orders.getCell('J7').value).toBe(30001);expect(orders.getCell('N7').value).toBe(30001);
  expect(orders.getCell('S7').value).toBe(2000);expect(orders.getCell('T7').value).toBe(2250);expect(orders.getCell('V7').value).toBe(0);
});

it('배송비 쿠폰은 순액 배송비와 별도 차감 열·쿠폰별 사용 시트에 보존한다', async () => {
  const snapshot = settledExportV2Fixture(), order = snapshot.orders[0];
  order.shippingCouponDiscount = 1000; order.shippingFee -= 1000; order.total -= 1000; order.payments[0].amount -= 1000;
  order.shipments[0].shippingFee -= 1000; order.shippingComponents![0].totalFee -= 1000; order.shippingComponents![0].shippingCouponDiscount = 1000;
  order.coupons = [
    { code: 'GOODS-A', discountAmount: 501, benefitKind: 'goods', applicationIndex: 1 },
    { code: 'GOODS-B', discountAmount: 500, benefitKind: 'goods', applicationIndex: 2 },
    { code: 'SHIP-A', discountAmount: 1000, benefitKind: 'shipping', applicationIndex: 3 },
  ];
  const workbook = await loadSafeWorkbook(await buildSettledWorkbook(snapshot), { fileBytes: 2 * 1024 * 1024 });
  const detail = workbook.getWorksheet('거래확정 품목')!, orders = workbook.getWorksheet('주문 대조')!, coupons = workbook.getWorksheet('쿠폰 사용')!;
  expect(detail.getCell('AA10').result).toBe(1000); expect(detail.getCell('G10').result).toBe(4000);
  expect(orders.getCell('Y7').value).toBe(1000); expect(orders.getCell('J7').value).toBe(29001); expect(orders.getCell('O7').value).toBe(0);
  expect(coupons.getCell('C9').value).toBe('SHIP-A'); expect(coupons.getCell('D9').value).toBe('선결제 배송비'); expect(coupons.getCell('E10').result).toBe(2001);
});
