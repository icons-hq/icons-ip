import type ExcelJS from 'exceljs';

/*
 * 어드민이 사람에게 내주는 엑셀의 공통 모양.
 *
 * 화면이 달라도 같은 파일처럼 읽히도록 글꼴·머리글·틀 고정·필터·숫자 표시·안내 시트를 여기 한 곳에서 정한다.
 * 외부 시스템이 칸 위치까지 읽는 고정 양식(김포 WMS, 서원 송장양식, 상품 일괄 등록, 운송장 회신 3칸)에는 쓰지 않는다.
 *
 * - 머리글: 1행, 굵게, 맑은 고딕 10, 연회색 칸, 높이 22, 틀 고정, 전체 범위 자동 필터.
 * - 숫자: 금액·수량은 숫자 셀 `#,##0` 오른쪽 정렬. 번호·연락처처럼 선행 0이 있는 값은 텍스트 셀(@).
 * - 날짜: 문자열 `YYYY-MM-DD HH:mm`(KST). `kstDateTimeText`로 만든다.
 * - 조회 조건·건수·개인정보 안내: 맨 뒤 `내려받기 정보` 시트.
 */
export const WORKBOOK_FONT_NAME = '맑은 고딕';
export const WORKBOOK_FONT_SIZE = 10;
export const WORKBOOK_HEADER_FILL = 'FFEFF2F0';
export const WORKBOOK_HEADER_HEIGHT = 22;
export const WORKBOOK_NUMBER_FORMAT = '#,##0';
export const WORKBOOK_TEXT_FORMAT = '@';
export const WORKBOOK_INFO_SHEET_NAME = '내려받기 정보';

export const WORKBOOK_FONT = { name: WORKBOOK_FONT_NAME, size: WORKBOOK_FONT_SIZE } as const;

export type WorkbookColumnKind = 'text' | 'amount' | 'count' | 'date';

/** 열 단위 서식. 열에 먼저 두면 행마다 서식 객체를 만들지 않아도 셀이 물려받는다. 날짜는 문자열이므로 텍스트 셀이다. */
export function workbookColumnStyle(kind: WorkbookColumnKind): Partial<ExcelJS.Style> {
  const numeric = kind === 'amount' || kind === 'count';
  return {
    font: { ...WORKBOOK_FONT },
    numFmt: numeric ? WORKBOOK_NUMBER_FORMAT : WORKBOOK_TEXT_FORMAT,
    ...(numeric ? { alignment: { horizontal: 'right' as const } } : {}),
  };
}

/** 머리글 행 한 줄을 표준 모양으로 칠한다. */
export function styleWorkbookHeaderRow(row: ExcelJS.Row): void {
  row.height = WORKBOOK_HEADER_HEIGHT;
  row.eachCell((cell) => {
    cell.font = { ...WORKBOOK_FONT, bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WORKBOOK_HEADER_FILL } };
    cell.alignment = { vertical: 'middle' };
    cell.numFmt = WORKBOOK_TEXT_FORMAT;
  });
}

/** 머리글 아래를 틀 고정하고 데이터 전체에 자동 필터를 건다. 데이터를 다 넣은 뒤 부른다. */
export function finishWorkbookTable(sheet: ExcelJS.Worksheet, columnCount: number, headerRowNumber = 1): void {
  sheet.views = [{ state: 'frozen', ySplit: headerRowNumber }];
  if (columnCount > 0) {
    sheet.autoFilter = {
      from: { row: headerRowNumber, column: 1 },
      to: { row: Math.max(headerRowNumber, sheet.rowCount), column: columnCount },
    };
  }
}

/** 맨 뒤 `내려받기 정보` 시트. 값은 호출하는 쪽에서 수식 방어(`normalizeListExportCell`)를 거쳐 넘긴다. */
export function addWorkbookInfoSheet(workbook: ExcelJS.Workbook, lines: readonly (readonly [string, string])[]): ExcelJS.Worksheet {
  const info = workbook.addWorksheet(WORKBOOK_INFO_SHEET_NAME);
  info.columns = [{ width: 18 }, { width: 96 }];
  for (const [label, value] of lines) {
    const row = info.addRow([label, value]);
    row.getCell(1).font = { ...WORKBOOK_FONT, bold: true };
    row.getCell(2).font = { ...WORKBOOK_FONT };
    row.getCell(1).numFmt = WORKBOOK_TEXT_FORMAT;
    row.getCell(2).numFmt = WORKBOOK_TEXT_FORMAT;
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  }
  return info;
}
