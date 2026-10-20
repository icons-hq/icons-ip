import 'server-only';
import type ExcelJS from 'exceljs';
import type { ShippingCarrierRegistry } from '@/lib/orders/shipment';
import { isTrackingNumber, normalizeTrackingNumber } from '@/lib/orders/shipment';
import { isUuid } from '@/lib/uuid';
import type { TrackingImportParseResult } from './tracking-import';
import { readSafeWorkbookCell } from './workbook-safety';
import { SMARTSTORE_PARCEL_METHOD, SMARTSTORE_TRACKING_HEADERS } from './smartstore-shipment-workbook';

export interface SmartStoreTrackingParseResult extends TrackingImportParseResult { kind: 'smartstore' }

/** Only actual item UUIDs identify orders; recipient data and row position never do. */
export function parseSmartStoreReply(sheet: ExcelJS.Worksheet, carriers: ShippingCarrierRegistry): SmartStoreTrackingParseResult | null {
  const headerCells = Array.from({ length: sheet.columnCount }, (_, index) => readSafeWorkbookCell(sheet.getCell(1, index + 1)));
  const headers = headerCells.map(cell => cell.value.trim());
  if (!headers.includes(SMARTSTORE_TRACKING_HEADERS[0])) {
    if (sheet.name === '발송처리' || Array.from({ length: sheet.columnCount }, (_, index) => sheet.getCell(2, index + 1).text).includes(SMARTSTORE_TRACKING_HEADERS[0])) {
      throw new Error('안내가 있는 1행을 삭제하고 상품주문번호·배송방법·택배사·송장번호 헤더를 첫 행에 유지해주세요. 시트명은 발송처리로 저장해주세요.');
    }
    return null;
  }
  if (sheet.name !== '발송처리') throw new Error('상품주문번호 양식의 시트명은 발송처리로 저장해주세요.');
  if (headerCells.some(cell => cell.error)) throw new Error('헤더의 수식·오류를 제거하고 원본 열 이름을 유지해주세요.');
  if (sheet.columnCount > 74 || SMARTSTORE_TRACKING_HEADERS.some(header => headers.filter(value => value === header).length !== 1)) {
    throw new Error('상품주문번호·배송방법·택배사·송장번호 열이 각각 하나씩 있어야 합니다.');
  }
  const positions = SMARTSTORE_TRACKING_HEADERS.map(header => headers.indexOf(header) + 1);
  const rows: SmartStoreTrackingParseResult['rows'] = [], issues: SmartStoreTrackingParseResult['issues'] = [];
  for (let line = 2; line <= sheet.rowCount; line++) {
    const source = sheet.getRow(line);
    const cells = positions.map((column, index) => readSafeWorkbookCell(source.getCell(column), index === 0 || index === 3));
    if (cells.every(cell => !cell.value && !cell.error) && !source.hasValues) continue;
    const [referenceCell, methodCell, carrierCell, trackingCell] = cells;
    const reference = referenceCell.value.trim().toLowerCase();
    const rawCarrier = carrierCell.value.trim();
    const carrier = carriers.find(value => value.code === rawCarrier.toLowerCase() || value.label === rawCarrier);
    const trackingNumber = normalizeTrackingNumber(trackingCell.value.trim());
    let unsafeCell: string | undefined;
    source.eachCell((cell, column) => {
      // Dates are ordinary data in the untouched 74-column export. The four input columns remain strict text.
      if (!positions.includes(column) && !(cell.value instanceof Date)) unsafeCell ??= readSafeWorkbookCell(cell).error;
    });
    const reason = cells.find(cell => cell.error)?.error ?? unsafeCell
      ?? (!isUuid(reference) ? '상품주문번호에 ICONS 출고 파일의 전체 상품주문번호를 유지해주세요.' : undefined)
      ?? (methodCell.value.replace(/\s/g, '') !== SMARTSTORE_PARCEL_METHOD ? '퀵·방문수령·직접전달은 주문 상세에서 처리해주세요. 엑셀에는 택배,등기,소포만 입력할 수 있습니다.' : undefined)
      ?? (!carrier ? `등록되지 않은 택배사입니다: ${rawCarrier}` : !carrier.active ? `지금 사용하지 않는 택배사입니다: ${carrier.label}` : undefined)
      ?? (!isTrackingNumber(trackingNumber) || /[\r\n\t]/.test(trackingCell.value) ? '송장번호는 텍스트 형식의 8~30자리 영숫자여야 합니다.' : undefined);
    if (reason) issues.push({ line, reference, reason });
    else rows.push({ line, reference, referenceId: reference, carrier: carrier!.code, trackingNumber });
  }
  return { kind: 'smartstore', rows, issues };
}
