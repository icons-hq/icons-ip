/*
 * ERP 품목 반입 — 붙여넣기·파일 표를 읽어 반입 행으로 바꾸는 순수 로직.
 *
 * 실제 ERP 내보내기 샘플이 없어서 열 이름을 넓게 자동 인식하고, 미리보기에서
 * 열마다 대상 항목을 직접 바꿀 수 있게 한다. 브라우저(붙여넣기·미리보기)와
 * 서버 액션(재검증)이 같은 함수를 쓰고, DB RPC가 같은 규칙을 한 번 더 강제한다.
 */
import { ERP_ITEM_LIMITS, ERP_ITEM_REJECT_REASON_LABELS, type ErpItemRejectReason } from './erp-items';
import { decodeSpreadsheetText, parseDelimitedText } from './spreadsheet-text';

export type ErpItemField = 'code' | 'name' | 'category' | 'salePrice' | 'barcode';
export type ErpColumnTarget = ErpItemField | 'ignore';

export const ERP_COLUMN_TARGETS: readonly ErpColumnTarget[] = ['code', 'name', 'category', 'salePrice', 'barcode', 'ignore'];
export const ERP_COLUMN_TARGET_LABELS: Record<ErpColumnTarget, string> = {
  code: 'ERP 코드(품번)',
  name: 'ERP 품명',
  category: 'ERP 분류',
  salePrice: '판매가',
  barcode: '바코드',
  ignore: '가져오지 않음',
};

export const ERP_ITEM_IMPORT_ROW_LIMIT = 5_000;
/** 서버 액션 요청 본문 1MB 상한 안에 들도록 나눠 보내는 행 수. */
export const ERP_ITEM_IMPORT_CHUNK_SIZE = 500;
export const ERP_ITEM_HEADER_SCAN_ROWS = 10;
export const ERP_ITEM_COLUMN_LIMIT = 100;
export const ERP_ITEM_CELL_CHAR_LIMIT = 1_000;
/** 서버 액션 요청 본문(기본 1MB) 안에 파일과 양식 경계가 함께 들어가야 한다. */
export const ERP_ITEM_FILE_BYTES_LIMIT = 900 * 1024;
export const ERP_ITEM_PASTE_CHAR_LIMIT = 2_000_000;
export const ERP_ITEM_PREVIEW_ROWS = 20;

/* 별칭은 공백·괄호를 지우고 소문자로 비교한다. 앞에 둔 별칭일수록 우선한다. */
const SINGLE_ALIASES: Record<Exclude<ErpItemField, 'category'>, readonly string[]> = {
  code: ['품번', '품목코드', '품목번호', 'erp코드', '자체상품코드', '상품코드', 'itemcode', '코드'],
  name: ['품명', '품목명', 'erp품명', '상품명', 'itemname', '품목'],
  salePrice: ['판매가', '판매단가', '판매가격', '출고단가', '소비자가', '소비자가격', '단가'],
  barcode: ['바코드', '바코드번호', '바코드ean', 'ean', 'ean13'],
};
const CATEGORY_ALIASES = ['카테고리', '카테고리명', 'erp분류', '품목그룹', '품목그룹명', '품목군', '분류', '분류명'] as const;
/* 대·중·소분류(품목그룹1·2·3)가 따로 있으면 ' > '로 이어 붙인다. */
const CATEGORY_LEVEL_ALIASES = ['대분류', '품목그룹1', '중분류', '품목그룹2', '소분류', '품목그룹3', '세분류', '품목그룹4'] as const;

type HeaderMatch = { field: ErpItemField; priority: number; level: boolean };
const HEADER_ALIASES = new Map<string, HeaderMatch>([
  ...Object.entries(SINGLE_ALIASES).flatMap(([field, aliases]) =>
    aliases.map((alias, priority) => [alias, { field: field as ErpItemField, priority, level: false }] as const)),
  ...CATEGORY_ALIASES.map((alias, priority) => [alias, { field: 'category' as const, priority, level: false }] as const),
  ...CATEGORY_LEVEL_ALIASES.map((alias, priority) => [alias, { field: 'category' as const, priority: CATEGORY_ALIASES.length + priority, level: true }] as const),
]);

export function normalizeErpHeader(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s()[\]{}（）［］*]/g, '');
}

export function erpHeaderMatch(value: string): HeaderMatch | null {
  return HEADER_ALIASES.get(normalizeErpHeader(value)) ?? null;
}

/* DB(private.erp_item_text)와 같은 공백 집합. 로캘마다 \s가 달라지지 않도록 명시한다. */
const SPACE_CHARS = ' \\t\\n\\r\\f\\v\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff';
const EDGE_SPACE = new RegExp(`^[${SPACE_CHARS}]+|[${SPACE_CHARS}]+$`, 'g');
const SPACE_RUN = new RegExp(`[${SPACE_CHARS}]+`, 'g');
/* NUL은 Postgres 텍스트에 들어갈 수 없으므로 함께 거절한다. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const CONTROL_CHARS_ALL = new RegExp(CONTROL_CHARS.source, 'g');

/** 앞뒤 공백 제거. collapse면 줄바꿈·탭을 포함한 공백 연속을 하나로 합친다. */
export function normalizeErpText(value: string, collapse: boolean): string {
  return (collapse ? value.replace(SPACE_RUN, ' ') : value).replace(EDGE_SPACE, '');
}

function isBlank(value: string): boolean {
  return value === '' || value === '-';
}

/** 판매가: 쉼표·원·₩·공백을 지우고 원 단위 정수로 읽는다. 비어 있으면 null. */
export function parseErpSalePrice(raw: string): { ok: true; value: number | null } | { ok: false } {
  const cleaned = raw.replace(/[\s 　,원₩￦\\]/g, '');
  if (isBlank(cleaned)) return { ok: true, value: null };
  if (!/^\d{1,12}(\.0+)?$/.test(cleaned)) return { ok: false };
  const value = Number(cleaned);
  return Number.isSafeInteger(value) && value <= ERP_ITEM_LIMITS.salePrice ? { ok: true, value } : { ok: false };
}

/** RPC로 보내는 한 행. 열을 지정하지 않은 항목은 키 자체가 없다(기존 값 유지). */
export interface ErpImportRow {
  /** 원본 표의 행 번호(1부터). 붙여넣기는 줄 번호, 파일은 시트 행 번호. */
  row: number;
  code: string;
  name: string;
  category?: string | null;
  salePrice?: number | null;
  barcode?: string | null;
}

export interface ErpImportIssue {
  row: number;
  code: string;
  reason: ErpItemRejectReason;
}

type RawErpRow = { row: number; code: string; name: string; category?: string; salePrice?: string; barcode?: string };

function issue(row: number, code: string, reason: ErpItemRejectReason): { ok: false; issue: ErpImportIssue } {
  return { ok: false, issue: { row, code: code.replace(CONTROL_CHARS_ALL, ' ').slice(0, ERP_ITEM_LIMITS.code), reason } };
}

/** 표에서 읽은 문자열 한 행을 반입 행으로 정규화한다. */
export function normalizeErpRawRow(input: RawErpRow): { ok: true; row: ErpImportRow } | { ok: false; issue: ErpImportIssue } {
  const code = normalizeErpText(input.code, false);
  if (!code) return issue(input.row, '', 'missing_code');
  if (code.length > ERP_ITEM_LIMITS.code || CONTROL_CHARS.test(code)) return issue(input.row, code, 'invalid_code');
  const name = normalizeErpText(input.name, true);
  if (!name) return issue(input.row, code, 'missing_name');
  if (name.length > ERP_ITEM_LIMITS.name || CONTROL_CHARS.test(name)) return issue(input.row, code, 'invalid_name');
  const row: ErpImportRow = { row: input.row, code, name };
  if (input.category !== undefined) {
    const category = normalizeErpText(input.category, true);
    if (category.length > ERP_ITEM_LIMITS.category || CONTROL_CHARS.test(category)) return issue(input.row, code, 'invalid_category');
    row.category = isBlank(category) ? null : category;
  }
  if (input.salePrice !== undefined) {
    const price = parseErpSalePrice(input.salePrice);
    if (!price.ok) return issue(input.row, code, 'invalid_sale_price');
    row.salePrice = price.value;
  }
  if (input.barcode !== undefined) {
    const barcode = normalizeErpText(input.barcode, false);
    if (barcode.length > ERP_ITEM_LIMITS.barcode || CONTROL_CHARS.test(barcode)) return issue(input.row, code, 'invalid_barcode');
    row.barcode = isBlank(barcode) ? null : barcode;
  }
  return { ok: true, row };
}

/** 서버 액션이 브라우저에서 받은 행을 다시 검증한다. 브라우저 값은 신뢰하지 않는다. */
export function normalizeErpImportRowInput(value: unknown, fallbackRow: number): { ok: true; row: ErpImportRow } | { ok: false; issue: ErpImportIssue } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return issue(fallbackRow, '', 'invalid_row');
  const input = value as Record<string, unknown>;
  const row = Number.isSafeInteger(input.row) && (input.row as number) > 0 && (input.row as number) < 1_000_000_000
    ? input.row as number : fallbackRow;
  if (typeof input.code !== 'string') return issue(row, '', input.code == null ? 'missing_code' : 'invalid_code');
  if (typeof input.name !== 'string') return issue(row, input.code, input.name == null ? 'missing_name' : 'invalid_name');
  const raw: RawErpRow = { row, code: input.code, name: input.name };
  for (const key of ['category', 'barcode'] as const) {
    if (!Object.hasOwn(input, key)) continue;
    if (input[key] === null) raw[key] = '';
    else if (typeof input[key] === 'string') raw[key] = input[key] as string;
    else return issue(row, input.code, key === 'category' ? 'invalid_category' : 'invalid_barcode');
  }
  if (Object.hasOwn(input, 'salePrice')) {
    if (input.salePrice === null) raw.salePrice = '';
    else if (typeof input.salePrice === 'number' && Number.isFinite(input.salePrice)) raw.salePrice = String(input.salePrice);
    else if (typeof input.salePrice === 'string') raw.salePrice = input.salePrice;
    else return issue(row, input.code, 'invalid_sale_price');
  }
  return normalizeErpRawRow(raw);
}

/** RPC `admin_import_erp_items`의 행 형식. 지정하지 않은 열은 키를 넣지 않는다. */
export function erpImportRowPayload(row: ErpImportRow): Record<string, string | number | null> {
  return {
    row: row.row,
    code: row.code,
    name: row.name,
    ...(row.category !== undefined ? { category: row.category } : {}),
    ...(row.salePrice !== undefined ? { sale_price: row.salePrice } : {}),
    ...(row.barcode !== undefined ? { barcode: row.barcode } : {}),
  };
}

export function chunkErpImportRows<T>(rows: readonly T[], size = ERP_ITEM_IMPORT_CHUNK_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size));
  return chunks;
}

/**
 * CSV·텍스트 바이트: UTF-16(엑셀 유니코드 텍스트) → UTF-8(BOM 포함) → 한국어 ERP가 흔히 쓰는
 * EUC-KR 순으로 읽는다. CP949 확장 한글처럼 글자가 되지 않으면 다시 저장하라고 안내한다(공통 경계).
 */
export const decodeErpTextBytes = decodeSpreadsheetText;

function detectDelimiter(text: string): '\t' | ',' {
  return text.slice(0, 20_000).includes('\t') ? '\t' : ',';
}

/* 정상적인 엑셀 셀은 이보다 길 수 없다(셀 길이 상한의 10배). 넘으면 닫히지 않은 따옴표로 본다. */
const QUOTED_CELL_SCAN_LIMIT = ERP_ITEM_CELL_CHAR_LIMIT * 10;

export interface ErpDelimitedTable {
  rows: string[][];
  warnings: string[];
}

/**
 * 엑셀 복사(탭 구분)와 CSV를 읽는다. 셀 전체를 감싼 따옴표 안의 구분자·줄바꿈·"" 이스케이프를
 * 셀 값으로 읽는다. 셀을 감싸지 않은 따옴표는 값의 일부로 보존하고, 닫히지 않은 따옴표는 원문
 * 그대로 두고 경고한다 — 뒤 행이 한 셀로 합쳐지지 않게 한다. 줄 번호는 레코드 순서(1부터)와 같다.
 */
export function parseErpDelimitedTable(text: string): ErpDelimitedTable {
  const source = text.replace(/^\ufeff/, '');
  const { rows, unclosedCells } = parseDelimitedText(source, detectDelimiter(source), { quotedCellScanLimit: QUOTED_CELL_SCAN_LIMIT });
  const warnings = unclosedCells.length
    ? [`닫는 큰따옴표가 없는 셀 ${unclosedCells.length.toLocaleString('ko-KR')}개(${unclosedCells.slice(0, 3).map((line) => `${line}행`).join(', ')}${unclosedCells.length > 3 ? ' 등' : ''})는 따옴표를 포함해 적힌 그대로 읽었습니다. 값을 확인해주세요.`]
    : [];
  return { rows, warnings };
}

/** {@link parseErpDelimitedTable}의 행만 돌려준다. */
export function parseErpDelimitedText(text: string): string[][] {
  return parseErpDelimitedTable(text).rows;
}

/** 열 수·셀 길이를 묶어 둔다. 상한을 넘는 셀은 잘라도 길이 검증에서 거부된다. */
export function boundErpTable(table: readonly (readonly string[])[]): string[][] {
  return table.map((row) => row.slice(0, ERP_ITEM_COLUMN_LIMIT).map((cell) => cell.slice(0, ERP_ITEM_CELL_CHAR_LIMIT)));
}

function isEmptyRow(row: readonly string[] | undefined): boolean {
  return !row || row.every((cell) => normalizeErpText(cell, true) === '');
}

/** 처음 10행 안에서 별칭이 가장 많이 맞는 행을 머리글로 본다. 하나도 없으면 -1. */
export function detectErpHeaderRow(table: readonly (readonly string[])[]): number {
  let best = -1;
  let bestScore = 0;
  for (let index = 0; index < Math.min(table.length, ERP_ITEM_HEADER_SCAN_ROWS); index += 1) {
    const score = table[index].filter((cell) => erpHeaderMatch(cell)).length;
    if (score > bestScore) { best = index; bestScore = score; }
  }
  return best;
}

/** 머리글로 기본 열 대상을 정한다. 같은 항목 후보가 여럿이면 우선 별칭·왼쪽 열을 고른다. */
export function defaultErpColumnMapping(header: readonly string[], columnCount = header.length): ErpColumnTarget[] {
  const mapping: ErpColumnTarget[] = Array.from({ length: columnCount }, () => 'ignore');
  const matches = header.map((cell, index) => ({ index, match: erpHeaderMatch(cell) }));
  for (const field of ['code', 'name', 'salePrice', 'barcode'] as const) {
    const best = matches.filter((entry) => entry.match?.field === field)
      .sort((left, right) => left.match!.priority - right.match!.priority || left.index - right.index)[0];
    if (best) mapping[best.index] = field;
  }
  const categories = matches.filter((entry) => entry.match?.field === 'category');
  const levels = categories.filter((entry) => entry.match!.level);
  if (levels.length >= 2) {
    for (const entry of levels) mapping[entry.index] = 'category';
  } else {
    const best = [...categories].sort((left, right) => left.match!.priority - right.match!.priority || left.index - right.index)[0];
    if (best) mapping[best.index] = 'category';
  }
  return mapping;
}

/** 미리보기 select 변경. ERP 분류만 여러 열을 이어 붙일 수 있고, 나머지는 한 열만 갖는다. */
export function assignErpColumnTarget(mapping: readonly ErpColumnTarget[], index: number, target: ErpColumnTarget): ErpColumnTarget[] {
  return mapping.map((current, position) => {
    if (position === index) return target;
    if (target !== 'ignore' && target !== 'category' && current === target) return 'ignore';
    return current;
  });
}

function columnLetter(index: number): string {
  let label = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) label = String.fromCharCode(65 + ((value - 1) % 26)) + label;
  return label;
}

export interface ErpImportColumn {
  index: number;
  /** 머리글 원문. 머리글이 없으면 'A열' 같은 위치 이름. */
  label: string;
  /** 첫 데이터 행의 값(미리보기 안내용). */
  sample: string;
  target: ErpColumnTarget;
}

export interface ErpImportPlan {
  /** 머리글 행(0부터). -1이면 머리글 없이 첫 행부터 데이터로 본다. */
  headerIndex: number;
  columns: ErpImportColumn[];
  /** ERP 코드 기준으로 합친 반입 행(같은 코드는 마지막 행). */
  rows: ErpImportRow[];
  issues: ErpImportIssue[];
  /** 머리글 아래의 비어 있지 않은 행 수. */
  dataRowCount: number;
  /** ERP 코드와 품명이 모두 빈 행(합계·메모 행 등). 반입하지 않는다. */
  skippedRowCount: number;
  duplicateCount: number;
  duplicateCodes: string[];
  missingFields: ErpItemField[];
  /** 반입할 수 없는 이유. 없으면 null. */
  blocking: string | null;
  warnings: string[];
}

export interface ErpImportPlanOptions {
  headerIndex?: number;
  mapping?: readonly ErpColumnTarget[];
  /** 파일에서 숫자 셀이 있었던 열(0부터). ERP 코드·바코드 열이면 선행 0 손실을 경고한다. */
  numericColumns?: readonly number[];
}

/** 표 → 미리보기·반입 계획. 머리글과 열 대상은 옵션으로 덮어쓸 수 있다. */
export function buildErpImportPlan(table: readonly (readonly string[])[], options: ErpImportPlanOptions = {}): ErpImportPlan {
  const columnCount = Math.min(ERP_ITEM_COLUMN_LIMIT, table.reduce((max, row) => Math.max(max, row.length), 0));
  const detected = detectErpHeaderRow(table);
  const headerIndex = options.headerIndex !== undefined && options.headerIndex >= -1 && options.headerIndex < Math.min(table.length, ERP_ITEM_HEADER_SCAN_ROWS)
    ? options.headerIndex : detected;
  const header = headerIndex >= 0 ? table[headerIndex] : [];
  const mapping: ErpColumnTarget[] = options.mapping && options.mapping.length === columnCount
    ? [...options.mapping]
    : headerIndex >= 0 ? defaultErpColumnMapping(header, columnCount) : Array.from({ length: columnCount }, () => 'ignore');

  const dataStart = headerIndex + 1;
  const firstData = table.slice(dataStart).find((row) => !isEmptyRow(row)) ?? [];
  const columns = mapping.map((target, index) => ({
    index,
    label: normalizeErpText(header[index] ?? '', true) || `${columnLetter(index)}열`,
    sample: normalizeErpText(firstData[index] ?? '', true).slice(0, 80),
    target,
  }));

  const indexes = (field: ErpItemField) => mapping.flatMap((target, index) => target === field ? [index] : []);
  const codeColumn = indexes('code')[0];
  const nameColumn = indexes('name')[0];
  const categoryColumns = indexes('category');
  const salePriceColumn = indexes('salePrice')[0];
  const barcodeColumn = indexes('barcode')[0];
  const missingFields: ErpItemField[] = [
    ...(codeColumn === undefined ? ['code' as const] : []),
    ...(nameColumn === undefined ? ['name' as const] : []),
  ];

  const warnings: string[] = [];
  if (headerIndex < 0 && table.length) warnings.push('머리글 행을 찾지 못했습니다. 열마다 가져올 항목을 골라주세요.');
  const numeric = new Set(options.numericColumns ?? []);
  for (const [field, column] of [['code', codeColumn], ['barcode', barcodeColumn]] as const) {
    if (column !== undefined && numeric.has(column)) {
      warnings.push(`${ERP_COLUMN_TARGET_LABELS[field]} 열에 숫자 형식 셀이 있습니다. 엑셀에서 앞자리 0이 빠졌을 수 있으니 ERP 원본과 비교해주세요.`);
    }
  }

  const byCode = new Map<string, ErpImportRow>();
  const issues: ErpImportIssue[] = [];
  const duplicates: string[] = [];
  let dataRowCount = 0;
  let skippedRowCount = 0;
  for (let index = dataStart; index < table.length; index += 1) {
    const cells = table[index];
    if (isEmptyRow(cells)) continue;
    dataRowCount += 1;
    if (missingFields.length) continue;
    const cell = (column: number | undefined) => column === undefined ? undefined : cells[column] ?? '';
    const code = cell(codeColumn)!;
    const name = cell(nameColumn)!;
    if (normalizeErpText(code, false) === '' && normalizeErpText(name, true) === '') { skippedRowCount += 1; continue; }
    const result = normalizeErpRawRow({
      row: index + 1,
      code,
      name,
      ...(categoryColumns.length ? {
        category: categoryColumns.map((column) => normalizeErpText(cells[column] ?? '', true)).filter((part) => !isBlank(part)).join(' > '),
      } : {}),
      ...(salePriceColumn !== undefined ? { salePrice: cell(salePriceColumn) } : {}),
      ...(barcodeColumn !== undefined ? { barcode: cell(barcodeColumn) } : {}),
    });
    if (!result.ok) { issues.push(result.issue); continue; }
    if (byCode.has(result.row.code)) duplicates.push(result.row.code);
    byCode.set(result.row.code, result.row);
  }

  const duplicateCodes = [...new Set(duplicates)];
  if (duplicates.length) {
    const sample = duplicateCodes.slice(0, 5).join(', ');
    warnings.push(`같은 ERP 코드가 ${duplicates.length.toLocaleString('ko-KR')}번 다시 나와 마지막 행으로 반입합니다: ${sample}${duplicateCodes.length > 5 ? ' 외' : ''}`);
  }
  if (skippedRowCount) warnings.push(`ERP 코드와 품명이 모두 빈 ${skippedRowCount.toLocaleString('ko-KR')}행은 반입하지 않습니다.`);

  const rows = [...byCode.values()];
  let blocking: string | null = null;
  if (missingFields.length) {
    blocking = `${missingFields.map((field) => ERP_COLUMN_TARGET_LABELS[field]).join('·')} 열을 골라야 반입할 수 있습니다.`;
  } else if (dataRowCount > ERP_ITEM_IMPORT_ROW_LIMIT) {
    blocking = `한 번에 ${ERP_ITEM_IMPORT_ROW_LIMIT.toLocaleString('ko-KR')}행까지 반입할 수 있습니다. 파일을 나누어 반입해주세요.`;
  } else if (!rows.length) {
    blocking = dataRowCount ? '반입할 수 있는 행이 없습니다. 행별 사유를 확인해주세요.' : '반입할 행이 없습니다.';
  }

  return {
    headerIndex,
    columns,
    rows,
    issues,
    dataRowCount,
    skippedRowCount,
    duplicateCount: duplicates.length,
    duplicateCodes,
    missingFields,
    blocking,
    warnings,
  };
}

export function erpImportIssueLabel(issue: Pick<ErpImportIssue, 'reason'>): string {
  return ERP_ITEM_REJECT_REASON_LABELS[issue.reason];
}
