import 'server-only';
import { parseShipmentPackSummary } from './shipment-packs';
import { WAREHOUSE_OPERATION_HEADERS, GIMPO_COLUMNS, SEOWON_COLUMNS, GIMPO_EXPORT_HEADERS, SEOWON_EXPORT_HEADERS } from './warehouse-templates';
import type ExcelJS from 'exceljs';
import type { ShipmentExportData } from './shipment-dispatch';
import { parseShipmentExportColumns, shipmentExportCells } from './shipment-workbook';
import type { TrackingImportParseResult } from './tracking-import';
import type { SmartStoreTrackingParseResult } from './smartstore-tracking-workbook.server';
import { readSafeWorkbookCell } from './workbook-safety';
import { isTrackingNumber, normalizeTrackingNumber } from '@/lib/orders/shipment';
import { transactionExactKeys, transactionRecord } from '@/lib/goods-transaction-values';

type Shipments = ShipmentExportData['shipments'];
type Shipment = Shipments[number];
type Line = Shipment['lines'][number];
type Cell = string | number;


const postalCode = (value: string) => /^\d{5}$/.test(value) ? value : '';
const itemLabel = (line: Line) => `${line.goodName}/${line.optionName}(${line.qty})`;
function validCollector(value: unknown) {
  return transactionRecord(value) && transactionExactKeys(value, ['name', 'method', 'refundContact', 'instructions'])
    && ['name', 'method', 'refundContact', 'instructions'].every(key => typeof value[key] === 'string' && value[key].trim() && !/[\u0000-\u001f\u007f]/.test(value[key]));
}

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
    if (shipment.pack && (!parseShipmentPackSummary(shipment.pack) || !shipment.pack.shipmentIds.includes(shipment.id) || shipment.pack.shipmentIds.some(id => !shipments.some(member => member.id === id && member.pack?.id === shipment.pack?.id)))) throw new Error('합포장의 모든 배송 건을 선택해주세요.');
    if (shipment.isGift !== undefined && typeof shipment.isGift !== 'boolean'
      || shipment.shippingCollectFee !== undefined && (!Number.isSafeInteger(shipment.shippingCollectFee) || shipment.shippingCollectFee < 0)
      || (shipment.shippingCollectFee ?? 0) > 0 && !validCollector(shipment.collector)
      || shipment.isGift && shipment.lines.some(line => !line.recipient.trim() || !line.address.trim() || !/^\d{5}$/.test(line.postalCode) || !/^[0-9]{8,15}$/.test(line.phone))) {
      throw new Error('선물·착불 배송 정보를 확인하지 못해 출고 파일을 만들지 않았습니다.');
    }
    if (!['standard', 'wms_csv', 'seowon_xlsx'].includes(shipment.template)
      || shipment.template !== first.template || shipment.originId !== first.originId || !shipment.lines.length
      || (shipment.template === 'standard' && !parseShipmentExportColumns(shipment.columns))) {
      throw new Error('출고지시 양식 또는 상품 정보를 확인해주세요.');
    }
    if (shipment.template === 'wms_csv' && (!Number.isSafeInteger(shipment.shippingFee) || shipment.shippingFee < 0
      || shipment.lines.some(line => !Number.isSafeInteger(line.unitPrice) || line.unitPrice < 0))) {
      throw new Error('출고지시 금액 정보를 확인해주세요.');
    }
  }
  if (first.template === 'seowon_xlsx') return {
    headers: SEOWON_EXPORT_HEADERS, widths: SEOWON_COLUMNS.map(column => column.width),
    textColumns: SEOWON_COLUMNS.map(column => column.text),
    rows: shipments.map(shipment => {
      const line = shipment.lines[0];
      const values: Record<typeof SEOWON_COLUMNS[number]['key'], Cell> = {
        phone: line.phone, otherPhone: '', postalCode: postalCode(line.postalCode), address: line.address,
        freightType: '', quantity: '', items: shipment.lines.map(itemLabel).join(', '),
      };
      return SEOWON_COLUMNS.map(column => values[column.key]);
    }),
  };
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
    rows: selected.map(shipment => [shipment.id, shipment.lines[0].orderId, shipment.isGift ? '선물' : '일반',
      shipment.isGift ? '수령인용 명세에 가격·할인·결제정보를 표시하지 마세요. 내부 출고 파일은 포장에 동봉하지 마세요.' : '',
      shipment.shippingFee, shipment.shippingCollectFee ?? 0, shipment.collector?.name ?? '', shipment.collector?.method ?? '',
      shipment.collector?.instructions ?? '', shipment.collector?.refundContact ?? '', shipment.pack?.id ?? '', shipment.pack?.count ?? '', shipment.pack?.collectFee ?? '', shipment.pack ? '같은 합포장번호의 모든 상품을 하나로 포장하고 동일 택배사·송장을 회신해주세요. 원래 주문번호·배송비·착불 금액을 유지합니다.' : ''] as Cell[]),
  };
}

export interface WarehouseTrackingParseResult {
  kind: 'gimpo';
  rows: { line: number; reference: string; trackingNumber: string }[];
  issues: TrackingImportParseResult['issues'];
}
export type TrackingWorkbookParseResult = TrackingImportParseResult | WarehouseTrackingParseResult | SmartStoreTrackingParseResult;
const ORDER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** null means this is not a supported native reply; Seowon returns the general three-column format. */
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

/** Resolve reply-specific identity and origin requirements before the existing atomic DB import. */
export function trackingImportCommand(parsed: TrackingWorkbookParseResult, originId: string) {
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
