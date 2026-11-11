import 'server-only';
import ExcelJS from 'exceljs';
import {
  ADMIN_LIST_EXPORT_PRIVACY_NOTICE,
  ADMIN_LIST_EXPORT_ROW_LIMIT,
  ADMIN_LIST_EXPORT_SCREENS,
  assertAdminListExportWithinLimit,
  kstDateTimeText,
  listExportSheetName,
  type AdminListExportSheet,
} from './list-export';
import { addSafeWorkbookInfoSheet, addWorkbookTable } from './workbook-table';

/** Other read-only consoles share the same typed-cell and privacy workbook contract. */
export type ListExportWorkbookSheet = Omit<AdminListExportSheet, 'screen'> & { screenLabel: string };

/**
 * 화면 목록을 확인용 .xlsx로 만든다.
 *
 * - 첫 시트: 머리글 1행(굵게·고정·자동 필터) + 데이터.
 * - 맨 뒤 시트: 화면·조건·내려받은 시각·건수·개인정보 안내.
 * 문자열 셀은 텍스트 서식(@)으로 써서 번호·연락처·우편번호의 선행 0을 보존한다.
 * 수식 객체는 만들지 않는다 — 셀 값은 언제나 문자열·숫자·빈 칸 중 하나다.
 */
export async function buildAdminListExportWorkbook(
  sheet: AdminListExportSheet | ListExportWorkbookSheet,
  generatedAt: Date,
): Promise<Buffer> {
  assertAdminListExportWithinLimit(sheet.rows.length, ADMIN_LIST_EXPORT_ROW_LIMIT, 'rows');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ICONS';
  workbook.created = generatedAt;
  workbook.modified = generatedAt;

  addWorkbookTable(workbook, listExportSheetName(sheet.title), sheet.columns, sheet.rows);
  addSafeWorkbookInfoSheet(workbook, [
    ['화면', 'screen' in sheet ? ADMIN_LIST_EXPORT_SCREENS[sheet.screen].label : sheet.screenLabel],
    ...sheet.conditions,
    ['내려받은 시각 (KST)', kstDateTimeText(generatedAt.toISOString())],
    ['건수', `${sheet.recordCount.toLocaleString('ko-KR')}건 · 엑셀 ${sheet.rows.length.toLocaleString('ko-KR')}행`],
    ...sheet.notes.map((note): [string, string] => ['안내', note]),
    ['개인정보', ADMIN_LIST_EXPORT_PRIVACY_NOTICE],
  ]);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
