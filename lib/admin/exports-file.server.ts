import 'server-only';

import ExcelJS from 'exceljs';
import officeCrypto from 'officecrypto-tool';
import { CSV_BOM, renderCsv, type ExportColumn } from './exports';

/*
 * 파일 만들기 (D-4b).
 *
 * CSV 는 순수 렌더러(`renderCsv`)가 만들고, 엑셀은 여기서 만든다 — ExcelJS 는 서버 전용 의존성이라
 * 순수 모듈에 들이지 않는다. 개인정보가 든 엑셀은 파일 열기 암호를 걸어 저장한다
 * (고시 제2025-9호 §7 「저장 시 암호화」의 우리 판 — 파일이 메일·메신저로 옮겨져도 그대로 안 열린다).
 */

export interface ExportFile {
  bytes: Buffer;
  contentType: string;
  encrypted: boolean;
}

/** 엑셀이 UTF-8 로 읽게 BOM 을 붙인다. */
export function buildCsvFile(columns: readonly ExportColumn[], rows: readonly Record<string, unknown>[]): ExportFile {
  return {
    bytes: Buffer.from(CSV_BOM + renderCsv(columns, rows), 'utf8'),
    contentType: 'text/csv',
    encrypted: false,
  };
}

/**
 * 엑셀 파일. 우편번호처럼 앞의 0 이 의미인 값은 문자열 셀로 쓰고, 수량·금액은 숫자로 둔다.
 * 비밀번호를 주면 열기 암호를 건 파일로 바꾼다(ECMA-376 Agile).
 */
export async function buildXlsxFile(
  columns: readonly ExportColumn[],
  rows: readonly Record<string, unknown>[],
  options: { sheetName?: string; password?: string | null } = {},
): Promise<ExportFile> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = new Date();
  const sheet = workbook.addWorksheet(options.sheetName ?? '내보내기');

  sheet.columns = columns.map((column) => ({
    header: column.header,
    key: `${column.key}:${column.header}`,
    width: Math.min(40, Math.max(10, column.header.length * 2 + 4)),
  }));
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    sheet.addRow(columns.map((column) => {
      const value = row[column.key];
      if (value === null || value === undefined) return '';
      if (column.format === 'number') return typeof value === 'number' ? value : Number(value) || 0;
      /* `text` 서식은 문자열로 강제한다 — 엑셀이 06236 을 6236 으로 읽지 않게. */
      return String(value);
    }));
  }
  /* 앞의 0 을 지켜야 하는 열은 셀 서식도 문자열로 못 박는다. */
  columns.forEach((column, index) => {
    if (column.format === 'text') sheet.getColumn(index + 1).numFmt = '@';
  });

  const plain = Buffer.from(await workbook.xlsx.writeBuffer());
  if (!options.password) {
    return {
      bytes: plain,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      encrypted: false,
    };
  }

  const encrypted = await officeCrypto.encrypt(plain, { password: options.password });
  return {
    bytes: Buffer.from(encrypted),
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    encrypted: true,
  };
}
