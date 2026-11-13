import 'server-only';
import type ExcelJS from 'exceljs';
import type { ShippingCarrierRegistry } from '@/lib/orders/shipment';
import { isTrackingNumber, normalizeTrackingNumber } from '@/lib/orders/shipment';
import { isUuid } from '@/lib/uuid';
import { isCommerceNumber } from '@/lib/commerce-number';
import { parseDelimitedText } from './spreadsheet-text';
import type { TrackingImportParseResult } from './tracking-import';
import { readSafeWorkbookCell } from './workbook-safety';
import {
  ICONS_REPLY_CARRIER_HEADER, ICONS_REPLY_ITEM_HEADER, ICONS_REPLY_METHOD_HEADER, ICONS_REPLY_PARCEL_METHODS, ICONS_REPLY_TRACKING_HEADERS,
} from './smartstore-shipment-workbook';

export interface SmartStoreTrackingParseResult extends TrackingImportParseResult {
  kind: 'smartstore';
  /** 운송장 칸만 비운 줄. 아직 출고하지 않은 것으로 보고 건너뛴다(실패 아님). */
  skipped: { line: number; reference: string }[];
}

type ReplyCell = ReturnType<typeof readSafeWorkbookCell>;

/** XLSX 시트와 CSV 표를 같은 규칙으로 읽기 위한 접근자. 행·열 번호는 1부터다. */
interface ReplyTable {
  rowCount: number;
  columnCount: number;
  cell(row: number, column: number): ReplyCell;
  /** 번호 칸. 숫자로 바뀐 값은 어느 칸인지 밝혀 거절한다. */
  identifier(row: number, column: number, label: string): ReplyCell;
  hasValues(row: number): boolean;
  /** 입력 칸 밖에서 그 행을 쓸 수 없게 만드는 문제. */
  rowProblem(row: number, inputColumns: readonly number[], headerRow: number): string | undefined;
}

function worksheetTable(sheet: ExcelJS.Worksheet): ReplyTable {
  return {
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount,
    cell: (row, column) => readSafeWorkbookCell(sheet.getCell(row, column)),
    identifier: (row, column, label) => {
      const cell = sheet.getCell(row, column), read = readSafeWorkbookCell(cell, true);
      return typeof cell.value === 'number' && read.error ? { ...read, error: `${label}는 숫자 대신 텍스트 형식으로 입력해주세요.` } : read;
    },
    hasValues: row => sheet.getRow(row).hasValues,
    rowProblem: (row, inputColumns) => {
      let problem: string | undefined;
      sheet.getRow(row).eachCell((cell, column) => {
        // Dates are ordinary data in an untouched older export. The input columns remain strict text.
        if (!inputColumns.includes(column) && !(cell.value instanceof Date)) problem ??= readSafeWorkbookCell(cell).error;
      });
      return problem;
    },
  };
}

/* CSV에는 셀 종류가 없다. XLSX의 수식 셀에 해당하는 것은 `=`로 시작하는 값이고, 내려받은 파일의 수식처럼 보이는 값은 앞에 `'`가 붙어 있다. */
const TEXT_FORMULA = /^\s*=/;
/* 엑셀이 긴 번호를 숫자로 바꾼 뒤 CSV로 저장하면 1.23457E+11처럼 남는다. 원래 번호를 되찾을 수 없다. */
const TEXT_EXPONENT_NUMBER = /^\s*\d+(\.\d+)?E\+\d+\s*$/i;

function delimitedTable(rows: readonly string[][], unclosed: ReadonlySet<number>): ReplyTable {
  const textAt = (row: number, column: number) => rows[row - 1]?.[column - 1] ?? '';
  const cell = (value: string): ReplyCell => TEXT_FORMULA.test(value) ? { value: '', error: '수식은 사용할 수 없습니다.' } : { value };
  return {
    rowCount: rows.length,
    columnCount: rows.reduce((widest, row) => Math.max(widest, row.length), 0),
    cell: (row, column) => cell(textAt(row, column)),
    identifier: (row, column, label) => {
      const value = textAt(row, column);
      return TEXT_EXPONENT_NUMBER.test(value)
        ? { value, error: `${label}가 숫자로 바뀌어 원래 번호를 알 수 없습니다(${value.trim()}). 엑셀에서 열어 저장하지 않은 CSV나 XLSX로 올려주세요.` }
        : cell(value);
    },
    hasValues: row => (rows[row - 1] ?? []).some(value => value.trim() !== ''),
    rowProblem: (row, inputColumns, headerRow) => {
      if (unclosed.has(row)) return '따옴표가 닫히지 않은 줄입니다. 파일을 다시 저장해주세요.';
      // 칸이 많으면 쉼표 때문에 열이 밀린 줄이다. 다른 칸의 값을 운송장으로 읽지 않는다.
      if ((rows[row - 1]?.length ?? 0) > (rows[headerRow - 1]?.length ?? 0)) return '머리글보다 칸이 많은 줄입니다. 쉼표가 든 값은 큰따옴표로 감싸주세요.';
      return (rows[row - 1] ?? []).flatMap((value, index) => inputColumns.includes(index + 1) ? [] : [cell(value).error]).find(Boolean);
    },
  };
}

function headerRowCells(table: ReplyTable, rowNumber: number) {
  return Array.from({ length: table.columnCount }, (_, index) => table.cell(rowNumber, index + 1));
}

/** 표준 양식의 머리글 행. 새 파일은 1행이고, 이미 내려받은 옛 출고지시 파일은 안내 1행 아래 2행이다. 표준 양식이 아니면 null이다. */
function replyHeaderRow(table: ReplyTable): number | null {
  for (const rowNumber of [1, 2]) {
    if (rowNumber <= table.rowCount && headerRowCells(table, rowNumber).some(cell => cell.value.trim() === ICONS_REPLY_ITEM_HEADER)) return rowNumber;
  }
  return null;
}

export function smartStoreHeaderRow(sheet: ExcelJS.Worksheet): number | null {
  return replyHeaderRow(worksheetTable(sheet));
}

/** Stored product-order numbers and legacy UUIDs identify items; never recipient data or row position. */
function parseReplyTable(table: ReplyTable, carriers: ShippingCarrierRegistry): SmartStoreTrackingParseResult | null {
  const headerRow = replyHeaderRow(table);
  if (!headerRow) return null;
  const headerCells = headerRowCells(table, headerRow);
  // 머리글 위의 안내 행을 읽지는 않지만 수식이 든 파일은 머리글과 똑같이 거절한다.
  if (headerRow === 2 && headerRowCells(table, 1).some(cell => cell.error)) throw new Error('안내 행의 수식·오류를 제거하고 다시 올려주세요.');
  if (headerCells.some(cell => cell.error)) throw new Error('헤더의 수식·오류를 제거하고 원본 열 이름을 유지해주세요.');
  const headers = headerCells.map(cell => cell.value.trim());
  const columnsNamed = (names: readonly string[]) => headers.flatMap((header, index) => names.includes(header) ? [index + 1] : []);
  const itemColumns = columnsNamed([ICONS_REPLY_ITEM_HEADER]), carrierColumns = columnsNamed([ICONS_REPLY_CARRIER_HEADER]);
  const trackingColumns = columnsNamed(ICONS_REPLY_TRACKING_HEADERS), methodColumns = columnsNamed([ICONS_REPLY_METHOD_HEADER]);
  if (itemColumns.length !== 1 || carrierColumns.length !== 1 || trackingColumns.length !== 1 || methodColumns.length > 1) {
    throw new Error('상품주문번호·택배사·운송장번호 열이 각각 하나씩 있어야 합니다.');
  }
  const inputColumns = [...itemColumns, ...carrierColumns, ...trackingColumns, ...methodColumns];
  const rows: SmartStoreTrackingParseResult['rows'] = [], issues: SmartStoreTrackingParseResult['issues'] = [], skipped: SmartStoreTrackingParseResult['skipped'] = [];
  for (let line = headerRow + 1; line <= table.rowCount; line++) {
    const referenceCell = table.identifier(line, itemColumns[0], '상품주문번호');
    const carrierCell = table.cell(line, carrierColumns[0]);
    const trackingCell = table.identifier(line, trackingColumns[0], '운송장번호');
    // 배송방법 열은 옛 파일에만 있다. 없거나 비어 있으면 택배로 본다.
    const methodCell: ReplyCell = methodColumns.length ? table.cell(line, methodColumns[0]) : { value: '' };
    const cells = [referenceCell, methodCell, carrierCell, trackingCell];
    if (cells.every(cell => !cell.value && !cell.error) && !table.hasValues(line)) continue;
    const reference = referenceCell.value.trim().toLowerCase();
    const rawCarrier = carrierCell.value.trim();
    const carrier = carriers.find(value => value.code === rawCarrier.toLowerCase() || value.label === rawCarrier);
    const rawTracking = trackingCell.value.trim();
    const trackingNumber = normalizeTrackingNumber(rawTracking);
    const method = methodCell.value.replace(/\s/g, '');
    const reason = cells.find(cell => cell.error)?.error ?? table.rowProblem(line, inputColumns, headerRow)
      ?? (!isUuid(reference) && !isCommerceNumber(reference, 'item') ? '상품주문번호에 ICONS 출고 파일의 전체 상품주문번호를 유지해주세요.' : undefined)
      ?? (method && !ICONS_REPLY_PARCEL_METHODS.includes(method) ? '퀵·방문수령·직접전달은 주문 상세에서 처리해주세요. 엑셀로는 택배만 등록할 수 있습니다.' : undefined)
      ?? (rawCarrier && !carrier ? `등록되지 않은 택배사입니다: ${rawCarrier}` : rawCarrier && carrier && !carrier.active ? `지금 사용하지 않는 택배사입니다: ${carrier.label}` : undefined);
    // 운송장 칸만 비운 줄은 아직 출고하지 않은 것으로 보고 건너뛴다(김포 회신과 같은 기준, QA 라운드 1b). 실패로 세지 않는다.
    // 같은 배송 건의 다른 줄에 운송장이 있으면 일부만 채운 것이라 등록하지 않는 규칙은, 건너뛴 줄도 DB 일괄 등록에 빈 값으로 보내
    // 배송 건 단위 가드가 막게 해서 지킨다(register 쪽).
    if (!reason && !rawTracking) { skipped.push({ line, reference }); continue; }
    const lateReason = reason
      ?? (!rawCarrier ? '택배사가 비어 있습니다.' : undefined)
      ?? (!rawTracking ? '운송장번호가 비어 있습니다.' : !isTrackingNumber(trackingNumber) || /[\r\n\t]/.test(trackingCell.value) ? '운송장번호는 텍스트 형식의 8~30자리 영숫자여야 합니다.' : undefined);
    if (lateReason) issues.push({ line, reference, reason: lateReason });
    else rows.push({ line, reference, referenceId: isUuid(reference) ? reference : null, carrier: carrier!.code, trackingNumber });
  }
  return { kind: 'smartstore', rows, issues, skipped };
}

export function parseSmartStoreReply(sheet: ExcelJS.Worksheet, carriers: ShippingCarrierRegistry): SmartStoreTrackingParseResult | null {
  return parseReplyTable(worksheetTable(sheet), carriers);
}

/** 표준 양식 머리글이 있는 CSV·TSV·붙여넣기를 XLSX와 같은 규칙으로 읽는다. 표준 양식이 아니면 null이다(일반 세 칸 회신). */
export function parseSmartStoreReplyText(text: string, carriers: ShippingCarrierRegistry): SmartStoreTrackingParseResult | null {
  const delimiter = /^[^\r\n]*/.exec(text)?.[0].includes('\t') ? '\t' : ',';
  const { rows, unclosedCells } = parseDelimitedText(text, delimiter);
  return parseReplyTable(delimitedTable(rows, new Set(unclosedCells)), carriers);
}
