import type ExcelJS from 'exceljs';
import { normalizeListExportCell, type ListExportCellKind, type ListExportCellValue } from './list-export';
import {
  WORKBOOK_TEXT_FORMAT,
  addWorkbookInfoSheet,
  finishWorkbookTable,
  styleWorkbookHeaderRow,
  workbookColumnStyle,
  type WorkbookColumnKind,
} from './workbook-format';

/*
 * 사람용 엑셀의 표 쓰기(목록 한 장, 보고서 여러 장).
 *
 * 모양은 `workbook-format`이 정한다. 여기서는 표 한 장을 같은 순서로 쓰고 모든 셀을
 * `normalizeListExportCell`로 고정한다 — 수식 객체가 셀에 들어가지 않고, `=`로 시작하는 값도 문자열로 남는다.
 */

/**
 * - `number`: 평균·비율처럼 소수가 있거나 `비공개` 같은 문구가 섞이는 칸. 안전한 정수만 받는
 *   금액·수량 칸(`amount`·`count`)과 달리 유한한 숫자를 그대로 둔다. 정수는 `#,##0`, 소수는 `#,##0.00`으로 보인다.
 */
export type WorkbookTableCellKind = ListExportCellKind | 'number';
export type WorkbookTableCell = ListExportCellValue | undefined;

export interface WorkbookTableColumn {
  header: string;
  kind: WorkbookTableCellKind;
  /** 없으면 종류별 기본 너비. 머리글이 더 길면 머리글에 맞춘다. */
  width?: number;
  /** `number` 칸을 한 서식으로 고정할 때(사용률 `0.0%`, 소수를 원 단위로 보이는 객단가 `#,##0`). */
  numFmt?: string;
}

const DECIMAL_FORMAT = '#,##0.00';
const DEFAULT_WIDTH: Record<WorkbookTableCellKind, number> = { text: 22, code: 20, date: 17, amount: 14, count: 10, number: 14 };
const STYLE_KIND: Record<WorkbookTableCellKind, WorkbookColumnKind> = { text: 'text', code: 'text', date: 'date', amount: 'amount', count: 'count', number: 'amount' };

export function tableColumn(header: string, kind: WorkbookTableCellKind = 'text', width?: number, numFmt?: string): WorkbookTableColumn {
  return { header, kind, width, numFmt };
}

/** 한 줄 머리글이 필터 단추에 가리지 않는 최소 너비. 한글은 두 칸으로 센다. */
export function workbookHeaderWidth(header: string): number {
  return [...header].reduce((size, char) => size + (char.codePointAt(0)! > 127 ? 2 : 1), 0) + 3;
}

function tableCell(kind: WorkbookTableCellKind, value: WorkbookTableCell): ListExportCellValue {
  if (kind !== 'number') return normalizeListExportCell(kind, value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  return normalizeListExportCell('text', value);
}

/** 머리글 1행(틀 고정·전체 범위 필터) + 데이터 표 한 장을 쓴다. 0건이면 머리글만 남는다. */
export function addWorkbookTable(
  workbook: ExcelJS.Workbook,
  name: string,
  columns: readonly WorkbookTableColumn[],
  rows: readonly (readonly WorkbookTableCell[])[],
): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns.map((column) => ({
    width: Math.max(column.width ?? DEFAULT_WIDTH[column.kind], workbookHeaderWidth(column.header)),
    style: { ...workbookColumnStyle(STYLE_KIND[column.kind]), ...(column.numFmt ? { numFmt: column.numFmt } : {}) },
  }));
  styleWorkbookHeaderRow(sheet.addRow(columns.map((column) => column.header)));
  for (const values of rows) {
    const cells = columns.map((column, index) => tableCell(column.kind, values[index]));
    const row = sheet.addRow(cells);
    columns.forEach((column, index) => {
      if (column.kind !== 'number' || column.numFmt) return;
      const value = cells[index];
      if (typeof value === 'string') row.getCell(index + 1).numFmt = WORKBOOK_TEXT_FORMAT;
      else if (typeof value === 'number' && !Number.isInteger(value)) row.getCell(index + 1).numFmt = DECIMAL_FORMAT;
    });
  }
  finishWorkbookTable(sheet, columns.length);
  return sheet;
}

/** 맨 뒤 `내려받기 정보` 시트. 값은 수식 방어를 거쳐 문구로 적는다. */
export function addSafeWorkbookInfoSheet(
  workbook: ExcelJS.Workbook,
  lines: readonly (readonly [string, string | number])[],
): ExcelJS.Worksheet {
  const safe = (value: string | number) => String(normalizeListExportCell('text', value) ?? '');
  return addWorkbookInfoSheet(workbook, lines.map(([label, value]) => [safe(label), safe(value)] as const));
}
