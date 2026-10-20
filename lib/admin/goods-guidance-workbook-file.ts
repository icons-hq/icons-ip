import 'server-only';
import type ExcelJS from 'exceljs';
import { readSafeWorkbookCell } from './workbook-safety';
import {
  GOODS_AFTER_SALES_WORKBOOK_HEADERS, GOODS_AFTER_SALES_WORKBOOK_SHEET, GOODS_SIZE_WORKBOOK_HEADERS, GOODS_SIZE_WORKBOOK_SHEET,
  emptyGoodsAfterSalesWorkbookRow, emptyGoodsSizeWorkbookRow, goodsGuidanceOrphanErrors,
  type GoodsAfterSalesWorkbookInputRow, type GoodsAfterSalesWorkbookRow, type GoodsSizeWorkbookInputRow, type GoodsSizeWorkbookRow,
} from './goods-guidance-workbook';

function addSheet(book: ExcelJS.Workbook, version: string, name: string, headers: Record<string, string>, rows: Record<string, string>[], limit: number, description: string, lists: Record<string, string>) {
  if (rows.length > limit) throw new Error(name + ' 시트의 최대 ' + limit.toLocaleString('ko-KR') + '행을 초과했습니다.');
  const keys = Object.keys(headers), sheet = book.addWorksheet(name, { views: [{ state: 'frozen', xSplit: 1, ySplit: 4, showGridLines: false }] });
  sheet.getCell('A1').value = version; sheet.getCell('A1').font = { name: 'Arial', size: 14, bold: true };
  sheet.mergeCells('A2:F2'); sheet.getCell('A2').value = description;
  sheet.getCell('A2').font = { name: 'Arial', size: 10, color: { argb: 'FF52525B' } };
  sheet.getCell('A2').alignment = { wrapText: true, vertical: 'middle' };
  sheet.getRow(1).height = 24; sheet.getRow(2).height = 44; sheet.getRow(3).height = 8;
  sheet.getRow(4).values = Object.values(headers); sheet.getRow(4).height = 32;
  sheet.autoFilter = { from: { row: 4, column: 1 }, to: { row: Math.max(5, rows.length + 4), column: keys.length } };
  keys.forEach((key, index) => {
    const column = sheet.getColumn(index + 1); column.numFmt = '@';
    column.width = ['guide', 'sellerSpecialNotes', 'note'].includes(key) ? 48 : key === 'measurement' ? 24 : key.startsWith('size') || key.startsWith('value') ? 14 : 20;
    const header = sheet.getCell(4, index + 1);
    header.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF27272A' } };
    header.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    if (lists[key]) for (let row = 5; row < limit + 5; row++) sheet.getCell(row, index + 1).dataValidation = {
      type: 'list', allowBlank: true, formulae: ['"' + lists[key] + '"'], showErrorMessage: true, errorTitle: '값 확인', error: '목록에서 선택해주세요.',
    };
  });
  rows.forEach((values, index) => {
    const row = sheet.getRow(index + 5); row.values = keys.map(key => values[key] || null);
    row.height = name === GOODS_AFTER_SALES_WORKBOOK_SHEET ? 60 : 42;
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      cell.font = { name: 'Arial', size: 10, color: { argb: keys[column - 1] === 'revision' ? 'FF71717A' : 'FF18181B' } };
      cell.alignment = { vertical: 'top', wrapText: true };
      if (keys[column - 1] === 'revision') cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F4F5' } };
    });
  });
}

export function addGoodsGuidanceWorksheets(book: ExcelJS.Workbook, version: string, afterSales: GoodsAfterSalesWorkbookRow[], sizes: GoodsSizeWorkbookRow[]) {
  addSheet(book, version, GOODS_AFTER_SALES_WORKBOOK_SHEET, GOODS_AFTER_SALES_WORKBOOK_HEADERS, afterSales, 500,
    '상품당 한 행 · 시트/행 생략은 기존 안내 보존 · 전체 해제는 명시 선택 · 안내 버전 유지', { mode: '편집,전체 해제' });
  addSheet(book, version, GOODS_SIZE_WORKBOOK_SHEET, GOODS_SIZE_WORKBOOK_HEADERS, sizes, 5000,
    '측정 항목마다 한 행(상품당 최대 10행) · 사이즈 1~10과 치수 1~10은 같은 순서 · 표시 중지는 저장된 표 보존 · 표 버전 유지',
    { mode: '편집,표시 중지', enabled: '예,아니오', unit: 'cm,mm' });
}

function readSheet<T extends Record<string, string> & { goodCode: string }>(book: ExcelJS.Workbook, version: string, latest: string, name: string, headers: Record<keyof T, string>, empty: () => T, limit: number, codes: string[]) {
  const sheet = book.getWorksheet(name);
  if (!sheet) return null;
  if (version !== latest) throw new Error(name + ' 시트는 v7 상품 양식에서만 편집할 수 있습니다. 최신 양식을 내려받아주세요.');
  const keys = Object.keys(headers) as (keyof T)[];
  if (sheet.getCell('A1').text !== version || keys.some((key, index) => sheet.getCell(4, index + 1).text !== headers[key])) throw new Error(name + ' 시트의 버전·열 이름·순서를 유지해주세요.');
  const rows: { row: number; values: T; errors: string[] }[] = [];
  sheet.eachRow((row, number) => {
    if (number < 5) return;
    const values = empty(), errors: string[] = [];
    keys.forEach((key, index) => {
      const cell = readSafeWorkbookCell(row.getCell(index + 1), key === 'goodCode' || key === 'phone');
      values[key] = cell.value as T[keyof T];
      if (cell.error) errors.push(headers[key] + ': ' + (key === 'phone' ? cell.error.replace('코드는', '전화번호는') : cell.error));
    });
    if (keys.some(key => values[key] !== '') || errors.length) rows.push({ row: number, values, errors });
  });
  if (rows.length > limit) throw new Error(name + ' 시트는 최대 ' + limit.toLocaleString('ko-KR') + '행입니다.');
  const orphanErrors = goodsGuidanceOrphanErrors(rows, codes, name);
  if (orphanErrors.length) throw new Error(orphanErrors.join('\n'));
  return rows;
}

export function readGoodsGuidanceWorksheets(book: ExcelJS.Workbook, version: string, latest: string, codes: string[]): {
  afterSalesRows: GoodsAfterSalesWorkbookInputRow[] | null; sizeRows: GoodsSizeWorkbookInputRow[] | null;
} {
  return {
    afterSalesRows: readSheet(book, version, latest, GOODS_AFTER_SALES_WORKBOOK_SHEET, GOODS_AFTER_SALES_WORKBOOK_HEADERS, emptyGoodsAfterSalesWorkbookRow, 500, codes),
    sizeRows: readSheet(book, version, latest, GOODS_SIZE_WORKBOOK_SHEET, GOODS_SIZE_WORKBOOK_HEADERS, emptyGoodsSizeWorkbookRow, 5000, codes),
  };
}
