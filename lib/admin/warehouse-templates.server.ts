import 'server-only';
import {
  GIMPO_COLUMNS, SEOWON_COLUMNS, GIMPO_EXPORT_HEADERS, SEOWON_EXPORT_HEADERS, SEOWON_REPLY_TRACKING_HEADERS,
  SEOWON_SHEET_NAME, SEOWON_TEMPLATE_HEADERS,
} from './warehouse-templates';
import type ExcelJS from 'exceljs';
import type { ShipmentExportData } from './shipment-dispatch';
import { parseShipmentExportColumns, shipmentExportCells } from './shipment-workbook';
import type { TrackingImportParseResult } from './tracking-import';
import { readSafeWorkbookCell } from './workbook-safety';
import { seowonExportRows, type SeowonReplyRow } from './seowon-exchange';
import { isTrackingNumber, normalizeTrackingNumber } from '@/lib/orders/shipment';

type Shipments = ShipmentExportData['shipments'];
type Shipment = Shipments[number];
type Line = Shipment['lines'][number];
type Cell = string | number;


const postalCode = (value: string) => /^\d{5}$/.test(value) ? value : '';
const itemLabel = (line: Line) => `${line.goodName}/${line.optionName}(${line.qty})`;

function gimpoCells(shipment: Shipment, line: Line, index: number): Cell[] {
  const values: Record<typeof GIMPO_COLUMNS[number]['key'], Cell> = {
    collectedItem: itemLabel(line), confirmedItem: ` ${itemLabel(line)}`,
    address: line.address, recipientShop: `${line.recipient}/ICONS/`, phone: line.phone,
    otherPhone: '', deliveryNote: line.deliveryNote, sabangnetOrder: '', orderId: line.orderId,
    optionAlias: '', goodName: line.goodName, collectedOption: line.optionName, confirmedOption: line.optionName,
    supplyPrice: '', unitPrice: line.unitPrice, qty: line.qty, ea: '', postalCode: postalCode(line.postalCode),
    recipient: line.recipient, shippingFee: index === 0 ? shipment.shippingFee : 0, trackingNumber: '',
  };
  return GIMPO_COLUMNS.map(column => values[column.key]);
}

/** Export one origin using its native contract; callers only serialize the resulting table. */
export function warehouseExportTable(shipments: Shipments) {
  const first = shipments[0];
  if (!first) throw new Error('내보낼 배송 건이 없습니다.');
  for (const shipment of shipments) {
    if (!['standard', 'wms_csv', 'seowon_xlsx'].includes(shipment.template)
      || shipment.template !== first.template || shipment.originId !== first.originId || !shipment.lines.length
      || (shipment.template === 'standard' && !parseShipmentExportColumns(shipment.columns))) {
      throw new Error('출고지시 양식 또는 상품 정보를 확인해주세요.');
    }
    if (shipment.template === 'wms_csv' && (!Number.isSafeInteger(shipment.shippingFee) || shipment.shippingFee < 0
      || shipment.lines.some(line => !Number.isSafeInteger(line.unitPrice) || line.unitPrice < 0))) {
      throw new Error('출고지시 금액 정보를 확인해주세요.');
    }
    if (shipment.template === 'seowon_xlsx' && shipment.lines.some(line => !Number.isSafeInteger(line.qty) || line.qty < 1)) {
      throw new Error('출고지시 수량 정보를 확인해주세요.');
    }
  }
  if (first.template === 'seowon_xlsx') return {
    headers: SEOWON_EXPORT_HEADERS, widths: SEOWON_COLUMNS.map(column => column.width),
    rows: shipments.flatMap(shipment => seowonExportRows(shipment.lines).map(row => SEOWON_COLUMNS.map(column => row[column.key]))),
  };
  if (first.template === 'wms_csv') return {
    headers: GIMPO_EXPORT_HEADERS, widths: GIMPO_COLUMNS.map(column => column.width),
    rows: shipments.flatMap(shipment => shipment.lines.map((line, index) => gimpoCells(shipment, line, index))),
  };
  return {
    headers: first.columns.map(column => column.header),
    widths: first.columns.map(column => column.key === 'address' ? 48 : column.key.endsWith('Id') ? 40 : 22),
    rows: shipments.flatMap(shipment => shipment.lines.map(line => shipmentExportCells(line, first.columns))),
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
function seowonHeaderStyle(column: SeowonColumn): Partial<ExcelJS.Style> {
  const centered = column.fill === 'optional' || column.key === 'quantity';
  return {
    font: { ...SEOWON_FONT, bold: true }, fill: SEOWON_FILLS[column.fill],
    alignment: { vertical: 'middle', ...(centered ? { horizontal: 'center' } : column.key === 'items' ? { horizontal: 'left' } : {}) },
    ...(column.key === 'phone' ? { numFmt: '@' } : column.key === 'quantity' ? { numFmt: SEOWON_QUANTITY_FORMAT } : {}),
  };
}
function seowonCellStyle(column: SeowonColumn): Partial<ExcelJS.Style> {
  return {
    font: { ...SEOWON_FONT }, alignment: { vertical: 'middle', ...(column.key === 'items' ? { horizontal: 'left' } : {}) },
    ...(column.fill === 'picking' ? { fill: SEOWON_FILLS.picking } : {}),
    ...(column.key === 'quantity' ? { numFmt: SEOWON_QUANTITY_FORMAT } : column.key === 'phone' ? { numFmt: '@' } : {}),
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
export type TrackingWorkbookParseResult = TrackingImportParseResult | WarehouseTrackingParseResult | SeowonTrackingParseResult;
const ORDER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** null means this is not a Gimpo 21-column reply. */
export function parseWarehouseReply(sheet: ExcelJS.Worksheet): WarehouseTrackingParseResult | null {
  if (sheet.columnCount !== GIMPO_COLUMNS.length || !GIMPO_COLUMNS.every((column, index) => {
    const cell = readSafeWorkbookCell(sheet.getRow(1).getCell(index + 1));
    return !cell.error && cell.value === column.header;
  })) return null;
  const rows: WarehouseTrackingParseResult['rows'] = [], issues: WarehouseTrackingParseResult['issues'] = [];
  const blocked = new Set<string>();
  for (let line = 2; line <= sheet.rowCount; line++) {
    const source = sheet.getRow(line);
    const cells = GIMPO_COLUMNS.map((column, index) => ({ key: column.key,
      ...readSafeWorkbookCell(source.getCell(index + 1), column.key === 'orderId' || column.key === 'trackingNumber'),
    }));
    if (cells.every(cell => !cell.value && !cell.error)) continue;
    const reference = cells.find(cell => cell.key === 'orderId')!.value.trim().toLowerCase();
    const tracking = cells.find(cell => cell.key === 'trackingNumber')!.value;
    const trackingNumber = normalizeTrackingNumber(tracking.trim());
    const reason = cells.find(cell => cell.error)?.error
      ?? (!ORDER_UUID.test(reference) ? '주문번호(쇼핑몰)에 ICONS 출고 파일의 전체 주문번호를 그대로 유지해주세요.' : undefined)
      ?? (!isTrackingNumber(trackingNumber) || /[\r\n\t]/.test(tracking) ? '운송장번호는 텍스트 형식의 8~30자리 영숫자여야 합니다.' : undefined);
    if (reason) { issues.push({ line, reference, reason }); if (ORDER_UUID.test(reference)) blocked.add(reference); }
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

/**
 * null means this is not a Seowon reply. A reply is the exported `송장양식` (A~G headers unchanged)
 * with a 송장번호 column added on the right; rows are matched by content because Seowon does not
 * return our order numbers.
 */
export function parseSeowonReply(sheet: ExcelJS.Worksheet): SeowonTrackingParseResult | null {
  const title = (column: number) => { const cell = readSafeWorkbookCell(sheet.getRow(1).getCell(column)); return cell.error ? '' : cell.value.trim(); };
  if (!SEOWON_TEMPLATE_HEADERS.every((header, index) => title(index + 1) === header)) return null;
  let trackingColumn = 0;
  for (let column = SEOWON_TEMPLATE_HEADERS.length + 1; column <= sheet.columnCount && !trackingColumn; column++) {
    if (REPLY_TRACKING_HEADERS.has(compact(title(column)))) trackingColumn = column;
  }
  if (!trackingColumn) throw new Error('남양주 회신에서 송장번호 열을 찾지 못했습니다. 송장양식 오른쪽에 "송장번호" 열을 두고 번호를 채워 올려주세요.');
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
    rows.push({ line, phone: phone.value, address: address.value, items: items.value, quantity, trackingNumber, ...(error ? { error } : {}) });
  }
  return { kind: 'seowon', rows, issues: [] };
}

/** Resolve reply-specific identity and origin requirements before the existing atomic DB import. */
export function trackingImportCommand(parsed: TrackingImportParseResult | WarehouseTrackingParseResult, originId: string) {
  if ('kind' in parsed) {
    if (!ORDER_UUID.test(originId)) throw new Error('김포 원본 회신은 목록 위에서 해당 출고지를 선택한 뒤 올려주세요.');
    return { name: 'admin_import_warehouse_tracking_batch' as const,
      args: { target_origin_id: originId, target_rows: parsed.rows.map(row => ({
        line: row.line, reference: row.reference, trackingNumber: row.trackingNumber,
      })) } };
  }
  return { name: 'admin_import_shipment_tracking_batch' as const, args: { target_rows: parsed.rows.map(row => ({
    line: row.line, reference: row.reference, carrier: row.carrier, trackingNumber: row.trackingNumber,
  })) } };
}
