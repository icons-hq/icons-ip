import 'server-only';
import { loadSafeWorkbook, readSafeWorkbookCell } from './workbook-safety';
import { decodeSpreadsheetText, parseDelimitedText } from './spreadsheet-text';
import { parseStoreCreditTargets } from './store-credit-console';
export const STORE_CREDIT_FILE_BYTES = 500 * 1024;
export async function readStoreCreditTargetsFile(name: string, bytes: Buffer) {
  if (!bytes.length || bytes.length > STORE_CREDIT_FILE_BYTES) throw new Error('500KB 이하의 XLSX 또는 CSV 파일을 선택해주세요.');
  let rows: string[][];
  if (name.toLowerCase().endsWith('.xlsx')) {
    const workbook = await loadSafeWorkbook(bytes,{ fileBytes: STORE_CREDIT_FILE_BYTES, totalBytes: 4 * 1024 * 1024, entryBytes: 2 * 1024 * 1024 });
    if (workbook.worksheets.length !== 1) throw new Error('대상 목록 시트 하나만 포함해주세요.');
    const sheet = workbook.worksheets[0];
    if (sheet.rowCount > 1001 || sheet.columnCount > 1) throw new Error('첫 번째 열에 고객 ID 또는 이메일을 최대 1,000행까지 입력해주세요.');
    rows = [];
    for (let row = 1; row <= sheet.rowCount; row++) {
      const cell = readSafeWorkbookCell(sheet.getCell(row,1),true);
      if (cell.error) throw new Error(`${row}행: ${cell.error}`);
      rows.push([cell.value]);
    }
  } else if (name.toLowerCase().endsWith('.csv')) {
    const parsed = parseDelimitedText(decodeSpreadsheetText(bytes),',');
    if (parsed.unclosedCells.length) throw new Error('CSV의 따옴표가 닫히지 않았습니다. 파일을 확인해주세요.');
    rows = parsed.rows;
  } else throw new Error('XLSX 또는 CSV 파일만 읽을 수 있습니다.');
  rows = rows.filter(row => row.some(value => value.trim()));
  if (['고객 ID 또는 이메일','고객ID','고객 ID','이메일','userId','email'].includes(rows[0]?.[0]?.trim())) rows.shift();
  if (rows.length > 1000 || rows.some(row => row.length !== 1 || /[\s,;]/.test(row[0].trim()))) throw new Error('한 열에 고객 ID 또는 이메일을 하나씩, 최대 1,000행까지 입력해주세요.');
  return parseStoreCreditTargets(rows.map(row => row[0]).join('\n'));
}
