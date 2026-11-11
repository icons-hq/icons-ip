import 'server-only';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  ICONS_INSTRUCTION_COLUMNS, iconsStandardBuyerName, iconsStandardDateText, shippingChargeLabel, type SmartStoreShipmentDetail,
} from './smartstore-shipment-workbook';
import { shipmentExportRowsCsv, type ShipmentExportLine } from './shipment-workbook';
import type { ShipmentExportData } from './shipment-dispatch';
import { warehouseExportTable, warehouseOperationalTable } from './warehouse-templates.server';
import { ADMIN_LIST_EXPORT_SCREENS, kstDateTimeText, kstFileStamp, listExportSheetName, normalizeListExportCell, type ListExportCellValue } from './list-export';
import { listExportPaymentMethodLabel } from './list-export-sheets';
import { addSafeWorkbookInfoSheet, addWorkbookTable } from './workbook-table';
import { isUuid } from '@/lib/uuid';
import { isCommerceNumber } from '@/lib/commerce-number';

type Shipment = ShipmentExportData['shipments'][number];

function money(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('상품주문 금액 정보를 확인해주세요.');
  return value;
}

function detail(line: ShipmentExportLine): SmartStoreShipmentDetail {
  const value = line.smartstore;
  if (!value || !isUuid(value.itemId) || !isCommerceNumber(value.orderNumber, 'order')
    || !isCommerceNumber(value.productOrderNumber, 'item') || !isCommerceNumber(value.shipmentNumber, 'shipment') || !value.goodId || !value.orderedAt
    || !Number.isSafeInteger(line.qty) || line.qty < 1 || !Number.isSafeInteger(line.unitPrice) || line.unitPrice < 0) {
    throw new Error('ICONS 표준 양식의 상품주문 정보를 확인하지 못했습니다. 목록을 새로고침해주세요.');
  }
  const gross = line.qty * line.unitPrice;
  if (!Number.isSafeInteger(gross)) throw new Error('상품주문 금액 정보를 확인해주세요.');
  // The discount can also include a promotion from the historical regular price.
  // The RPC validates its immutable allocations; today's unit price cannot reconstruct it.
  money(value.itemDiscount); money(value.itemTotal);
  return value;
}

function standardRow(shipment: Shipment, line: ShipmentExportLine, index: number): ListExportCellValue[] {
  const saved = detail(line);
  const paidShipping = money(shipment.shippingFee);
  const collectShipping = money(shipment.shippingCollectFee ?? 0);
  if (paidShipping === null || collectShipping === null) throw new Error('배송비 정보를 확인해주세요.');
  const shipping = paidShipping + collectShipping;
  if (!Number.isSafeInteger(shipping)) throw new Error('배송비 정보를 확인해주세요.');
  const values: Record<string, ListExportCellValue> = {
    주문번호: saved.orderNumber, 상품주문번호: saved.productOrderNumber, 배송건번호: saved.shipmentNumber,
    구매자: iconsStandardBuyerName(saved.buyerName, saved.buyerId), 수취인: line.recipient, 연락처: line.phone, 우편번호: line.postalCode, 주소: line.address,
    배송메시지: line.deliveryNote, 출고지: shipment.originName, 택배사: line.carrier, 운송장번호: null,
    상품번호: saved.goodId, 상품코드: line.goodCode, 상품명: line.goodName, 옵션: line.optionName, 옵션코드: line.variantCode, 수량: line.qty,
    '상품별 할인액': money(saved.itemDiscount), '품목 실결제액(배송비 제외)': money(saved.itemTotal),
    결제일: iconsStandardDateText(saved.paidAt), 결제수단: listExportPaymentMethodLabel(saved.paymentMethod),
    주문일시: iconsStandardDateText(saved.orderedAt), 발주확인일: iconsStandardDateText(saved.confirmedAt), '발송 예정일': iconsStandardDateText(saved.expectedShipDate),
    '배송비 형태': shippingChargeLabel(paidShipping, collectShipping),
    '배송비 합계': index === 0 ? shipping : 0,
    '제주/도서 추가배송비': index === 0 ? money(saved.regionalShippingFee) : 0,
    '배송비 할인액': index === 0 ? money(saved.shippingDiscount) : 0,
  };
  return ICONS_INSTRUCTION_COLUMNS.map(column => normalizeListExportCell(column.kind, values[column.header]));
}

function writeSupplement(workbook: ExcelJS.Workbook, supplement: NonNullable<ReturnType<typeof warehouseOperationalTable>>) {
  const sheet = workbook.addWorksheet('배송 운영 안내');
  sheet.columns = supplement.widths.map(width => ({ width }));
  sheet.addRow(supplement.headers).font = { bold: true };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const row of supplement.rows) sheet.addRow(row);
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: supplement.headers.length } };
}

/** 출고지시 파일의 맨 뒤 안내. 회신 방법과 선물·착불 주의를 머리글 위가 아니라 여기에 둔다. */
function instructionInfoLines(data: ShipmentExportData, rowCount: number, generatedAt: Date): [string, string][] {
  return [
    ['화면', ADMIN_LIST_EXPORT_SCREENS.dispatch.label],
    ['양식', 'ICONS 표준 양식'],
    ['출고지', [...new Set(data.shipments.map(shipment => shipment.originName))].join(', ')],
    ['내려받은 시각 (KST)', kstDateTimeText(generatedAt.toISOString())],
    ['건수', `${data.shipments.length.toLocaleString('ko-KR')}건 · 엑셀 ${rowCount.toLocaleString('ko-KR')}행`],
    ['안내', '한 행은 상품주문 한 개입니다. 배송비는 같은 배송건번호의 첫 행에 한 번만 기록합니다. 기록되지 않은 금액·날짜는 빈칸입니다.'],
    ['안내', '운송장 회신은 택배사와 운송장번호를 채운 뒤 이 XLSX(또는 내려받은 CSV)를 발주·발송 관리의 "엑셀 일괄 운송장 등록"에 올립니다. 비밀번호를 건 XLSX는 해제하지 않고 그대로 올리고 "파일 비밀번호" 칸에 입력합니다. 상품주문번호는 전체 번호를 유지해주세요.'],
    ['안내', '택배사는 ICONS에 등록된 이름 또는 코드를, 운송장번호는 실제 발급된 8~30자리 영숫자를 텍스트로 입력합니다. 같은 배송 건의 상품은 같은 택배사와 운송장번호로 등록합니다.'],
    ['안내', '퀵서비스·방문수령·직접전달은 주문 상세의 인계·수령 확인에서 처리합니다.'],
    ['안내', '합포장·선물·착불 조건이 있으면 별도 배송 운영 안내도 확인해주세요. 선물 주문의 배송 안내는 수취인 연락처를 이용하고, 내부 출고 파일을 수령인에게 동봉하지 마세요.'],
    ['개인정보', '개인정보가 담긴 파일입니다. 업무 목적 밖으로 공유하지 말고, 확인이 끝나면 삭제해주세요.'],
  ];
}

export async function buildSmartStoreShipmentExport(data: ShipmentExportData, fileFormat: 'xlsx' | 'csv', generatedAt = new Date()) {
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
    return standardRow(shipment, line, index);
  }));
  const supplement = warehouseOperationalTable(data.shipments);
  if (fileFormat === 'csv') {
    const csv = shipmentExportRowsCsv(ICONS_INSTRUCTION_COLUMNS.map(column => column.header), rows.map(row => row.map(value => value ?? '')));
    if (supplement) {
      const zip = new JSZip(), stamp = kstFileStamp(generatedAt);
      zip.file(`icons-출고지시-${stamp}.csv`, csv);
      zip.file(`icons-배송운영안내-${stamp}.csv`, shipmentExportRowsCsv(supplement.headers, supplement.rows));
      return { bytes: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), mime: 'application/zip', extension: 'zip' };
    }
    return { bytes: Buffer.from(csv, 'utf8'), mime: 'text/csv;charset=utf-8', extension: 'csv' };
  }
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ICONS';
  workbook.created = generatedAt;
  workbook.modified = generatedAt;
  addWorkbookTable(workbook, listExportSheetName(ADMIN_LIST_EXPORT_SCREENS.dispatch.label), ICONS_INSTRUCTION_COLUMNS, rows);
  if (supplement) writeSupplement(workbook, supplement);
  addSafeWorkbookInfoSheet(workbook, instructionInfoLines(data, rows.length, generatedAt));
  return { bytes: Buffer.from(await workbook.xlsx.writeBuffer()), mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' };
}
