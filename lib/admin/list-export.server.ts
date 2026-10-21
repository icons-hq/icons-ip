import 'server-only';
import ExcelJS from 'exceljs';
import deliveryFormat from './smartstore-delivery-format.json';
import {
  ADMIN_LIST_EXPORT_PRIVACY_NOTICE,
  ADMIN_LIST_EXPORT_ROW_LIMIT,
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

/** Other read-only consoles share the same typed-cell and privacy workbook contract. */
export type ListExportWorkbookSheet = Omit<AdminListExportSheet, 'screen'> & { screenLabel: string };

/**
 * 화면 목록을 확인용 .xlsx로 만든다.
 *
 * - 배송현황: 제공된 스마트스토어 53열 단일 시트와 서식을 유지한다.
 * - 그 밖의 목록 첫 시트: 머리글 1행(굵게·고정·자동 필터) + 데이터.
 * - 그 밖의 목록 둘째 시트: 화면·조건·내려받은 시각·건수·개인정보 안내.
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

  if (sheet.layout === 'smartstore-delivery') {
    if (sheet.columns.length !== deliveryFormat.headers.length || sheet.columns.some((column, index) => column.header !== deliveryFormat.headers[index])) {
      throw new Error('배송현황 엑셀 양식을 확인하지 못했습니다.');
    }
    const data = workbook.addWorksheet(deliveryFormat.sheetName, { properties: { defaultRowHeight: deliveryFormat.defaultRowHeight } });
    data.columns = sheet.columns.map(column => ({ width: deliveryFormat.columnWidth,
      style: { numFmt: column.kind === 'date' ? deliveryFormat.dateFormat : column.kind === 'amount' ? deliveryFormat.amountFormat : column.kind === 'count' ? 'General' : TEXT_FORMAT } }));
    data.addRow(deliveryFormat.headers).eachCell(cell => {
      cell.style = { font: { bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: deliveryFormat.headerFill } }, alignment: { horizontal: 'center' } };
    });
    for (const values of sheet.rows) data.addRow(sheet.columns.map((column, index) => {
      const value = normalizeListExportCell(column.kind, values[index]);
      if (column.kind !== 'date' || value === null) return value;
      const milliseconds = typeof value === 'string' ? Date.parse(value) : NaN;
      if (!Number.isFinite(milliseconds)) throw new Error('배송현황 날짜 정보를 확인하지 못했습니다.');
      // Excel stores wall-clock dates without a timezone; match the Korean source.
      return new Date(milliseconds + 9 * 60 * 60 * 1000);
    }));
    data.autoFilter = 'A1:BA1';
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

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
  const lines: [string, string][] = [
    ['화면', 'screen' in sheet ? ADMIN_LIST_EXPORT_SCREENS[sheet.screen].label : sheet.screenLabel],
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
