import 'server-only';
import type ExcelJS from 'exceljs';
import { loadSafeWorkbook } from './workbook-safety';
import {
  ERP_ITEM_COLUMN_LIMIT,
  ERP_ITEM_FILE_BYTES_LIMIT,
  ERP_ITEM_HEADER_SCAN_ROWS,
  ERP_ITEM_IMPORT_ROW_LIMIT,
  boundErpTable,
  decodeErpTextBytes,
  parseErpDelimitedText,
} from './erp-item-import';

export interface ErpItemFileTable {
  table: string[][];
  /** 숫자 셀이 하나라도 있었던 열(0부터). 미리보기가 선행 0 손실을 경고한다. */
  numericColumns: number[];
  warnings: string[];
  sheetName: string | null;
}

/* 머리글 탐지 구간과 빈 줄 몇 개는 행 수 상한과 따로 둔다. */
const ERP_ITEM_TABLE_ROW_LIMIT = ERP_ITEM_IMPORT_ROW_LIMIT + ERP_ITEM_HEADER_SCAN_ROWS + 100;
const TOO_MANY_ROWS = `한 번에 ${ERP_ITEM_IMPORT_ROW_LIMIT.toLocaleString('ko-KR')}행까지 반입할 수 있습니다. 파일을 나누어 반입해주세요.`;

type CellRead = { text: string; numeric?: boolean; formula?: boolean; lossy?: boolean };

/**
 * 수식은 계산하지 않고, 숫자 셀은 지수 표기 없이 정수 문자열로 읽는다.
 * 표시 형식이 0000처럼 0으로만 된 셀은 엑셀이 보여 주던 자릿수만큼 앞자리 0을 채운다.
 */
export function readErpWorkbookCell(cell: Pick<ExcelJS.Cell, 'value' | 'numFmt' | 'text'>): CellRead {
  const value = cell.value;
  if (value === null || value === undefined) return { text: '' };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { text: '', numeric: true };
    if (!Number.isInteger(value)) return { text: String(value), numeric: true };
    const safe = Number.isSafeInteger(value);
    let text = safe ? String(value) : BigInt(value).toString();
    const format = typeof cell.numFmt === 'string' ? cell.numFmt : '';
    if (/^0+$/.test(format) && value >= 0 && text.length < format.length) text = text.padStart(format.length, '0');
    return { text, numeric: true, lossy: !safe };
  }
  if (typeof value === 'string') return { text: value };
  if (typeof value === 'boolean') return { text: value ? 'TRUE' : 'FALSE' };
  if (value instanceof Date) return { text: Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10) };
  if (typeof value === 'object') {
    if ('formula' in value || 'sharedFormula' in value) return { text: '', formula: true };
    if ('error' in value) return { text: '' };
    if ('richText' in value && Array.isArray(value.richText)) return { text: value.richText.map((part) => part.text ?? '').join('') };
    if ('text' in value && typeof value.text === 'string') return { text: value.text };
  }
  return { text: typeof cell.text === 'string' ? cell.text : '' };
}

function pickWorksheet(workbook: ExcelJS.Workbook): ExcelJS.Worksheet | undefined {
  const visible = workbook.worksheets.filter((sheet) => sheet.state === undefined || sheet.state === 'visible');
  return visible.find((sheet) => sheet.actualRowCount > 0) ?? visible[0] ?? workbook.worksheets[0];
}

async function readWorkbookTable(bytes: Buffer): Promise<ErpItemFileTable> {
  const workbook = await loadSafeWorkbook(bytes, { fileBytes: ERP_ITEM_FILE_BYTES_LIMIT });
  const sheet = pickWorksheet(workbook);
  if (!sheet) return { table: [], numericColumns: [], warnings: [], sheetName: null };
  if (sheet.actualRowCount > ERP_ITEM_TABLE_ROW_LIMIT) throw new Error(TOO_MANY_ROWS);
  const table: string[][] = [];
  const numeric = new Set<number>();
  const formulaCells: string[] = [];
  const lossyCells: string[] = [];
  let tooFar = false;
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    /* 값이 아주 아래 행에 흩어져 있으면 빈 행까지 메모리에 펼치지 않는다. */
    if (tooFar || rowNumber > ERP_ITEM_TABLE_ROW_LIMIT * 4) { tooFar = true; return; }
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      if (columnNumber > ERP_ITEM_COLUMN_LIMIT) return;
      const read = readErpWorkbookCell(cell);
      cells[columnNumber - 1] = read.text;
      if (read.numeric) numeric.add(columnNumber - 1);
      if (read.formula) formulaCells.push(cell.address);
      if (read.lossy) lossyCells.push(cell.address);
    });
    table[rowNumber - 1] = Array.from(cells, (cell) => cell ?? '');
  });
  if (tooFar) throw new Error(TOO_MANY_ROWS);
  const filled = Array.from(table, (row) => row ?? []);
  const warnings: string[] = [];
  if (formulaCells.length) {
    warnings.push(`수식 셀 ${formulaCells.length.toLocaleString('ko-KR')}개(${formulaCells.slice(0, 3).join(', ')}${formulaCells.length > 3 ? ' 등' : ''})는 값을 읽지 않았습니다. 값으로 붙여넣어 저장한 뒤 다시 올려주세요.`);
  }
  if (lossyCells.length) {
    warnings.push(`숫자가 너무 긴 셀(${lossyCells.slice(0, 3).join(', ')}${lossyCells.length > 3 ? ' 등' : ''})은 엑셀에서 끝자리가 바뀌었을 수 있습니다. 텍스트 형식으로 저장해 다시 올려주세요.`);
  }
  return { table: boundErpTable(filled), numericColumns: [...numeric].sort((left, right) => left - right), warnings, sheetName: sheet.name };
}

/** 업로드 파일(.xlsx·.csv·.tsv·.txt)을 문자열 표로 읽는다. 크기·압축 폭탄 방어는 공통 워크북 안전 경계를 쓴다. */
export async function readErpItemFile(name: string, bytes: Buffer): Promise<ErpItemFileTable> {
  if (!bytes.length || bytes.length > ERP_ITEM_FILE_BYTES_LIMIT) throw new Error('파일은 900KB 이하로 올려주세요.');
  if (/\.xlsx$/i.test(name)) return readWorkbookTable(bytes);
  if (/\.(csv|tsv|txt)$/i.test(name)) {
    const table = parseErpDelimitedText(decodeErpTextBytes(bytes));
    if (table.length > ERP_ITEM_TABLE_ROW_LIMIT) throw new Error(TOO_MANY_ROWS);
    return { table: boundErpTable(table), numericColumns: [], warnings: [], sheetName: null };
  }
  throw new Error('XLSX 또는 CSV 파일을 올려주세요.');
}
