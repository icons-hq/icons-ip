import 'server-only';
import ExcelJS from 'exceljs';
import {
  ADMIN_LIST_EXPORT_PRIVACY_NOTICE,
  ADMIN_LIST_EXPORT_SCREENS,
  assertAdminListExportWithinLimit,
  kstDateTimeText,
  listExportSheetName,
  normalizeListExportCell,
  type AdminListExportSheet,
} from './list-export';

const FONT = '맑은 고딕';
const NUMBER_FORMAT = '#,##0';
const TEXT_FORMAT = '@';

/**
 * 화면 목록을 확인용 .xlsx로 만든다.
 *
 * - 첫 시트: 머리글 1행(굵게·고정·자동 필터) + 데이터.
 * - 둘째 시트: 화면·조건·내려받은 시각·건수·개인정보 안내.
 * 문자열 셀은 텍스트 서식(@)으로 써서 번호·연락처·우편번호의 선행 0을 보존한다.
 * 수식 객체는 만들지 않는다 — 셀 값은 언제나 문자열·숫자·빈 칸 중 하나다.
 */
export async function buildAdminListExportWorkbook(
  sheet: AdminListExportSheet,
  generatedAt: Date,
): Promise<Buffer> {
  assertAdminListExportWithinLimit(sheet.rows.length);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ICONS';
  workbook.created = generatedAt;
  workbook.modified = generatedAt;

  const data = workbook.addWorksheet(listExportSheetName(sheet.title));
  /* 열 단위 서식을 먼저 두면 행마다 서식 객체를 만들지 않아도 셀이 물려받는다. */
  data.columns = sheet.columns.map((column) => {
    const numeric = column.kind === 'amount' || column.kind === 'count';
    return {
      width: column.width,
      style: {
        font: { name: FONT, size: 10 },
        numFmt: numeric ? NUMBER_FORMAT : TEXT_FORMAT,
        ...(numeric ? { alignment: { horizontal: 'right' as const } } : {}),
      },
    };
  });

  const header = data.addRow(sheet.columns.map((column) => column.header));
  header.height = 22;
  header.eachCell((cell) => {
    cell.font = { name: FONT, size: 10, bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF2F0' } };
    cell.alignment = { vertical: 'middle' };
    cell.numFmt = TEXT_FORMAT;
  });

  for (const values of sheet.rows) {
    data.addRow(sheet.columns.map((column, index) => normalizeListExportCell(column.kind, values[index])));
  }

  data.views = [{ state: 'frozen', ySplit: 1 }];
  if (sheet.columns.length) {
    data.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: Math.max(1, data.rowCount), column: sheet.columns.length },
    };
  }

  const info = workbook.addWorksheet('내려받기 정보');
  info.columns = [{ width: 18 }, { width: 96 }];
  const screen = ADMIN_LIST_EXPORT_SCREENS[sheet.screen];
  const lines: [string, string][] = [
    ['화면', screen.label],
    ...sheet.conditions,
    ['내려받은 시각 (KST)', kstDateTimeText(generatedAt.toISOString())],
    ['건수', `${sheet.recordCount.toLocaleString('ko-KR')}건 · 엑셀 ${sheet.rows.length.toLocaleString('ko-KR')}행`],
    ...sheet.notes.map((note): [string, string] => ['안내', note]),
    ['개인정보', ADMIN_LIST_EXPORT_PRIVACY_NOTICE],
  ];
  for (const [label, value] of lines) {
    const row = info.addRow([normalizeListExportCell('text', label), normalizeListExportCell('text', value)]);
    row.getCell(1).font = { name: FONT, size: 10, bold: true };
    row.getCell(2).font = { name: FONT, size: 10 };
    row.getCell(1).numFmt = TEXT_FORMAT;
    row.getCell(2).numFmt = TEXT_FORMAT;
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
