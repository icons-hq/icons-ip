import 'server-only';
import type ExcelJS from 'exceljs';
import { readSafeWorkbookCell } from './workbook-safety';
import {
  GOODS_CUSTOM_INPUT_WORKBOOK_HEADERS, GOODS_CUSTOM_INPUT_WORKBOOK_ROW_LIMIT, GOODS_CUSTOM_INPUT_WORKBOOK_SHEET,
  emptyGoodsCustomInputWorkbookRow, goodsCustomInputWorkbookOrphanErrors,
  type GoodsCustomInputWorkbookInputRow, type GoodsCustomInputWorkbookKey, type GoodsCustomInputWorkbookRow,
} from './goods-custom-input-workbook';

const KEYS = Object.keys(GOODS_CUSTOM_INPUT_WORKBOOK_HEADERS) as GoodsCustomInputWorkbookKey[];
const LISTS: Partial<Record<GoodsCustomInputWorkbookKey, string>> = {
  mode: '편집,전체 해제', enabled: '예,아니오', action: '사용,중지,삭제',
};

export function addGoodsCustomInputWorksheet(workbook: ExcelJS.Workbook, version: string, rows: GoodsCustomInputWorkbookRow[]) {
  if (rows.length > GOODS_CUSTOM_INPUT_WORKBOOK_ROW_LIMIT) throw new Error('직접입력형 옵션은 파일당 5,000행까지입니다.');
  const sheet = workbook.addWorksheet(GOODS_CUSTOM_INPUT_WORKBOOK_SHEET, {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 4, showGridLines: false }],
  });
  sheet.getCell('A1').value = version;
  sheet.getCell('A1').font = { name: 'Arial', size: 14, bold: true };
  sheet.getCell('A2').value = '항목마다 한 행 · 기존 ID·버전 유지 · 시트 또는 상품 행을 없애도 정의는 보존';
  sheet.getCell('A2').font = { name: 'Arial', size: 10, color: { argb: 'FF52525B' } };
  sheet.getRow(1).height = 24;
  sheet.getRow(2).height = 22;
  sheet.getRow(3).height = 8;
  sheet.getRow(4).values = Object.values(GOODS_CUSTOM_INPUT_WORKBOOK_HEADERS);
  sheet.getRow(4).height = 28;
  sheet.autoFilter = `A4:G${Math.max(5, rows.length + 4)}`;
  KEYS.forEach((key, index) => {
    const column = sheet.getColumn(index + 1);
    column.width = key === 'fieldId' ? 42 : key === 'name' ? 30 : 18;
    column.numFmt = '@';
    const header = sheet.getCell(4, index + 1);
    header.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF27272A' } };
    header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    if (LISTS[key]) for (let row = 5; row <= GOODS_CUSTOM_INPUT_WORKBOOK_ROW_LIMIT + 4; row++) {
      sheet.getCell(row, index + 1).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${LISTS[key]}"`],
        showErrorMessage: true, errorTitle: '값 확인', error: '목록의 값을 선택해주세요.' };
    }
  });
  rows.forEach((values, index) => {
    const row = sheet.getRow(index + 5);
    row.values = KEYS.map(key => values[key] || null);
    row.height = 24;
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      const reference = column === 4 || column === 7;
      cell.font = { name: 'Arial', size: 10, color: { argb: reference ? 'FF71717A' : 'FF18181B' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      if (reference) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F4F5' } };
    });
  });
}

export function readGoodsCustomInputWorksheet(workbook: ExcelJS.Workbook, version: string, latestVersion: string,
  goodCodes: readonly string[]): GoodsCustomInputWorkbookInputRow[] | null {
  const sheet = workbook.getWorksheet(GOODS_CUSTOM_INPUT_WORKBOOK_SHEET);
  if (!sheet) return null;
  if (version !== latestVersion && version !== 'ICONS 상품 일괄 등록 v6') throw new Error('직접입력형 옵션 시트는 v6·v7 상품 양식에서 편집할 수 있습니다. 최신 양식을 내려받아주세요.');
  if (sheet.getCell('A1').text !== version || KEYS.some((key, index) => sheet.getCell(4, index + 1).text !== GOODS_CUSTOM_INPUT_WORKBOOK_HEADERS[key]))
    throw new Error('직접입력형 옵션 시트의 버전·열 이름·순서를 유지해주세요.');
  const result: GoodsCustomInputWorkbookInputRow[] = [];
  sheet.eachRow((row, number) => {
    if (number < 5) return;
    const values = emptyGoodsCustomInputWorkbookRow();
    const errors: string[] = [];
    KEYS.forEach((key, index) => {
      const cell = readSafeWorkbookCell(row.getCell(index + 1), key === 'goodCode' || key === 'fieldId');
      values[key] = cell.value;
      if (cell.error) errors.push(`${GOODS_CUSTOM_INPUT_WORKBOOK_HEADERS[key]}: ${cell.error}`);
    });
    values.goodCode = values.goodCode.trim().toUpperCase();
    if (KEYS.some(key => values[key] !== '') || errors.length) result.push({ row: number, values, errors });
  });
  if (result.length > GOODS_CUSTOM_INPUT_WORKBOOK_ROW_LIMIT) throw new Error('직접입력형 옵션은 파일당 5,000행까지입니다.');
  const orphans = goodsCustomInputWorkbookOrphanErrors(result, goodCodes);
  if (orphans.length) throw new Error(orphans.join('\n'));
  return result;
}
