import 'server-only';
import ExcelJS from 'exceljs';
import type { createClient } from '@/lib/supabase/server';
import { isCommerceNumber } from '@/lib/commerce-number';
import { buildSettledExportModel, parseSettledExportSnapshot, type SettledExportModel, type SettledExportSnapshot } from './settled-export';
import { ExportRequestError } from './export-request.server';
import { SALES_DATE_FIELDS, SALES_ORDER_SEARCH_FIELDS } from './sales-list';
import { ADMIN_LIST_EXPORT_PRIVACY_NOTICE, kstDateTimeText, normalizeListExportCell } from './list-export';
import { WORKBOOK_FONT, finishWorkbookTable, styleWorkbookHeaderRow, workbookColumnStyle, type WorkbookColumnKind } from './workbook-format';
import { addSafeWorkbookInfoSheet, workbookHeaderWidth } from './workbook-table';

export const SETTLED_EXPORT_HEADERS = [
  '확정일 (KST)', '주문번호', '운송장', 'ERP 품명', '수량', '판매금액 (원)', '배송비 (원)', '결제일 (KST)',
  '할인 전 정가금액 (원)', '상품 할인 (원)', '쿠폰 적용 전 금액 (원)', '쿠폰 배분 (원)', '적립금 배분 (원)',
  'ERP 코드', '바코드', '주문 당시 상품명', '주문 당시 옵션명', '배송 건 번호', '주문 품목 번호', '결제일 근거', '미기록·확인 사유',
  '복수구매 할인 (원)', '착불 별도 지급 (원)', '착불 수납 상태', '금액 계산 버전', '배송비에 포함된 설치비 (원)', '배송비 쿠폰 차감 (원)',
] as const;
const ORDER_HEADERS = [
  '주문번호', '확정일 (KST)', '결제일 (KST)', '품목 수', '수량', '쿠폰 적용 전 금액 (원)', '쿠폰 (원)', '적립금 (원)',
  '배송비 원장 (원)', '주문 결제금액 (원)', '품목 판매금액 합계 (원)', '품목 배송비 합계 (원)', '품목 결제합계 (원)',
  '결제 원장금액 (원)', '품목 합계 − 주문 (원)', '결제 원장 − 주문 (원)', '결제 상태', '미기록·확인 사유',
  '복수구매 할인 (원)', '착불 별도 지급 원장 (원)', '품목 착불 합계 (원)', '착불 합계 − 원장 (원)', '금액 계산 버전', '배송비에 포함된 설치비 (원)', '배송비 쿠폰 차감 (원)',
] as const;
const HEADER_ROW = 6;
const FIRST_ROW = HEADER_ROW + 1;

/**
 * 화면·주문통합검색 파일과 대조하는 16자리 표시 번호.
 * 보존 영수증에는 UUID만 있어 파일을 만들 때 읽는다. 번호는 발급 후 바뀌지 않으므로 같은 영수증은 다시 받아도 같은 내용이다.
 * 번호가 없는 옛 건은 UUID로 남는다.
 */
export interface SettledExportNumbers { orders: ReadonlyMap<string, string>; items: ReadonlyMap<string, string>; shipments: ReadonlyMap<string, string> }
const NO_NUMBERS: SettledExportNumbers = { orders: new Map(), items: new Map(), shipments: new Map() };
/** 조회 주소 길이 안에서 한 번에 읽는 주문 수. 영수증은 최대 1,000건이다. */
const NUMBER_ORDER_BATCH = 100;
interface NumberRow { id: string; order_number?: unknown; order_items?: { id: string; product_order_number?: unknown }[] | null; order_shipments?: { id: string; shipment_number?: unknown }[] | null }

/** 읽기에 실패하면 파일을 만들지 않는다. UUID로 조용히 내려 대조가 틀어지는 것보다 다시 받게 한다. */
export async function loadSettledExportNumbers(client: Pick<Awaited<ReturnType<typeof createClient>>, 'from'>, orderIds: readonly string[]): Promise<SettledExportNumbers> {
  const orders = new Map<string, string>(), items = new Map<string, string>(), shipments = new Map<string, string>();
  for (let start = 0; start < orderIds.length; start += NUMBER_ORDER_BATCH) {
    const { data, error } = await client.from('orders')
      .select('id,order_number,order_items(id,product_order_number),order_shipments(id,shipment_number)')
      .in('id', [...orderIds.slice(start, start + NUMBER_ORDER_BATCH)]);
    if (error || !Array.isArray(data)) throw new ExportRequestError('주문번호를 확인하지 못해 파일을 만들지 않았습니다. 잠시 후 다시 내려받아 주세요.', 503);
    for (const order of data as unknown as NumberRow[]) {
      if (isCommerceNumber(order.order_number, 'order')) orders.set(order.id, order.order_number as string);
      for (const item of order.order_items ?? []) if (isCommerceNumber(item.product_order_number, 'item')) items.set(item.id, item.product_order_number as string);
      for (const shipment of order.order_shipments ?? []) if (isCommerceNumber(shipment.shipment_number, 'shipment')) shipments.set(shipment.id, shipment.shipment_number as string);
    }
  }
  return { orders, items, shipments };
}
const displayNumber = (numbers: ReadonlyMap<string, string>, id: string) => numbers.get(id) ?? id;

/* 머리글은 조건 줄 아래 6행에 둔다(보존 영수증의 머리글 위치). 모양만 공용 표준을 따른다. */
type SettledCell = string | number | Date | null;
/** Excel에는 시간대가 없다. KST 벽시계를 실제 날짜 셀로 적는다(대조·정렬·피벗용). 보이는 모양은 다른 엑셀과 같은 `YYYY-MM-DD HH:mm`이다. */
function excelKstDate(value: string | null) { return value === null ? null : new Date(Date.parse(value) + 9 * 60 * 60 * 1000); }
const DATE_CELL_FORMAT = 'yyyy-mm-dd hh:mm';
/** 확인할 사유가 있는 칸만 표시한다. */
const ISSUE_FILL = 'FFFFF0CF';

function columnKinds(count: number, dates: readonly number[], numbers: readonly number[]): WorkbookColumnKind[] {
  return Array.from({ length: count }, (_, index) => dates.includes(index + 1) ? 'date' : numbers.includes(index + 1) ? 'amount' : 'text');
}
function createSheet(workbook: ExcelJS.Workbook, name: string, headers: readonly string[], widths: number[], kinds: readonly WorkbookColumnKind[], model: SettledExportModel, definition: string) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = widths.map((width, index) => ({ width: Math.max(width, workbookHeaderWidth(headers[index])), style: { ...workbookColumnStyle(kinds[index]), ...(kinds[index] === 'date' ? { numFmt: DATE_CELL_FORMAT } : {}) } }));
  sheet.mergeCells(1, 1, 1, headers.length);
  sheet.getCell(1, 1).value = `ICONS ${name}`;
  sheet.getCell(1, 1).font = { ...WORKBOOK_FONT, bold: true };
  const { snapshot } = model;
  const filter = snapshot.filters;
  const metadata = [
    `보존 시각 (KST): ${kstDateTimeText(snapshot.capturedAt)}  영수증: ${snapshot.receiptId}`,
    `조회 기준: ${SALES_DATE_FIELDS.find(option=>option.value===(filter.dateField??'ordered'))!.label} (KST) ${filter.from ?? '시작 제한 없음'} ~ ${filter.to ?? '종료 제한 없음'}  검색 대상: ${SALES_ORDER_SEARCH_FIELDS.find(option=>option.value===(filter.field??'all'))!.label}  검색어: ${filter.query || '전체'}`,
    definition,
  ];
  metadata.forEach((value, index) => {
    const row = index + 2; sheet.mergeCells(row, 1, row, headers.length); sheet.getCell(row, 1).value = normalizeListExportCell('text', value);
    sheet.getCell(row, 1).font = { ...WORKBOOK_FONT };
  });
  const header = sheet.getRow(HEADER_ROW); header.values = [...headers];
  styleWorkbookHeaderRow(header);
  sheet.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}` };
  return sheet;
}
function addDataRow(sheet: ExcelJS.Worksheet, values: SettledCell[], kinds: readonly WorkbookColumnKind[], issueColumn: number) {
  // 날짜 외 셀 값은 언제나 문자열·숫자·빈 칸이다. `=`로 시작하는 이름도 문자열로 남고 식별자의 선행 0을 지킨다.
  const row = sheet.addRow(values.map((value, index) => value instanceof Date ? value : normalizeListExportCell(kinds[index], value)));
  if (issueColumn && row.getCell(issueColumn).value) {
    row.getCell(issueColumn).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ISSUE_FILL } };
    row.getCell(issueColumn).alignment = { wrapText: true, vertical: 'top' };
  }
}
function totals(sheet: ExcelJS.Worksheet, columns: number[], rows: (number | null)[][]) {
  // 합계 행은 필터·정렬 범위 밖에 둔다. 표를 마무리한 뒤 덧붙인다.
  const last = sheet.rowCount; finishWorkbookTable(sheet, sheet.columnCount, HEADER_ROW);
  // 27열 표를 옆으로 넘겨도 확정일·주문번호가 남게 앞 두 열도 고정한다.
  sheet.views = [{ state: 'frozen', ySplit: HEADER_ROW, xSplit: 2 }];
  const total = sheet.addRow(['합계']);
  total.font = { ...WORKBOOK_FONT, bold: true };
  total.getCell(1).border = { top: { style: 'thin' } };
  columns.forEach((column, index) => {
    const values = rows.map(row => row[index]);
    const complete = values.every(value => value !== null);
    const result = complete ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0) : '';
    if (typeof result === 'number' && !Number.isSafeInteger(result)) throw new Error('전체 합계가 엑셀의 정수 표현 범위를 초과합니다. 조회 기간을 줄여주세요.');
    const letter = sheet.getColumn(column).letter; const range = `${letter}${FIRST_ROW}:${letter}${last}`;
    const cell = total.getCell(column);
    cell.value = rows.length ? { formula: `IF(COUNT(${range})=ROWS(${range}),SUM(${range}),"")`, result } : null;
    cell.border = { top: { style: 'thin' } };
  });
}

export async function buildSettledWorkbook(value: unknown, readNumbers?: (snapshot: SettledExportSnapshot) => Promise<SettledExportNumbers>): Promise<Buffer> {
  const model = buildSettledExportModel(parseSettledExportSnapshot(value));
  const numbers = await readNumbers?.(model.snapshot) ?? NO_NUMBERS;
  const workbook = new ExcelJS.Workbook(); workbook.creator = 'ICONS';
  workbook.created = new Date(model.snapshot.capturedAt); workbook.modified = new Date(model.snapshot.capturedAt);
  workbook.calcProperties.fullCalcOnLoad = true;
  const detailKinds = columnKinds(SETTLED_EXPORT_HEADERS.length, [1, 8], [5, 6, 7, 9, 10, 11, 12, 13, 22, 23, 25, 26, 27]);
  const detail = createSheet(workbook, '거래확정 품목', SETTLED_EXPORT_HEADERS,
    [17, 22, 24, 31, 9, 18, 16, 17, 20, 17, 21, 17, 18, 23, 23, 31, 25, 22, 22, 22, 64, 20, 21, 28, 14, 23, 23], detailKinds, model,
    '판매금액은 기간·복수구매 할인·쿠폰·적립금 차감 후 금액입니다. 선결제 배송비와 착불 별도 지급은 배송 건 첫 품목에 기록합니다. 설치비는 선결제 배송비에 포함되며 별도 열은 포함 금액입니다. 배송비 쿠폰 열은 배송비에서 이미 차감된 금액입니다. 착불은 온라인 결제합계에서 제외합니다. 공란은 미기록입니다.');
  for (const row of model.lines) addDataRow(detail, [
    excelKstDate(row.doneAt), displayNumber(numbers.orders, row.orderId), row.trackingNumber, row.erpName, row.qty, row.salesAmount, row.shippingFee, excelKstDate(row.paidAt),
    row.regularAmount, row.productDiscount, row.beforeCouponAmount, row.couponAmount, row.creditAmount, row.erpCode, row.barcode,
    row.goodName, row.variantName, row.shipmentId === null ? null : displayNumber(numbers.shipments, row.shipmentId), displayNumber(numbers.items, row.itemId), row.paymentTimeSource, row.issues.join(' / '), row.volumeDiscount, row.shippingCollectFee, row.collectState, row.calculationVersion, row.installationFee, row.shippingCouponDiscount,
  ], detailKinds, 21);
  totals(detail, [5, 6, 7, 9, 10, 11, 12, 13, 22, 23, 26, 27], model.lines.map(row => [row.qty, row.salesAmount, row.shippingFee, row.regularAmount, row.productDiscount, row.beforeCouponAmount, row.couponAmount, row.creditAmount, row.volumeDiscount, row.shippingCollectFee, row.installationFee, row.shippingCouponDiscount]));
  const orderTotalColumns = [...Array.from({ length: 13 }, (_, index) => index + 4), 19, 20, 21, 22, 24, 25];
  const orderKinds = columnKinds(ORDER_HEADERS.length, [2, 3], [...orderTotalColumns, 23]);
  const orderSheet = createSheet(workbook, '주문 대조', ORDER_HEADERS,
    [22, 17, 17, 10, 10, 22, 17, 17, 20, 22, 24, 24, 22, 23, 24, 24, 18, 72, 20, 24, 22, 24, 14, 23, 23], orderKinds, model,
    '주문 원장과 품목 배분·결제 원장을 대조합니다. 차이 0원은 금액 일치이며, 시각·ERP 미기록 여부는 미기록·확인 사유 열에서 확인합니다. 공란은 확인할 기록이 없는 상태입니다.');
  for (const row of model.orders) addDataRow(orderSheet, [
    displayNumber(numbers.orders, row.id), excelKstDate(row.doneAt), excelKstDate(row.paidAt), row.itemCount, row.qty, row.beforeCouponAmount, row.couponDiscount, row.storeCredits,
    row.shippingFee, row.total, row.detailSales, row.detailShipping, row.detailTotal, row.paymentAmount, row.detailDifference, row.ledgerDifference,
    row.paymentStatus === 'paid' ? '결제 완료' : row.paymentStatus === 'refunded' ? '환불 기록' : row.paymentStatus, row.issues.join(' / '), row.volumeDiscount, row.shippingCollectTotal, row.detailShippingCollect, row.collectDifference, row.calculationVersion, row.installationFee, row.shippingCouponDiscount,
  ], orderKinds, 18);
  totals(orderSheet, orderTotalColumns, model.orders.map(row => [row.itemCount, row.qty, row.beforeCouponAmount, row.couponDiscount, row.storeCredits, row.shippingFee, row.total, row.detailSales, row.detailShipping, row.detailTotal, row.paymentAmount, row.detailDifference, row.ledgerDifference, row.volumeDiscount, row.shippingCollectTotal, row.detailShippingCollect, row.collectDifference, row.installationFee, row.shippingCouponDiscount]));
  if (model.snapshot.orders.some(o => o.coupons?.length)) {
    const couponKinds = columnKinds(5, [], [2, 5]);
    const couponSheet = createSheet(workbook, '쿠폰 사용', ['주문번호', '적용 순서', '쿠폰 코드', '할인 대상', '할인액 (원)'], [22, 14, 27, 18, 20], couponKinds, model, '주문 당시 적용한 쿠폰 순서와 할인액입니다. 상품 할인과 배송비 할인은 각각의 원장에 반영됩니다.');
    for (const order of model.snapshot.orders) for (const coupon of order.coupons ?? []) addDataRow(couponSheet, [displayNumber(numbers.orders, order.id), coupon.applicationIndex, coupon.code, coupon.benefitKind === 'shipping' ? '선결제 배송비' : '상품 금액', coupon.discountAmount], couponKinds, 0);
    totals(couponSheet, [5], model.snapshot.orders.flatMap(o => (o.coupons ?? []).map(c => [c.discountAmount])));
  }
  const { snapshot } = model, filter = snapshot.filters;
  addSafeWorkbookInfoSheet(workbook, [
    ['화면', '거래확정 내역'],
    ['조회 기준', `${SALES_DATE_FIELDS.find(option=>option.value===(filter.dateField??'ordered'))!.label} (KST) ${filter.from ?? '시작 제한 없음'} ~ ${filter.to ?? '종료 제한 없음'}`],
    ['검색 대상', SALES_ORDER_SEARCH_FIELDS.find(option=>option.value===(filter.field??'all'))!.label], ['검색어', filter.query || '전체'],
    ['보존 시각 (KST)', kstDateTimeText(snapshot.capturedAt)], ['영수증', snapshot.receiptId],
    ['건수', `주문 ${model.orders.length.toLocaleString('ko-KR')}건 · 품목 ${model.lines.length.toLocaleString('ko-KR')}행`],
    ['안내', '보존 시각의 주문·품목·배송·쿠폰·결제 기록입니다. 같은 영수증은 다시 받아도 같은 내용입니다.'],
    ['안내', '주문번호·배송 건 번호·주문 품목 번호는 화면과 같은 16자리 번호입니다. 번호가 없는 옛 기록은 내부 식별값으로 표시합니다.'],
    ['개인정보', ADMIN_LIST_EXPORT_PRIVACY_NOTICE],
  ]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
