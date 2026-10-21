import 'server-only';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import format from './smartstore-shipment-format.json';
import { SMARTSTORE_PARCEL_METHOD, type SmartStoreShipmentDetail } from './smartstore-shipment-workbook';
import { shipmentExportRowsCsv, type ShipmentExportLine } from './shipment-workbook';
import type { ShipmentExportData } from './shipment-dispatch';
import { warehouseExportTable, warehouseOperationalTable } from './warehouse-templates.server';
import { isUuid } from '@/lib/uuid';
import { isCommerceNumber } from '@/lib/commerce-number';

type Shipment = ShipmentExportData['shipments'][number];
type Cell = string | number | Date | null;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const AMOUNT_FORMAT = '""#,##0';
const DATE_FORMAT = 'yyyy/mm/dd hh:mm';
const notices = [
  "◈ 다운로드 받은 파일로 '엑셀 일괄발송' 처리하는 방법\n1. 상품주문번호, 배송방법, 택배사, 송장번호를 확인하고 입력해주세요.\n- 상품주문번호에는 ICONS에서 내려받은 전체 번호를 유지해주세요.\n2. 안내가 있는 1행을 삭제하고 시트명을 '발송처리'로 저장해주세요.\n3. 발주·발송 관리의 '엑셀 일괄 운송장 등록'에 파일을 올려주세요.\n\n※ 같은 배송 건에 속한 상품은 같은 택배사와 송장번호로 등록합니다.\n※ 선물 주문의 배송 안내는 수취인 연락처를 이용해주세요. 내부 출고 파일을 수령인에게 동봉하지 마세요.",
  '◈ 각 항목 입력 방법\n배송방법 - 택배,등기,소포\n택배사 - ICONS에 등록된 택배사 이름 또는 코드를 입력해주세요.\n송장번호 - 실제 발급된 8~30자리 영숫자를 텍스트로 입력해주세요.\n\n퀵서비스·방문수령·직접전달은 주문 상세의 인계·수령 확인에서 처리합니다.\n네이버 전용 수수료·멤버십·인증 정보와 기록되지 않은 금액은 빈칸입니다.\n합포장·선물·착불 조건이 있으면 별도 배송 운영 안내도 확인해주세요.',
];

function money(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('상품주문 금액 정보를 확인해주세요.');
  return value;
}

/** Excel has no timezone; persist the wall-clock value used by the Korean console. */
function excelDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const milliseconds = new Date(dateOnly ? `${value}T00:00:00Z` : value).valueOf();
  if (!Number.isFinite(milliseconds)) throw new Error('상품주문 날짜 정보를 확인해주세요.');
  return new Date(milliseconds + (dateOnly ? 0 : KST_OFFSET_MS));
}

function detail(line: ShipmentExportLine): SmartStoreShipmentDetail {
  const value = line.smartstore;
  if (!value || !isUuid(value.itemId) || !isCommerceNumber(value.orderNumber, 'order')
    || !isCommerceNumber(value.productOrderNumber, 'item') || !isCommerceNumber(value.shipmentNumber, 'shipment') || !value.goodId || !value.orderedAt
    || !Number.isSafeInteger(line.qty) || line.qty < 1 || !Number.isSafeInteger(line.unitPrice) || line.unitPrice < 0) {
    throw new Error('스마트스토어 양식의 상품주문 정보를 확인하지 못했습니다. 목록을 새로고침해주세요.');
  }
  const gross = line.qty * line.unitPrice;
  if (!Number.isSafeInteger(gross)) throw new Error('상품주문 금액 정보를 확인해주세요.');
  // The discount can also include a promotion from the historical regular price.
  // The RPC validates its immutable allocations; today's unit price cannot reconstruct it.
  money(value.itemDiscount); money(value.itemTotal);
  return value;
}

function smartStoreRow(shipment: Shipment, line: ShipmentExportLine, index: number): Cell[] {
  const saved = detail(line);
  const paidShipping = money(shipment.shippingFee);
  const collectShipping = money(shipment.shippingCollectFee ?? 0);
  if (paidShipping === null || collectShipping === null) throw new Error('배송비 정보를 확인해주세요.');
  const shipping = paidShipping + collectShipping;
  if (!Number.isSafeInteger(shipping)) throw new Error('배송비 정보를 확인해주세요.');
  const values: Record<string, Cell> = {
    상품주문번호: saved.productOrderNumber, 주문번호: saved.orderNumber,
    '배송방법(구매자 요청)': SMARTSTORE_PARCEL_METHOD, 배송방법: SMARTSTORE_PARCEL_METHOD,
    택배사: line.carrier, 송장번호: '', 발송일: excelDate(saved.shippedAt), 판매채널: 'ICONS',
    구매자명: saved.buyerName, 구매자ID: saved.buyerId, 수취인명: line.recipient, 주문상태: '발송대기',
    결제일: excelDate(saved.paidAt), 상품번호: saved.goodId, 상품명: line.goodName,
    옵션정보: line.optionName, 옵션관리코드: line.variantCode, 수량: line.qty,
    옵션가격: money(saved.optionPrice), 상품가격: money(saved.productPrice),
    '최종 상품별 할인액': money(saved.itemDiscount), '최초 상품별 할인액': money(saved.itemDiscount),
    '판매자 부담 할인액': money(saved.sellerDiscount),
    '최종 상품별 총 주문금액': money(saved.itemTotal), '최초 상품별 총 주문금액': money(saved.itemTotal),
    발주확인일: excelDate(saved.confirmedAt), 발송기한: excelDate(saved.expectedShipDate), 발송처리일: excelDate(saved.shippedAt),
    '배송비 형태': shipping === 0 ? '무료' : collectShipping > 0 ? paidShipping > 0 ? '선결제/착불' : '착불' : '선결제',
    '배송비 묶음번호': saved.shipmentNumber,
    '배송비 합계': index === 0 ? shipping : 0,
    '제주/도서 추가배송비': index === 0 ? money(saved.regionalShippingFee) : 0,
    '배송비 할인액': index === 0 ? money(saved.shippingDiscount) : 0,
    '판매자 상품코드': line.goodCode, 수취인연락처1: line.phone, 통합배송지: line.address,
    기본배송지: saved.address1, 상세배송지: saved.address2, 구매자연락처: saved.buyerPhone,
    우편번호: line.postalCode, 배송메세지: line.deliveryNote, 출고지: shipment.originName,
    결제수단: ({ card: '신용카드', bank_transfer: '무통장입금' } as Record<string, string>)[saved.paymentMethod] ?? '',
    주문일시: excelDate(saved.orderedAt),
  };
  return format.headers.map(header => values[header] ?? null);
}

function writeSupplement(workbook: ExcelJS.Workbook, supplement: NonNullable<ReturnType<typeof warehouseOperationalTable>>) {
  const sheet = workbook.addWorksheet('배송 운영 안내');
  sheet.columns = supplement.widths.map(width => ({ width }));
  sheet.addRow(supplement.headers).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const row of supplement.rows) sheet.addRow(row);
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: supplement.headers.length } };
}

export async function buildSmartStoreShipmentExport(data: ShipmentExportData, fileFormat: 'xlsx' | 'csv') {
  const groups = new Map<string, Shipment[]>();
  for (const shipment of data.shipments) {
    const group = groups.get(shipment.originId) ?? [];
    group.push(shipment); groups.set(shipment.originId, group);
  }
  if (!groups.size) throw new Error('내보낼 배송 건이 없습니다.');
  // Retain the existing gift, COD, packing and origin-contract validation.
  for (const group of groups.values()) warehouseExportTable(group);
  const itemIds = new Set<string>();
  const rows = data.shipments.flatMap(shipment => shipment.lines.map((line, index) => {
    const itemId = detail(line).itemId;
    if (itemIds.has(itemId)) throw new Error('상품주문번호가 중복되어 출고 파일을 만들지 않았습니다.');
    itemIds.add(itemId);
    return smartStoreRow(shipment, line, index);
  }));
  const supplement = warehouseOperationalTable(data.shipments);
  if (fileFormat === 'csv') {
    const csvRows = rows.map(row => row.map(value => value instanceof Date ? value.toISOString().slice(0, 16).replace('T', ' ') : value ?? ''));
    const csv = shipmentExportRowsCsv(format.headers, csvRows);
    if (supplement) {
      const zip = new JSZip();
      zip.file('ICONS-발주발송관리.csv', csv);
      zip.file('ICONS-배송운영안내.csv', shipmentExportRowsCsv(supplement.headers, supplement.rows));
      return { bytes: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), mime: 'application/zip', extension: 'zip' };
    }
    return { bytes: Buffer.from(csv, 'utf8'), mime: 'text/csv;charset=utf-8', extension: 'csv' };
  }
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(format.sheetName, { properties: { defaultRowHeight: format.defaultRowHeight } });
  sheet.columns = format.columns.map(column => ({ width: column.width, ...('numFmt' in column ? { style: { numFmt: column.numFmt } } : {}) }));
  sheet.getRow(1).height = format.noticeHeight;
  for (const range of format.merges) sheet.mergeCells(range);
  for (const [index, address] of ['A1', 'D1'].entries()) {
    sheet.getCell(address).value = notices[index];
    sheet.getCell(address).style = structuredClone(format.noticeStyle) as ExcelJS.Style;
  }
  sheet.getRow(2).values = [...format.headers];
  sheet.getRow(2).eachCell(cell => { cell.style = structuredClone(format.headerStyle) as ExcelJS.Style; });
  for (const values of rows) {
    const row = sheet.addRow(values);
    for (let index = 0; index < values.length; index++) {
      const value = values[index], cell = row.getCell(index + 1);
      cell.numFmt = value instanceof Date ? DATE_FORMAT : typeof value === 'number' ? AMOUNT_FORMAT : '@';
    }
  }
  sheet.autoFilter = `A2:BV${sheet.rowCount}`;
  if (supplement) writeSupplement(workbook, supplement);
  return { bytes: Buffer.from(await workbook.xlsx.writeBuffer()), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' };
}
