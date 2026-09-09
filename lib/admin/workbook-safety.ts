import 'server-only';
import ExcelJS from 'exceljs';
import { readBoundedZip } from './bounded-zip.server';

/** Bound compressed and expanded sizes before ExcelJS allocates the workbook. */
export async function loadSafeWorkbook(
  bytes: Buffer,
  limits: {
    fileBytes: number;
    entries?: number;
    totalBytes?: number;
    entryBytes?: number;
  },
): Promise<ExcelJS.Workbook> {
  if (!bytes.length || bytes.length > limits.fileBytes)
    throw new Error('XLSX 파일 용량이 상한을 초과합니다.');
  await readBoundedZip(bytes, {
    entries: limits.entries ?? 200,
    totalBytes: limits.totalBytes ?? 20 * 1024 * 1024,
    entryBytes: limits.entryBytes ?? 10 * 1024 * 1024,
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as never);
  return workbook;
}

/** Never evaluate formulas or turn numeric identifiers into potentially truncated codes. */
export function readSafeWorkbookCell(
  cell: ExcelJS.Cell,
  identifier = false,
): { value: string; error?: string } {
  const value = cell.value;
  if (
    value &&
    typeof value === 'object' &&
    ('formula' in value || 'sharedFormula' in value)
  )
    return { value: '', error: '수식은 사용할 수 없습니다.' };
  if (value && typeof value === 'object' && 'error' in value)
    return { value: '', error: '셀 오류를 고쳐주세요.' };
  if (value instanceof Date)
    return { value: '', error: '날짜를 텍스트로 입력해주세요.' };
  if (typeof value === 'number' && (!Number.isFinite(value) || identifier))
    return {
      value: String(value),
      error: '코드는 숫자 대신 텍스트 형식으로 입력해주세요.',
    };
  const text =
    value == null ? '' : typeof value === 'number' ? String(value) : cell.text;
  return text.length > 32767
    ? { value: '', error: '셀 내용이 너무 깁니다.' }
    : { value: text };
}
