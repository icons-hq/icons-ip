import 'server-only';
import ExcelJS from 'exceljs';
import { buildSettledExportModel, parseSettledExportSnapshot, type SettledExportModel } from './settled-export';

export const SETTLED_EXPORT_HEADERS = [
  '확정일 (KST)', '주문번호', '운송장', 'ERP 품명', '수량', '판매금액 (원)', '배송비 (원)', '결제일 (KST)',
  '할인 전 정가금액 (원)', '상품 할인 (원)', '쿠폰 적용 전 금액 (원)', '쿠폰 배분 (원)', '적립금 배분 (원)',
  'ERP 코드', '바코드', '주문 당시 상품명', '주문 당시 옵션명', '배송 건 번호', '주문 품목 번호', '결제일 근거', '미기록·확인 사유',
] as const;
const ORDER_HEADERS = [
  '주문번호', '확정일 (KST)', '결제일 (KST)', '품목 수', '수량', '쿠폰 적용 전 금액 (원)', '쿠폰 (원)', '적립금 (원)',
  '배송비 원장 (원)', '주문 결제금액 (원)', '품목 판매금액 합계 (원)', '품목 배송비 합계 (원)', '품목 결제합계 (원)',
  '결제 원장금액 (원)', '품목 합계 − 주문 (원)', '결제 원장 − 주문 (원)', '결제 상태', '미기록·확인 사유',
] as const;
const HEADER_ROW = 6;
const FIRST_ROW = HEADER_ROW + 1;

/** Excel has no timezone. Encode KST wall-clock as a typed Excel date. */
function excelKstDate(value: string | null) { return value === null ? null : new Date(Date.parse(value) + 9 * 60 * 60 * 1000); }
function kstLabel(value: string) { return new Date(Date.parse(value) + 9 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' '); }
function createSheet(workbook: ExcelJS.Workbook, name: string, headers: readonly string[], widths: number[], model: SettledExportModel, definition: string) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = widths.map(width => ({ width }));
  sheet.mergeCells(1, 1, 1, headers.length);
  sheet.getCell(1, 1).value = `ICONS ${name}`;
  sheet.getCell(1, 1).font = { name: '맑은 고딕', size: 16, bold: true, color: { argb: 'FF17201C' } };
  sheet.getRow(1).height = 29;
  const { snapshot } = model;
  const filter = snapshot.filters;
  const metadata = [
    `보존 시각 (KST): ${kstLabel(snapshot.capturedAt)}  영수증: ${snapshot.receiptId}`,
    `조회 기준: 주문일 (KST) ${filter.from ?? '시작 제한 없음'} ~ ${filter.to ?? '종료 제한 없음'}  검색어: ${filter.query || '전체'}`,
    definition,
  ];
  metadata.forEach((value, index) => {
    const row = index + 2; sheet.mergeCells(row, 1, row, headers.length); sheet.getCell(row, 1).value = value;
    sheet.getCell(row, 1).font = { name: '맑은 고딕', size: 10, color: { argb: 'FF4C5851' } };
    sheet.getRow(row).height = 23;
  });
  const header = sheet.getRow(HEADER_ROW); header.values = [...headers]; header.height = 34;
  header.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF173C2E' } };
    cell.font = { name: '맑은 고딕', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
  });
  sheet.views = [{ state: 'frozen', ySplit: HEADER_ROW, xSplit: 2, showGridLines: false }];
  sheet.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}` };
  return sheet;
}
function addDataRow(sheet: ExcelJS.Worksheet, values: (string | number | Date | null)[], dateColumns: number[], amountColumns: number[], issueColumn: number) {
  const row = sheet.addRow(values); let wrappedLines = 1;
  row.eachCell({ includeEmpty: true }, (cell, column) => {
    cell.font = { name: '맑은 고딕', size: 10, color: { argb: 'FF25332B' } };
    cell.alignment = { vertical: 'middle', wrapText: typeof cell.value === 'string' };
    if (typeof cell.value === 'string') {
      const width = Math.max(1, (sheet.getColumn(column).width ?? 22) - 2);
      const length = [...cell.value].reduce((size, char) => size + (char.codePointAt(0)! > 127 ? 2 : 1), 0);
      wrappedLines = Math.max(wrappedLines, Math.ceil(length / width), cell.value.split('\n').length);
    }
    // ExcelJS writes a plain string as shared text, including =, +, -, and @.
    // Identifiers therefore retain leading zeroes without becoming formulas.
    cell.numFmt = typeof cell.value === 'string' ? '@' : dateColumns.includes(column) ? 'yyyy-mm-dd hh:mm' : amountColumns.includes(column) ? '#,##0;[Red](#,##0);0' : '#,##0';
    if (column === issueColumn && cell.value) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF0CF' } };
  });
  row.height = Math.min(409, Math.max(36, wrappedLines * 14 + 8));
}
function totals(sheet: ExcelJS.Worksheet, columns: number[], rows: (number | null)[][]) {
  const last = sheet.rowCount; const total = sheet.addRow(['합계']); total.height = 24;
  total.font = { name: '맑은 고딕', size: 10, bold: true };
  total.eachCell({ includeEmpty: true }, cell => { cell.border = { top: { style: 'thin', color: { argb: 'FF173C2E' } } }; });
  columns.forEach((column, index) => {
    const values = rows.map(row => row[index]);
    const complete = values.every(value => value !== null);
    const result = complete ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) : '';
    if (typeof result === 'number' && !Number.isSafeInteger(result)) throw new Error('전체 합계가 엑셀의 정수 표현 범위를 초과합니다. 조회 기간을 줄여주세요.');
    const letter = sheet.getColumn(column).letter; const range = `${letter}${FIRST_ROW}:${letter}${last}`;
    const cell = total.getCell(column);
    cell.value = rows.length ? { formula: `IF(COUNT(${range})=ROWS(${range}),SUM(${range}),"")`, result } : null;
    cell.numFmt = '#,##0;[Red](#,##0);0';
    cell.border = { top: { style: 'thin', color: { argb: 'FF173C2E' } } };
  });
  sheet.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: Math.max(HEADER_ROW, last), column: sheet.columnCount } };
}

export async function buildSettledWorkbook(value: unknown): Promise<Buffer> {
  const model = buildSettledExportModel(parseSettledExportSnapshot(value));
  const workbook = new ExcelJS.Workbook(); workbook.creator = 'ICONS';
  workbook.created = new Date(model.snapshot.capturedAt); workbook.modified = new Date(model.snapshot.capturedAt);
  workbook.calcProperties.fullCalcOnLoad = true;
  const detail = createSheet(workbook, '거래확정 품목', SETTLED_EXPORT_HEADERS,
    [23, 39, 24, 31, 9, 18, 16, 23, 20, 17, 21, 17, 18, 23, 23, 31, 25, 39, 39, 22, 64], model,
    '판매금액은 상품 할인·쿠폰·적립금 차감 후 금액입니다. 배송비는 배송 건 첫 품목에 한 번 기록합니다. 공란은 미기록이며, 불완전한 열의 합계도 공란입니다.');
  for (const row of model.lines) addDataRow(detail, [
    excelKstDate(row.doneAt), row.orderId, row.trackingNumber, row.erpName, row.qty, row.salesAmount, row.shippingFee, excelKstDate(row.paidAt),
    row.regularAmount, row.productDiscount, row.beforeCouponAmount, row.couponAmount, row.creditAmount, row.erpCode, row.barcode,
    row.goodName, row.variantName, row.shipmentId, row.itemId, row.paymentTimeSource, row.issues.join(' / '),
  ], [1, 8], [5, 6, 7, 9, 10, 11, 12, 13], 21);
  totals(detail, [5, 6, 7, 9, 10, 11, 12, 13], model.lines.map(row => [row.qty, row.salesAmount, row.shippingFee, row.regularAmount, row.productDiscount, row.beforeCouponAmount, row.couponAmount, row.creditAmount]));
  const orderSheet = createSheet(workbook, '주문 대조', ORDER_HEADERS,
    [39, 23, 23, 10, 10, 22, 17, 17, 20, 22, 24, 24, 22, 23, 24, 24, 18, 72], model,
    '주문 원장과 품목 배분·결제 원장을 대조합니다. 차이 0원은 금액 일치이며, 시각·ERP 미기록 여부는 마지막 열에서 확인합니다. 공란은 확인할 기록이 없는 상태입니다.');
  for (const row of model.orders) addDataRow(orderSheet, [
    row.id, excelKstDate(row.doneAt), excelKstDate(row.paidAt), row.itemCount, row.qty, row.beforeCouponAmount, row.couponDiscount, row.storeCredits,
    row.shippingFee, row.total, row.detailSales, row.detailShipping, row.detailTotal, row.paymentAmount, row.detailDifference, row.ledgerDifference,
    row.paymentStatus === 'paid' ? '결제 완료' : row.paymentStatus === 'refunded' ? '환불 기록' : row.paymentStatus, row.issues.join(' / '),
  ], [2, 3], Array.from({ length: 13 }, (_, index) => index + 4), 18);
  totals(orderSheet, Array.from({ length: 13 }, (_, index) => index + 4), model.orders.map(row => [row.itemCount, row.qty, row.beforeCouponAmount, row.couponDiscount, row.storeCredits, row.shippingFee, row.total, row.detailSales, row.detailShipping, row.detailTotal, row.paymentAmount, row.detailDifference, row.ledgerDifference]));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
