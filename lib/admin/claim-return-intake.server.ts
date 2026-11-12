import 'server-only';
import { createHash } from 'node:crypto';
import type ExcelJS from 'exceljs';
import { decryptUploadedWorkbook, isOleContainer } from './encrypted-workbook.server';
import { decodeSpreadsheetText, parseDelimitedText } from './spreadsheet-text';
import { loadSafeWorkbook, readSafeWorkbookCell } from './workbook-safety';
import { WORKBOOK_INFO_SHEET_NAME } from './workbook-format';
import { RETURN_INTAKE_ROW_LIMIT } from './claim-return-intake';

/*
 * 반품입고 회신 파일 읽기(QNA-034). 운송장 회신 업로드와 같은 경계를 쓴다: 비밀번호 XLSX는 풀어서(비밀번호는 저장하지 않음), 크기·압축
 * 한도와 수식 거절을 지나 표(줄 × 칸 문자열)로 만든다. CSV·TSV는 엑셀 저장 글자(UTF-8·UTF-16·EUC-KR)로 읽는다.
 * 확정 근거의 SHA-256은 올린 파일 바이트 그대로의 값이다(비밀번호 파일이면 암호화된 파일).
 */
export const RETURN_INTAKE_FILE_LIMIT_BYTES = 1024 * 1024;
const COLUMN_LIMIT = 80;
/* 머리글 위 안내 줄과 빈 줄을 더한 여유. */
const LINE_LIMIT = RETURN_INTAKE_ROW_LIMIT + 50;

export interface ReturnIntakeFile { table: string[][]; lineErrors: Record<number, string>; sha256: string; fileName: string }

/* 날짜 칸은 엑셀 날짜(Date)도 받는다 — 날짜 서식 셀은 시각대 없이 UTC 자정으로 읽힌다. 숫자는 정수 15자리까지만 그대로 읽는다
   (그보다 긴 번호는 엑셀이 끝자리를 바꿀 수 있어 텍스트로 저장하라고 알린다). */
function cellText(cell: ExcelJS.Cell): { value: string; error?: string } {
  const value = cell.value;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { value: '', error: '날짜 셀을 읽지 못했습니다.' };
    return { value: `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}` };
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || String(Math.abs(value)).length > 15) return { value: '', error: '긴 번호는 숫자 대신 텍스트 형식으로 저장해주세요.' };
    return { value: String(value) };
  }
  return readSafeWorkbookCell(cell);
}

async function readWorkbook(bytes: Buffer, password: string): Promise<{ table: string[][]; lineErrors: Record<number, string> }> {
  const plain = isOleContainer(bytes) ? await decryptUploadedWorkbook(bytes, password, RETURN_INTAKE_FILE_LIMIT_BYTES) : bytes;
  const workbook = await loadSafeWorkbook(plain, { fileBytes: RETURN_INTAKE_FILE_LIMIT_BYTES, totalBytes: 8 * 1024 * 1024, entryBytes: 4 * 1024 * 1024 });
  const sheets = workbook.worksheets.filter(sheet => sheet.name !== WORKBOOK_INFO_SHEET_NAME && sheet.actualRowCount > 0);
  if (sheets.length !== 1) throw new Error('반품입고 회신은 내용이 있는 시트 하나로 올려주세요.');
  const sheet = sheets[0];
  if (sheet.rowCount > LINE_LIMIT) throw new Error(`반품입고 회신은 한 번에 ${RETURN_INTAKE_ROW_LIMIT.toLocaleString('ko-KR')}줄까지 올릴 수 있습니다. 파일을 나눠 올려주세요.`);
  const columns = Math.min(sheet.columnCount, COLUMN_LIMIT);
  const table: string[][] = [];
  const lineErrors: Record<number, string> = {};
  for (let line = 1; line <= sheet.rowCount; line += 1) {
    const row = sheet.getRow(line);
    const cells: string[] = [];
    for (let column = 1; column <= columns; column += 1) {
      const read = cellText(row.getCell(column));
      if (read.error && !lineErrors[line]) lineErrors[line] = read.error;
      if (/[\r\n\t]/u.test(read.value) && !lineErrors[line]) lineErrors[line] = '셀에 줄바꿈·탭을 넣을 수 없습니다.';
      cells.push(read.value);
    }
    table.push(cells);
  }
  return { table, lineErrors };
}

function readText(bytes: Buffer, fileName: string): { table: string[][]; lineErrors: Record<number, string> } {
  const text = decodeSpreadsheetText(new Uint8Array(bytes));
  const firstLine = text.slice(0, text.search(/\r?\n/u) >= 0 ? text.search(/\r?\n/u) : text.length);
  const delimiter = /\.tsv$/iu.test(fileName) || (firstLine.includes('\t') && !firstLine.includes(',')) ? '\t' : ',';
  const parsed = parseDelimitedText(text, delimiter, { quotedCellScanLimit: 4096 });
  if (parsed.rows.length > LINE_LIMIT) throw new Error(`반품입고 회신은 한 번에 ${RETURN_INTAKE_ROW_LIMIT.toLocaleString('ko-KR')}줄까지 올릴 수 있습니다. 파일을 나눠 올려주세요.`);
  const lineErrors: Record<number, string> = {};
  for (const line of parsed.unclosedCells) lineErrors[line] = '닫히지 않은 큰따옴표가 있습니다.';
  return { table: parsed.rows.map(row => row.slice(0, COLUMN_LIMIT)), lineErrors };
}

/** 올린 파일을 표로 읽는다. 형식·크기·비밀번호 문제는 운영자에게 보일 문장으로 던진다. */
export async function readReturnIntakeFile(file: File, password: string): Promise<ReturnIntakeFile> {
  if (!file.size) throw new Error('반품입고 회신 파일을 골라주세요.');
  if (file.size > RETURN_INTAKE_FILE_LIMIT_BYTES) throw new Error('반품입고 회신 파일은 1MB 이하로 올려주세요.');
  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (/\.xlsx$/iu.test(file.name)) return { ...(await readWorkbook(bytes, password)), sha256, fileName: file.name };
  if (/\.(csv|tsv|txt)$/iu.test(file.name)) return { ...readText(bytes, file.name), sha256, fileName: file.name };
  throw new Error('XLSX 또는 CSV·TSV 파일을 올려주세요.');
}
