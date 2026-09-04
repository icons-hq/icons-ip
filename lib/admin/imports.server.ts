import 'server-only';

import ExcelJS from 'exceljs';
import { parseDelimitedText } from './imports';

/*
 * 올라온 파일을 표로 바꾼다. CSV·TSV 는 그대로 읽고, 엑셀은 첫 시트를 읽는다 —
 * 우리가 내보낸 발주서를 그대로 되돌려 올릴 수 있어야 하므로 두 형식을 다 받는다.
 */

function cellToText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') {
    /* ExcelJS 는 수식·서식 있는 셀을 객체로 준다 — 사람이 보는 값만 꺼낸다. */
    const record = value as { text?: unknown; result?: unknown; richText?: { text: string }[] };
    if (Array.isArray(record.richText)) return record.richText.map((part) => part.text).join('');
    if (record.text !== undefined) return String(record.text);
    if (record.result !== undefined) return String(record.result);
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return '';
  }
  return String(value);
}

export async function readUploadedTable(buffer: Buffer, fileName: string): Promise<string[][] | null> {
  const isExcel = /\.xlsx?$/i.test(fileName);
  if (!isExcel) {
    try {
      return parseDelimitedText(buffer.toString('utf8'));
    } catch {
      return null;
    }
  }

  try {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return null;
    const table: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      table.push(values.map((value) => cellToText(value).trim()));
    });
    return table;
  } catch {
    return null;
  }
}
