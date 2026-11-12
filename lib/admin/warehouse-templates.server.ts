import 'server-only';
import { parseShipmentPackSummary } from './shipment-packs';
import {
  WAREHOUSE_OPERATION_HEADERS, GIMPO_COLUMNS, SEOWON_COLUMNS, GIMPO_EXPORT_HEADERS, SEOWON_EXPORT_HEADERS, SEOWON_REPLY_TRACKING_HEADERS,
  SEOWON_SHEET_NAME, SEOWON_TEMPLATE_HEADERS, GIMPO_TEMPLATE_HEADERS, GIMPO_APPENDED_HEADERS,
} from './warehouse-templates';
import type ExcelJS from 'exceljs';
import type { ShipmentExportData } from './shipment-dispatch';
import { parseShipmentExportColumns, shipmentExportCells } from './shipment-workbook';
import { TRACKING_IMPORT_ROW_LIMIT, type TrackingImportParseResult } from './tracking-import';
import type { SmartStoreTrackingParseResult } from './smartstore-tracking-workbook.server';
import { readSafeWorkbookCell } from './workbook-safety';
import { seowonExportTable, type SeowonReplyRow } from './seowon-exchange';
import { isTrackingNumber, normalizeTrackingNumber } from '@/lib/orders/shipment';
import { isCommerceNumber } from '@/lib/commerce-number';
import { transactionExactKeys, transactionRecord } from '@/lib/goods-transaction-values';

type Shipments = ShipmentExportData['shipments'];
type Shipment = Shipments[number];
type Line = Shipment['lines'][number];
type Cell = string | number;


const postalCode = (value: string) => /^\d{5}$/.test(value) ? value : '';
const itemLabel = (good: string, option: string, qty: number) => `${good}/${option}(${qty})`;
function validCollector(value: unknown) {
  return transactionRecord(value) && transactionExactKeys(value, ['name', 'method', 'refundContact', 'instructions'])
    && ['name', 'method', 'refundContact', 'instructions'].every(key => typeof value[key] === 'string' && value[key].trim() && !/[\u0000-\u001f\u007f]/.test(value[key]));
}

function gimpoCells(shipment: Shipment, line: Line, index: number): Cell[] {
  // 10/27 회의(D10②)·11/03 결정: ERP 품명이 있으면 상품명(확정)·옵션(확정)과 두 조합 열을 ERP 품명으로 맞춘다.
  // 옵션(수집)은 쇼핑몰에서 수집한 옵션명 그대로다. 회신 대조는 주문번호(쇼핑몰)로만 하므로 조합 열이 바뀌어도 된다.
  const erpName = line.erpName?.trim();
  const confirmedGood = erpName || line.goodName, confirmedOption = erpName || line.optionName;
  const values: Record<typeof GIMPO_COLUMNS[number]['key'], Cell> = {
    collectedItem: itemLabel(confirmedGood, line.optionName, line.qty), confirmedItem: ` ${itemLabel(confirmedGood, confirmedOption, line.qty)}`,
    address: line.address, recipientShop: `${line.recipient}/ICONS/`, phone: line.phone,
    // 10/14 회의(1014-096): 주문번호(쇼핑몰)는 UUID 대신 표시 주문번호다. 회신 대조 키라 `warehouseExportTable`이 번호를 먼저 확인한다.
    otherPhone: '', deliveryNote: line.deliveryNote, sabangnetOrder: '', orderNumber: shipment.orderNumber ?? '',
    optionAlias: '', goodName: confirmedGood, collectedOption: line.optionName, confirmedOption,
    supplyPrice: '', unitPrice: line.unitPrice, qty: line.qty, ea: '', postalCode: postalCode(line.postalCode),
    recipient: line.recipient, shippingFee: index === 0 ? shipment.shippingFee : 0, trackingNumber: '',
    // 10/27 회의(1027T-046): 원본 21열 오른쪽에 옵션의 바코드·ERP 품명을 덧붙인다. 없으면 빈칸이다.
    barcode: (line.barcode ?? '').trim(), erpName: erpName ?? '',
  };
  return GIMPO_COLUMNS.map(column => values[column.key]);
}

/** 배송 운영 안내의 번호는 본 시트와 같은 표시 번호다. 번호가 없는 옛 응답만 UUID로 남긴다. */
const shipmentReference = (shipment: Shipment) => isCommerceNumber(shipment.shipmentNumber, 'shipment') ? shipment.shipmentNumber! : shipment.id;
const orderReference = (shipment: Shipment) => isCommerceNumber(shipment.orderNumber, 'order') ? shipment.orderNumber! : shipment.lines[0].orderId;

/**
 * 한 출고지 묶음의 선물·착불·합포장·양식·수량 계약을 확인한다. ICONS 표준 양식도 같은 계약을 쓰므로 행을 만들지 않고 이것만 부른다.
 * 창고 양식 고유의 금액·번호 칸 확인은 그 양식의 행을 만들 때(`warehouseExportTable`) 한다. 실패하면 파일을 만들지 않는다.
 */
export function assertWarehouseExportShipments(shipments: Shipments) {
  const first = shipments[0];
  if (!first) throw new Error('내보낼 배송 건이 없습니다.');
  for (const shipment of shipments) {
    if (shipment.pack && (!parseShipmentPackSummary(shipment.pack) || !shipment.pack.shipmentIds.includes(shipment.id) || shipment.pack.shipmentIds.some(id => !shipments.some(member => member.id === id && member.pack?.id === shipment.pack?.id)))) throw new Error('합포장의 모든 배송 건을 선택해주세요.');
    if (shipment.isGift !== undefined && typeof shipment.isGift !== 'boolean'
      // 착불 금액이 비어 온 응답(null)은 착불 없음으로 보고 거절하지 않는다. 숫자가 잘못됐으면 거절한다.
      // (물류 출고 권한도 2026-11-12 결정으로 착불 금액을 받으므로 지금 앱이 null을 보내는 경로는 없다.)
      || shipment.shippingCollectFee != null && (!Number.isSafeInteger(shipment.shippingCollectFee) || shipment.shippingCollectFee < 0)
      || (shipment.shippingCollectFee ?? 0) > 0 && !validCollector(shipment.collector)
      || shipment.isGift && shipment.lines.some(line => !line.recipient.trim() || !line.address.trim() || !/^\d{5}$/.test(line.postalCode) || !/^[0-9]{8,15}$/.test(line.phone))) {
      throw new Error('선물·착불 배송 정보를 확인하지 못해 출고 파일을 만들지 않았습니다.');
    }
    if (!['standard', 'wms_csv', 'seowon_xlsx'].includes(shipment.template)
      || shipment.template !== first.template || shipment.originId !== first.originId || !shipment.lines.length
      || (shipment.template === 'standard' && !parseShipmentExportColumns(shipment.columns))) {
      throw new Error('출고지시 양식 또는 상품 정보를 확인해주세요.');
    }
    if (shipment.template === 'seowon_xlsx' && shipment.lines.some(line => !Number.isSafeInteger(line.qty) || line.qty < 1)) {
      throw new Error('출고지시 수량 정보를 확인해주세요.');
    }
  }
  // 김포·서원 회신은 내려받은 파일에 운송장만 채워 올린다. 회신 한도(1,000줄)를 넘는 파일은 만들지 않는다.
  if (first.template !== 'standard' && shipments.reduce((rows, shipment) => rows + shipment.lines.length, 0) > TRACKING_IMPORT_ROW_LIMIT) {
    throw new Error(`한 출고지 파일은 품목 ${TRACKING_IMPORT_ROW_LIMIT.toLocaleString('ko-KR')}줄까지 만들 수 있습니다. 배송 건을 나눠서 내보내주세요.`);
  }
  return first;
}

/** Export one origin using its native contract; callers only serialize the resulting table. */
export function warehouseExportTable(shipments: Shipments) {
  const first = assertWarehouseExportShipments(shipments);
  if (first.template === 'seowon_xlsx') return {
    headers: SEOWON_EXPORT_HEADERS, widths: SEOWON_COLUMNS.map(column => column.width),
    textColumns: SEOWON_COLUMNS.map(column => column.text),
    rows: seowonExportTable(shipments.map(shipment => ({ id: shipment.id, shipmentNumber: shipment.shipmentNumber ?? null,
      orderNumber: isCommerceNumber(shipment.orderNumber, 'order') ? shipment.orderNumber : null, packId: shipment.pack?.id ?? null, lines: shipment.lines })))
      .map(row => SEOWON_COLUMNS.map(column => row[column.key])),
  };
  // 김포 21열에는 주문금액/수량·배송비(수집) 칸이 있다. 금액을 지어내지 않도록 주문 당시 값이 없으면 만들지 않는다.
  // (ICONS 표준 양식은 위 계약 확인만 쓰고 자기 금액 칸은 비운 값을 빈칸으로 둔다.)
  if (first.template === 'wms_csv' && shipments.some(shipment => !Number.isSafeInteger(shipment.shippingFee) || shipment.shippingFee < 0
    || shipment.lines.some(line => !Number.isSafeInteger(line.unitPrice) || line.unitPrice < 0))) {
    throw new Error('출고지시 금액 정보를 확인해주세요.');
  }
  // 김포 회신은 주문번호(쇼핑몰)로만 배송 건을 찾는다. 번호를 확인하지 못하면 회신이 돌아오지 않는 파일을 만들지 않는다.
  if (first.template === 'wms_csv' && shipments.some(shipment => !isCommerceNumber(shipment.orderNumber, 'order'))) {
    throw new Error('출고지시 주문번호를 확인하지 못했습니다. 목록을 새로고침해주세요.');
  }
  if (first.template === 'wms_csv') return {
    headers: GIMPO_EXPORT_HEADERS, widths: GIMPO_COLUMNS.map(column => column.width),
    textColumns: GIMPO_COLUMNS.map(column => column.text),
    rows: shipments.flatMap(shipment => shipment.lines.map((line, index) => gimpoCells(shipment, line, index))),
  };
  return {
    headers: first.columns.map(column => column.header),
    widths: first.columns.map(column => column.key === 'address' ? 48 : column.key.endsWith('Id') ? 40 : 22),
    textColumns: first.columns.map(column => column.key !== 'qty'),
    rows: shipments.flatMap(shipment => shipment.lines.map(line => shipmentExportCells(line, first.columns))),
  };
}

/** Native warehouse column counts stay fixed; extra instructions have their own table. */
export function warehouseOperationalTable(shipments: Shipments) {
  const selected = shipments.filter(shipment => shipment.isGift || (shipment.shippingCollectFee ?? 0) > 0 || shipment.pack);
  if (!selected.length) return null;
  return {
    headers: WAREHOUSE_OPERATION_HEADERS,
    widths: [40, 40, 14, 50, 16, 20, 24, 36, 50, 36, 40, 18, 20, 60],
    rows: selected.map(shipment => [shipmentReference(shipment), orderReference(shipment), shipment.isGift ? '선물' : '일반',
      shipment.isGift ? '수령인용 명세에 가격·할인·결제정보를 표시하지 마세요. 내부 출고 파일은 포장에 동봉하지 마세요.' : '',
      (shipment.shippingFee as number | null) ?? '', (shipment.shippingCollectFee as number | null | undefined) === null ? '' : shipment.shippingCollectFee ?? 0, shipment.collector?.name ?? '', shipment.collector?.method ?? '',
      shipment.collector?.instructions ?? '', shipment.collector?.refundContact ?? '', shipment.pack?.id ?? '', shipment.pack?.count ?? '', shipment.pack?.collectFee ?? '', shipment.pack ? '같은 합포장번호의 모든 상품을 하나로 포장하고 동일 택배사·송장을 회신해주세요. 원래 주문번호·배송비·착불 금액을 유지합니다.' : ''] as Cell[]),
  };
}

/* 제공 원본 `송장양식`의 서식(styles.xml cellXfs 1~11)을 그대로 옮긴다. 글꼴은 맑은 고딕 10pt,
   헤더 노랑=필수·회색=선택·초록=피킹, 수량·품목명 칸은 데이터 행도 초록이다. */
const SEOWON_FONT = { name: '맑은 고딕', size: 10, family: 3, charset: 129, scheme: 'minor', color: { theme: 1 } } as Partial<ExcelJS.Font>;
const SEOWON_FILLS = {
  required: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' }, bgColor: { indexed: 64 } },
  optional: { type: 'pattern', pattern: 'solid', fgColor: { theme: 0, tint: -0.14999847407452621 }, bgColor: { indexed: 64 } },
  picking: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF92D050' }, bgColor: { indexed: 64 } },
} as unknown as Record<'required' | 'optional' | 'picking', ExcelJS.Fill>;
const SEOWON_QUANTITY_FORMAT = '#,##0_);[Red]\\(#,##0\\)';
type SeowonColumn = typeof SEOWON_COLUMNS[number];
/** 숫자로 읽히면 앞자리 0·자릿수를 잃는 칸은 텍스트 서식이다. */
const SEOWON_TEXT_KEYS = new Set<SeowonColumn['key']>(['phone', 'shipmentNumber', 'barcode', 'orderNumber']);
function seowonHeaderStyle(column: SeowonColumn): Partial<ExcelJS.Style> {
  const centered = column.fill === 'optional' || column.key === 'quantity';
  return {
    font: { ...SEOWON_FONT, bold: true }, fill: SEOWON_FILLS[column.fill],
    alignment: { vertical: 'middle', ...(centered ? { horizontal: 'center' } : column.key === 'items' ? { horizontal: 'left' } : {}) },
    ...(SEOWON_TEXT_KEYS.has(column.key) ? { numFmt: '@' } : column.key === 'quantity' ? { numFmt: SEOWON_QUANTITY_FORMAT } : {}),
  };
}
function seowonCellStyle(column: SeowonColumn): Partial<ExcelJS.Style> {
  return {
    font: { ...SEOWON_FONT }, alignment: { vertical: 'middle', ...(column.key === 'items' ? { horizontal: 'left' } : {}) },
    ...(column.fill === 'picking' ? { fill: SEOWON_FILLS.picking } : {}),
    ...(column.key === 'quantity' ? { numFmt: SEOWON_QUANTITY_FORMAT } : SEOWON_TEXT_KEYS.has(column.key) ? { numFmt: '@' } : {}),
  };
}

/** 서원 파일은 `송장양식` 시트 하나만 만든다. 열 너비·서식은 원본과 같고 값은 모두 문자열/정수다. */
export function writeSeowonSheet(workbook: ExcelJS.Workbook, rows: readonly (readonly Cell[])[]) {
  const sheet = workbook.addWorksheet(SEOWON_SHEET_NAME, { properties: { defaultRowHeight: 17 }, views: [{ state: 'normal' }] });
  sheet.columns = SEOWON_COLUMNS.map(column => ({ width: column.width, style: seowonCellStyle(column) }));
  const header = sheet.addRow([...SEOWON_EXPORT_HEADERS]);
  SEOWON_COLUMNS.forEach((column, index) => { header.getCell(index + 1).style = seowonHeaderStyle(column); });
  for (const values of rows) {
    const row = sheet.addRow([...values]);
    SEOWON_COLUMNS.forEach((column, index) => { row.getCell(index + 1).style = seowonCellStyle(column); });
  }
  return sheet;
}

export interface WarehouseTrackingParseResult {
  kind: 'gimpo';
  rows: { line: number; reference: string; trackingNumber: string }[];
  issues: TrackingImportParseResult['issues'];
}
export interface SeowonTrackingParseResult { kind: 'seowon'; rows: SeowonReplyRow[]; issues: TrackingImportParseResult['issues'] }
export type TrackingWorkbookParseResult = TrackingImportParseResult | WarehouseTrackingParseResult | SeowonTrackingParseResult | SmartStoreTrackingParseResult;
const ORDER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/**
 * 김포 회신의 주문 식별값. 지금 파일은 표시 주문번호이고, 11/12 이전에 내려받은 파일은 전체 주문 UUID다.
 * 주문번호 형식 판정은 `isCommerceNumber` 한 곳을 따른다(번호 체계가 바뀌면 그 함수만 바뀐다).
 */
const isGimpoOrderReference = (value: string) => ORDER_UUID.test(value) || isCommerceNumber(value, 'order');
const GIMPO_NATIVE_COLUMNS = GIMPO_COLUMNS.filter(column => !('appended' in column));
const GIMPO_REPLY_EXTRA_HEADERS = new Set<string>(['', ...GIMPO_APPENDED_HEADERS]);

/**
 * null means this is not a Gimpo reply: the 21 native headers must stay in A~U. Columns to the right may only be the
 * appended 바코드·ERP 품명 (or blank-headed); their values are never read. Old 21-column files remain valid.
 */
export function parseWarehouseReply(sheet: ExcelJS.Worksheet): WarehouseTrackingParseResult | null {
  const title = (column: number) => readSafeWorkbookCell(sheet.getRow(1).getCell(column));
  if (sheet.columnCount < GIMPO_TEMPLATE_HEADERS.length || !GIMPO_TEMPLATE_HEADERS.every((header, index) => {
    const cell = title(index + 1);
    return !cell.error && cell.value === header;
  })) return null;
  const extra = new Set<string>();
  for (let column = GIMPO_TEMPLATE_HEADERS.length + 1; column <= sheet.columnCount; column++) {
    const cell = title(column), header = cell.value.trim();
    if (cell.error || !GIMPO_REPLY_EXTRA_HEADERS.has(header) || header && extra.has(header)) return null;
    extra.add(header);
  }
  const rows: WarehouseTrackingParseResult['rows'] = [], issues: WarehouseTrackingParseResult['issues'] = [];
  const blocked = new Set<string>();
  for (let line = 2; line <= sheet.rowCount; line++) {
    const source = sheet.getRow(line);
    const cells = GIMPO_NATIVE_COLUMNS.map((column, index) => ({ key: column.key,
      ...readSafeWorkbookCell(source.getCell(index + 1), column.key === 'orderNumber' || column.key === 'trackingNumber'),
    }));
    if (cells.every(cell => !cell.value && !cell.error)) continue;
    const reference = cells.find(cell => cell.key === 'orderNumber')!.value.trim().toLowerCase();
    const tracking = cells.find(cell => cell.key === 'trackingNumber')!.value;
    const trackingNumber = normalizeTrackingNumber(tracking.trim());
    const reason = cells.find(cell => cell.error)?.error
      ?? (!isGimpoOrderReference(reference) ? '주문번호(쇼핑몰)에 ICONS 출고 파일의 전체 주문번호를 그대로 유지해주세요.' : undefined)
      ?? (!isTrackingNumber(trackingNumber) || /[\r\n\t]/.test(tracking) ? '운송장번호는 텍스트 형식의 8~30자리 영숫자여야 합니다.' : undefined);
    if (reason) { issues.push({ line, reference, reason }); if (isGimpoOrderReference(reference)) blocked.add(reference); }
    else rows.push({ line, reference, trackingNumber });
  }
  const valid = rows.filter(row => {
    if (!blocked.has(row.reference)) return true;
    issues.push({ line: row.line, reference: row.reference, reason: '같은 주문의 다른 행에 오류가 있습니다. 해당 주문의 모든 행을 함께 고쳐주세요.' });
    return false;
  });
  return { kind: 'gimpo', rows: valid, issues: issues.sort((a, b) => a.line - b.line) };
}

const compact = (value: string) => value.replace(/\s/g, '');
const REPLY_TRACKING_HEADERS = new Set(SEOWON_REPLY_TRACKING_HEADERS.map(compact));
/** 우체국 등기번호(13자리)처럼 숫자로 저장돼도 자릿수가 보존되는 송장번호만 받는다. */
function readReplyTracking(cell: ExcelJS.Cell): { value: string; error?: string } {
  if (typeof cell.value === 'number') {
    const text = String(cell.value);
    return Number.isSafeInteger(cell.value) && /^[1-9]\d{9,14}$/.test(text) ? { value: text }
      : { value: '', error: '송장번호는 텍스트 형식으로 입력해주세요.' };
  }
  return readSafeWorkbookCell(cell, true);
}
/** 숫자 칸으로 바뀌며 앞자리 0을 잃은 휴대전화(1012345678)를 되살린다. */
function readReplyPhone(cell: ExcelJS.Cell): { value: string; error?: string } {
  const read = readSafeWorkbookCell(cell);
  return typeof cell.value === 'number' && /^1\d{8,9}$/.test(read.value) ? { value: `0${read.value}` } : read;
}

/** 회신에 남은 배송건번호. 숫자 칸으로 바뀌면 16자리가 깨지므로 버리고 줄 내용으로 대조한다. */
function readReplyShipmentNumber(cell: ExcelJS.Cell | null): string | undefined {
  if (!cell || typeof cell.value !== 'string') return undefined;
  const value = cell.value.trim();
  return isCommerceNumber(value, 'shipment') ? value : undefined;
}

/**
 * null means this is not a Seowon reply. A reply is the exported `송장양식` (A~G headers unchanged)
 * with a 송장번호 column added on the right. Rows keep our appended 배송건번호 when the warehouse
 * leaves it in place; otherwise they are matched by content and the 받는분성명 suffix.
 */
export function parseSeowonReply(sheet: ExcelJS.Worksheet): SeowonTrackingParseResult | null {
  const title = (column: number) => { const cell = readSafeWorkbookCell(sheet.getRow(1).getCell(column)); return cell.error ? '' : cell.value.trim(); };
  if (!SEOWON_TEMPLATE_HEADERS.every((header, index) => title(index + 1) === header)) return null;
  let trackingColumn = 0;
  for (let column = SEOWON_TEMPLATE_HEADERS.length + 1; column <= sheet.columnCount && !trackingColumn; column++) {
    if (REPLY_TRACKING_HEADERS.has(compact(title(column)))) trackingColumn = column;
  }
  if (!trackingColumn) throw new Error('남양주 회신에서 송장번호 열을 찾지 못했습니다. 송장양식 오른쪽에 "송장번호" 열을 두고 번호를 채워 올려주세요.');
  // 덧붙인 열은 서원이 지우거나 옮길 수 있어 위치가 아니라 헤더로 찾는다.
  const appended = (header: string) => { for (let column = SEOWON_TEMPLATE_HEADERS.length + 1; column <= sheet.columnCount; column++) if (compact(title(column)) === compact(header)) return column; return 0; };
  const recipientColumn = appended('받는분성명'), numberColumn = appended('배송건번호');
  const at = (key: typeof SEOWON_COLUMNS[number]['key']) => SEOWON_COLUMNS.findIndex(column => column.key === key) + 1;
  const rows: SeowonReplyRow[] = [];
  for (let line = 2; line <= sheet.rowCount; line++) {
    const source = sheet.getRow(line);
    const phone = readReplyPhone(source.getCell(at('phone'))), address = readSafeWorkbookCell(source.getCell(at('address')));
    const items = readSafeWorkbookCell(source.getCell(at('items'))), quantityCell = source.getCell(at('quantity'));
    const quantityText = readSafeWorkbookCell(quantityCell), tracking = readReplyTracking(source.getCell(trackingColumn));
    const cells = [phone, address, items, quantityText, tracking];
    if (cells.every(cell => !cell.value.trim() && !cell.error)) continue;
    const quantity = /^\d{1,9}$/.test(quantityText.value.replace(/,/g, '').trim()) ? Number(quantityText.value.replace(/,/g, '').trim()) : null;
    const trackingNumber = normalizeTrackingNumber(tracking.value.trim());
    const error = cells.find(cell => cell.error)?.error
      ?? (!quantity ? '수량은 1 이상의 숫자여야 합니다.' : undefined)
      ?? (!trackingNumber ? '송장번호가 비어 있습니다. 출고하지 않은 줄이면 해당 배송 건의 줄을 모두 빼고 올려주세요.' : undefined)
      ?? (!isTrackingNumber(trackingNumber) || /[\r\n\t]/.test(tracking.value) ? '송장번호는 8~30자리 영숫자여야 합니다.' : undefined);
    const recipient = recipientColumn ? readSafeWorkbookCell(source.getCell(recipientColumn)) : null;
    const shipmentNumber = readReplyShipmentNumber(numberColumn ? source.getCell(numberColumn) : null);
    rows.push({ line, phone: phone.value, address: address.value, items: items.value, quantity, trackingNumber,
      ...(recipient && !recipient.error && recipient.value.trim() ? { recipient: recipient.value } : {}),
      ...(shipmentNumber ? { shipmentNumber } : {}), ...(error ? { error } : {}) });
  }
  return { kind: 'seowon', rows, issues: [] };
}

/** Resolve reply-specific identity and origin requirements before the existing atomic DB import. */
export function trackingImportCommand(parsed: Exclude<TrackingWorkbookParseResult, SeowonTrackingParseResult>, originId: string) {
  if ('kind' in parsed && parsed.kind === 'smartstore') {
    return { name: 'admin_import_item_tracking_batch' as const, args: { target_rows: [
      ...parsed.rows.map(row => ({ line: row.line, reference: row.reference, carrier: row.carrier, trackingNumber: row.trackingNumber })),
      ...parsed.issues.map(issue => ({ line: issue.line, reference: issue.reference, carrier: '', trackingNumber: '' })),
    ].sort((left, right) => left.line - right.line) } };
  }
  if ('kind' in parsed) {
    if (!ORDER_UUID.test(originId)) throw new Error('김포 원본 회신은 목록 위에서 해당 출고지를 선택한 뒤 올려주세요.');
    return { name: 'admin_import_warehouse_tracking_batch' as const,
      args: { target_origin_id: originId, target_rows: [...parsed.rows.map(row => ({
        line: row.line, reference: row.reference, trackingNumber: row.trackingNumber,
      })), ...parsed.issues.map(issue => ({line: issue.line, reference: issue.reference, trackingNumber: ''}))] } };
  }
  return { name: 'admin_import_shipment_tracking_batch' as const, args: { target_rows: [...parsed.rows.map(row => ({
    line: row.line, reference: row.reference, carrier: row.carrier, trackingNumber: row.trackingNumber,
  })), ...parsed.issues.map(issue => ({line: issue.line, reference: issue.reference, carrier: '', trackingNumber: ''}))] } };
}
