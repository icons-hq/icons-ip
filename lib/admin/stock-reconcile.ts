/*
 * 재고 파일 대조(1007-009·1007-011) — 붙여넣기·파일 표를 대조 행으로 바꾸는 순수 로직과 화면 문서 해석.
 *
 * 표 읽기·머리글 정규화는 ERP 품목 반입(lib/admin/erp-item-import)과 같고 열 대상만 다르다.
 * 브라우저(미리보기)와 서버 액션(재검증)이 같은 함수를 쓰고, 옵션 매칭·차이 계산·반영은 DB RPC가 한다.
 * 파일 수량은 그 시각 창고에 있던 ICONS 몫 실물이다(ADR-0005). 사이트 재고수량과 바로 비교하지 않고
 * 출고 대기·회수 뒤 재고 미반영·기준 시각 뒤 출고를 더하고 기준 시각 뒤 회수를 빼서 비교한다
 * — 계산은 `admin_preview_stock_reconcile`(`private.stock_reconcile_flows`)이 소유한다.
 */
import { isUuid } from '@/lib/uuid';
import { boundErpTable, normalizeErpHeader, normalizeErpText, parseErpDelimitedTable } from './erp-item-import';

export const STOCK_RECONCILE_PATH = '/admin/catalog/stock-reconcile';
export const STOCK_RECONCILE_ROW_LIMIT = 2_000;
export const STOCK_RECONCILE_HEADER_SCAN_ROWS = 10;
export const STOCK_RECONCILE_QTY_LIMIT = 100_000_000;
export const STOCK_RECONCILE_KEY_LIMIT = 200;
export const STOCK_RECONCILE_LABEL_LIMIT = 200;
export const STOCK_RECONCILE_REASON_LIMIT = 200;
/** 파일 기준 시각은 이 날수 이내만 받는다(DB와 같다). 오래된 파일일수록 기록으로 가를 수 없는 변경이 쌓인다. */
export const STOCK_RECONCILE_AS_OF_DAYS = 7;

export type StockKeyField = 'goodsCode' | 'optionCode' | 'erpCode' | 'barcode';
export type StockColumnTarget = StockKeyField | 'quantity' | 'ignore';
export const STOCK_KEY_FIELDS: readonly StockKeyField[] = ['optionCode', 'erpCode', 'barcode', 'goodsCode'];
export const STOCK_COLUMN_TARGETS: readonly StockColumnTarget[] = ['optionCode', 'erpCode', 'barcode', 'goodsCode', 'quantity', 'ignore'];
export const STOCK_COLUMN_TARGET_LABELS: Record<StockColumnTarget, string> = {
  optionCode: '관리코드',
  erpCode: 'ERP 코드(품번)',
  barcode: '바코드',
  goodsCode: '판매자상품코드',
  quantity: '재고 수량',
  ignore: '가져오지 않음',
};

/* 별칭은 공백·괄호를 지우고 소문자로 비교한다(ERP 반입과 같은 정규화). 앞에 둔 별칭일수록 우선한다.
   ERP·창고 파일의 '상품코드'는 보통 ERP 품목코드라 ERP 코드로 읽는다. */
const ALIASES: Record<Exclude<StockColumnTarget, 'ignore'>, readonly string[]> = {
  optionCode: ['관리코드', '옵션관리코드', '옵션코드', '단품코드', 'sku', 'sku코드'],
  erpCode: ['품번', '품목코드', '품목번호', 'erp코드', '자체상품코드', '상품코드', 'itemcode', '코드'],
  barcode: ['바코드', '바코드번호', '바코드ean', 'ean', 'ean13', 'barcode'],
  goodsCode: ['판매자상품코드', '판매자상품번호', '쇼핑몰상품코드'],
  quantity: ['재고수량', '현재고', '현재고수량', '실재고', '실재고수량', '가용재고', '가용수량', '정상재고', '정상재고수량', '재고량', '재고',
    '수량', 'qty', 'quantity', 'stock', 'onhand'],
};
type HeaderMatch = { target: Exclude<StockColumnTarget, 'ignore'>; priority: number };
const HEADER_ALIASES = new Map<string, HeaderMatch>(
  Object.entries(ALIASES).flatMap(([target, aliases]) =>
    aliases.map((alias, priority) => [alias, { target: target as HeaderMatch['target'], priority }] as const)),
);
export function stockHeaderMatch(value: string): HeaderMatch | null {
  return HEADER_ALIASES.get(normalizeErpHeader(value)) ?? null;
}

/* DB(private.stock_reconcile_resolve 앞 검증)와 같은 규칙. NUL·제어 문자는 거절한다. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;

/** RPC로 보내는 한 행. 고르지 않은 키 열은 키 자체가 없다. */
export interface StockReconcileRow {
  /** 원본 표의 행 번호(1부터). 붙여넣기는 줄 번호, 파일은 시트 행 번호. */
  row: number;
  optionCode?: string;
  erpCode?: string;
  barcode?: string;
  goodsCode?: string;
  qty: number;
}

export type StockClientIssueReason = 'missing_key' | 'invalid_key' | 'missing_quantity' | 'invalid_quantity' | 'negative_quantity';
export interface StockClientIssue { row: number; key: string; reason: StockClientIssueReason }
export const STOCK_CLIENT_ISSUE_LABELS: Record<StockClientIssueReason, string> = {
  missing_key: '코드 칸이 비어 있음',
  invalid_key: '코드가 너무 길거나 읽을 수 없는 글자가 있음',
  missing_quantity: '수량이 비어 있음',
  invalid_quantity: '수량이 정수가 아님',
  negative_quantity: '수량이 음수임(창고·ERP에서 확인 필요)',
};

/** 수량: 쉼표·공백·'개'를 지우고 0 이상 정수로 읽는다. */
export function parseStockQuantity(raw: string): { ok: true; value: number } | { ok: false; reason: Extract<StockClientIssueReason, 'missing_quantity' | 'invalid_quantity' | 'negative_quantity'> } {
  const cleaned = raw.replace(/[\s 　,개]/g, '');
  if (cleaned === '' || cleaned === '-') return { ok: false, reason: 'missing_quantity' };
  if (/^[-−]\d+(\.0+)?$/.test(cleaned)) return { ok: false, reason: 'negative_quantity' };
  if (!/^\d{1,9}(\.0+)?$/.test(cleaned)) return { ok: false, reason: 'invalid_quantity' };
  const value = Number.parseInt(cleaned, 10);
  return value <= STOCK_RECONCILE_QTY_LIMIT ? { ok: true, value } : { ok: false, reason: 'invalid_quantity' };
}

function normalizeKey(raw: string | undefined): { ok: true; value: string | undefined } | { ok: false } {
  if (raw === undefined) return { ok: true, value: undefined };
  const value = normalizeErpText(raw, false);
  if (value === '' || value === '-') return { ok: true, value: undefined };
  if (value.length > STOCK_RECONCILE_KEY_LIMIT || CONTROL_CHARS.test(value)) return { ok: false };
  return { ok: true, value };
}

type RawStockRow = { row: number; qty: string } & Partial<Record<StockKeyField, string>>;

/** 표에서 읽은 문자열 한 행을 대조 행으로 정규화한다. */
export function normalizeStockRawRow(input: RawStockRow): { ok: true; row: StockReconcileRow } | { ok: false; issue: StockClientIssue } {
  const keys: Partial<Record<StockKeyField, string>> = {};
  for (const field of STOCK_KEY_FIELDS) {
    const key = normalizeKey(input[field]);
    if (!key.ok) return { ok: false, issue: { row: input.row, key: (input[field] ?? '').replace(new RegExp(CONTROL_CHARS.source, 'g'), ' ').slice(0, 60), reason: 'invalid_key' } };
    if (key.value !== undefined) keys[field] = key.value;
  }
  const label = keys.optionCode ?? keys.erpCode ?? keys.barcode ?? keys.goodsCode ?? '';
  if (!label) return { ok: false, issue: { row: input.row, key: '', reason: 'missing_key' } };
  const qty = parseStockQuantity(input.qty);
  if (!qty.ok) return { ok: false, issue: { row: input.row, key: label, reason: qty.reason } };
  return { ok: true, row: { row: input.row, ...keys, qty: qty.value } };
}

/** 서버 액션이 브라우저에서 받은 행을 다시 검증한다. 브라우저 값은 신뢰하지 않는다. */
export function normalizeStockRowInput(value: unknown): StockReconcileRow | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (!Number.isSafeInteger(input.row) || (input.row as number) < 1 || (input.row as number) > 999_999_999) return null;
  if (!Number.isSafeInteger(input.qty) || (input.qty as number) < 0 || (input.qty as number) > STOCK_RECONCILE_QTY_LIMIT) return null;
  if (Object.keys(input).some((key) => !['row', 'qty', ...STOCK_KEY_FIELDS].includes(key))) return null;
  const raw: RawStockRow = { row: input.row as number, qty: String(input.qty) };
  for (const field of STOCK_KEY_FIELDS) {
    if (!Object.hasOwn(input, field)) continue;
    if (typeof input[field] !== 'string') return null;
    raw[field] = input[field] as string;
  }
  const normalized = normalizeStockRawRow(raw);
  return normalized.ok ? normalized.row : null;
}

/** RPC `admin_preview_stock_reconcile`의 행 형식. */
export function stockReconcileRowPayload(row: StockReconcileRow): Record<string, string | number> {
  return {
    row: row.row,
    qty: row.qty,
    ...Object.fromEntries(STOCK_KEY_FIELDS.flatMap((field) => row[field] ? [[field, row[field] as string]] : [])),
  };
}

function isEmptyRow(row: readonly string[] | undefined): boolean {
  return !row || row.every((cell) => normalizeErpText(cell, true) === '');
}

/** 처음 10행 안에서 별칭이 가장 많이 맞는 행을 머리글로 본다. 하나도 없으면 -1. */
export function detectStockHeaderRow(table: readonly (readonly string[])[]): number {
  let best = -1;
  let bestScore = 0;
  for (let index = 0; index < Math.min(table.length, STOCK_RECONCILE_HEADER_SCAN_ROWS); index += 1) {
    const score = table[index].filter((cell) => stockHeaderMatch(cell)).length;
    if (score > bestScore) { best = index; bestScore = score; }
  }
  return best;
}

/** 머리글로 기본 열 대상을 정한다. 같은 대상 후보가 여럿이면 우선 별칭·왼쪽 열을 고른다. */
export function defaultStockColumnMapping(header: readonly string[], columnCount = header.length): StockColumnTarget[] {
  const mapping: StockColumnTarget[] = Array.from({ length: columnCount }, () => 'ignore');
  const matches = header.map((cell, index) => ({ index, match: stockHeaderMatch(cell) }));
  for (const target of Object.keys(ALIASES) as HeaderMatch['target'][]) {
    const best = matches.filter((entry) => entry.match?.target === target)
      .sort((left, right) => left.match!.priority - right.match!.priority || left.index - right.index)[0];
    if (best) mapping[best.index] = target;
  }
  return mapping;
}

/** 미리보기 select 변경. 대상마다 한 열만 갖는다. */
export function assignStockColumnTarget(mapping: readonly StockColumnTarget[], index: number, target: StockColumnTarget): StockColumnTarget[] {
  return mapping.map((current, position) => {
    if (position === index) return target;
    if (target !== 'ignore' && current === target) return 'ignore';
    return current;
  });
}

function columnLetter(index: number): string {
  let label = '';
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) label = String.fromCharCode(65 + ((value - 1) % 26)) + label;
  return label;
}

export interface StockReconcileColumn { index: number; label: string; sample: string; target: StockColumnTarget }
export interface StockReconcilePlan {
  headerIndex: number;
  columns: StockReconcileColumn[];
  rows: StockReconcileRow[];
  issues: StockClientIssue[];
  dataRowCount: number;
  /** 코드·수량 칸이 모두 빈 행(합계·메모 행 등). 대조하지 않는다. */
  skippedRowCount: number;
  blocking: string | null;
  warnings: string[];
}

export interface StockReconcilePlanOptions {
  headerIndex?: number;
  mapping?: readonly StockColumnTarget[];
  /** 파일에서 숫자 셀이 있었던 열(0부터). 코드 열이면 선행 0 손실을 경고한다. */
  numericColumns?: readonly number[];
}

/** 표 → 미리보기 요청 계획. 머리글과 열 대상은 옵션으로 덮어쓸 수 있다. */
export function buildStockReconcilePlan(table: readonly (readonly string[])[], options: StockReconcilePlanOptions = {}): StockReconcilePlan {
  const columnCount = table.reduce((max, row) => Math.max(max, row.length), 0);
  const detected = detectStockHeaderRow(table);
  const headerIndex = options.headerIndex !== undefined && options.headerIndex >= -1
    && options.headerIndex < Math.min(table.length, STOCK_RECONCILE_HEADER_SCAN_ROWS) ? options.headerIndex : detected;
  const header = headerIndex >= 0 ? table[headerIndex] : [];
  const mapping: StockColumnTarget[] = options.mapping && options.mapping.length === columnCount
    ? [...options.mapping]
    : headerIndex >= 0 ? defaultStockColumnMapping(header, columnCount) : Array.from({ length: columnCount }, () => 'ignore');
  const dataStart = headerIndex + 1;
  const firstData = table.slice(dataStart).find((row) => !isEmptyRow(row)) ?? [];
  const columns = mapping.map((target, index) => ({
    index,
    label: normalizeErpText(header[index] ?? '', true) || `${columnLetter(index)}열`,
    sample: normalizeErpText(firstData[index] ?? '', true).slice(0, 80),
    target,
  }));
  const columnOf = (target: StockColumnTarget) => mapping.indexOf(target);
  const quantityColumn = columnOf('quantity');
  const keyColumns = STOCK_KEY_FIELDS.map((field) => [field, columnOf(field)] as const).filter(([, column]) => column >= 0);

  const warnings: string[] = [];
  if (headerIndex < 0 && table.length) warnings.push('머리글 행을 찾지 못했습니다. 열마다 가져올 항목을 골라주세요.');
  const numeric = new Set(options.numericColumns ?? []);
  for (const [field, column] of keyColumns) {
    if (field !== 'goodsCode' && numeric.has(column)) {
      warnings.push(`${STOCK_COLUMN_TARGET_LABELS[field]} 열에 숫자 형식 셀이 있습니다. 엑셀에서 앞자리 0이 빠졌을 수 있으니 원본과 비교해주세요.`);
    }
  }

  const rows: StockReconcileRow[] = [];
  const issues: StockClientIssue[] = [];
  let dataRowCount = 0;
  let skippedRowCount = 0;
  const blockingColumns = quantityColumn < 0 || !keyColumns.length;
  for (let index = dataStart; index < table.length; index += 1) {
    const cells = table[index];
    if (isEmptyRow(cells)) continue;
    dataRowCount += 1;
    if (blockingColumns) continue;
    const quantity = cells[quantityColumn] ?? '';
    const keyCells = keyColumns.map(([field, column]) => [field, cells[column] ?? ''] as const);
    if (keyCells.every(([, value]) => normalizeErpText(value, true) === '') && normalizeErpText(quantity, true) === '') {
      skippedRowCount += 1;
      continue;
    }
    const raw: RawStockRow = { row: index + 1, qty: quantity };
    for (const [field, value] of keyCells) raw[field] = value;
    const result = normalizeStockRawRow(raw);
    if (result.ok) rows.push(result.row);
    else issues.push(result.issue);
  }
  if (skippedRowCount) warnings.push(`코드와 수량이 모두 빈 ${skippedRowCount.toLocaleString('ko-KR')}행은 대조하지 않습니다.`);

  let blocking: string | null = null;
  if (quantityColumn < 0) blocking = '재고 수량 열을 골라야 대조할 수 있습니다.';
  else if (!keyColumns.length) blocking = '관리코드·ERP 코드(품번)·바코드·판매자상품코드 중 한 열 이상을 골라야 대조할 수 있습니다.';
  else if (rows.length > STOCK_RECONCILE_ROW_LIMIT) blocking = `한 번에 ${STOCK_RECONCILE_ROW_LIMIT.toLocaleString('ko-KR')}행까지 대조할 수 있습니다. 파일을 나누어 올려주세요.`;
  else if (!rows.length) blocking = dataRowCount ? '대조할 수 있는 행이 없습니다. 행별 사유를 확인해주세요.' : '대조할 행이 없습니다.';
  return { headerIndex, columns, rows, issues, dataRowCount, skippedRowCount, blocking, warnings };
}

export { boundErpTable as boundStockTable, parseErpDelimitedTable as parseStockDelimitedTable };

/* ---------------------------------------------------------------------------
 * 파일 기준 시각(KST). datetime-local 값('YYYY-MM-DDTHH:mm')과 ISO를 오간다.
 * ------------------------------------------------------------------------- */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
export function kstDateTimeLocalValue(date: Date): string {
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 16);
}
/** 'YYYY-MM-DDTHH:mm'(KST)을 ISO로. 형식이 틀리면 null. */
export function kstDateTimeLocalToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}:00+09:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
/** 기준 시각 검증(DB와 같은 범위: 7일 이내, 미래 5분 이내). 문제가 없으면 null. */
export function stockAsOfError(iso: string | null, now = new Date()): string | null {
  if (!iso) return '파일의 재고 기준 시각을 입력해주세요.';
  const time = Date.parse(iso);
  if (time > now.getTime() + 5 * 60 * 1000) return '재고 기준 시각은 지금보다 뒤일 수 없습니다.';
  if (time < now.getTime() - STOCK_RECONCILE_AS_OF_DAYS * 24 * 60 * 60 * 1000) return `${STOCK_RECONCILE_AS_OF_DAYS}일 안에 받은 재고 파일만 대조할 수 있습니다.`;
  return null;
}

/* ---------------------------------------------------------------------------
 * 화면 문서 (DB → 화면). 모르는 모양은 null로 막는다.
 * ------------------------------------------------------------------------- */
export type StockMatchKind = 'option_code' | 'erp_code' | 'barcode' | 'goods_code';
export type StockReconcileIssueReason = 'duplicate' | 'not_found' | 'conflict' | 'option_required' | 'other_origin' | 'goods_archived' | 'option_stopped';
export const STOCK_RECONCILE_ISSUE_LABELS: Record<StockReconcileIssueReason, string> = {
  duplicate: '같은 옵션을 가리키는 행이 둘 이상 — 위치별로 나뉜 파일이면 합계로 만든 뒤 올려주세요',
  not_found: '사이트에서 찾지 못함(코드·바코드 등록 확인)',
  conflict: '코드끼리 서로 다른 옵션·상품을 가리킴',
  option_required: '옵션이 여럿인 상품 — 관리코드·ERP 코드·바코드가 필요함',
  other_origin: '고른 출고지의 상품이 아님',
  goods_archived: '보관한 상품',
  option_stopped: '사용 중지한 옵션',
};
export const STOCK_MATCH_KIND_LABELS: Record<StockMatchKind, string> = {
  option_code: '관리코드', erp_code: 'ERP 코드', barcode: '바코드', goods_code: '판매자상품코드',
};

export interface StockReconcileItem {
  variantId: string; goodId: string; goodsCode: string; goodsName: string; optionName: string; optionCode: string;
  sourceRow: number; matchKind: StockMatchKind; fileQty: number; stockQty: number; pendingQty: number; shippedSinceQty: number;
  /** 기준 시각 뒤 창고로 돌아온 수량(클레임 회수, 회수 기록 없이 복원된 출고분). */
  returnedSinceQty: number;
  /** 회수했지만 아직 환불·교환 재출고 전이라 재고수량에 돌아오지 않은 수량. */
  awaitingReturnQty: number;
  /** 기준 시각 뒤 사람이 바꾼 재고(재고 조정·다른 대조 반영). 계산에 넣지 않고 표시만 한다. */
  adjustedSinceCount: number; adjustedSinceQty: number;
  difference: number; targetQty: number; appliedDelta: number | null; stockAfter: number | null; preorder: boolean;
  /**
   * 반영할 때 잠금 뒤 다시 잰 반영 시점 값(QA1 S-T07-01). 미리보기 값(stockQty·pendingQty 등)과 다를 수 있다 — 예: 미리보기 뒤
   * 출고된 주문은 출고 대기에서 기준 시각 뒤 출고로 옮겨 간다. 반영 전 미리보기와 이 값이 생기기 전 반영 기록은 null이다.
   */
  stockBefore: number | null; appliedPendingQty: number | null; appliedShippedSinceQty: number | null;
  appliedReturnedSinceQty: number | null; appliedAwaitingReturnQty: number | null;
}
export interface StockReconcileIssue { row: number; key: string; fileQty: number | null; reason: StockReconcileIssueReason }
export interface StockReconcileApplyResult { changed: number; increased: number; decreased: number; shortages: number; totalDelta: number }
export interface StockReconcileDocument {
  id: string; originId: string | null; originName: string | null; sourceLabel: string; asOf: string; createdAt: string; createdByName: string;
  rowCount: number; matchedCount: number; issueCount: number; changedCount: number;
  appliedAt: string | null; appliedByName: string | null; applyReason: string | null; applyResult: StockReconcileApplyResult | null;
  items: StockReconcileItem[]; issues: StockReconcileIssue[];
}
export type StockReconcileSummary = Omit<StockReconcileDocument, 'items' | 'issues' | 'originId' | 'applyReason'>;

type JsonRecord = Record<string, unknown>;
function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}
function int(value: unknown, { min = -Infinity }: { min?: number } = {}): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min ? value : null;
}
function text(value: unknown): string | null { return typeof value === 'string' ? value : null; }
function nullableText(value: unknown): string | null | undefined {
  return value === null || value === undefined ? null : typeof value === 'string' ? value : undefined;
}
function time(value: unknown): string | null { return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null; }
/** 없거나 null이면 null, 0 이상 정수면 그 값, 그 밖은 undefined(모르는 모양). */
function optionalCount(value: unknown): number | null | undefined {
  if (value === null || value === undefined) return null;
  return int(value, { min: 0 }) ?? undefined;
}

function parseApplyResult(value: unknown): StockReconcileApplyResult | null | undefined {
  if (value === null || value === undefined) return null;
  const row = record(value);
  if (!row) return undefined;
  const changed = int(row.changed, { min: 0 }); const increased = int(row.increased, { min: 0 });
  const decreased = int(row.decreased, { min: 0 }); const shortages = int(row.shortages, { min: 0 }); const totalDelta = int(row.totalDelta);
  if (changed === null || increased === null || decreased === null || shortages === null || totalDelta === null) return undefined;
  return { changed, increased, decreased, shortages, totalDelta };
}

function parseItem(value: unknown): StockReconcileItem | null {
  const row = record(value);
  if (!row) return null;
  const variantId = text(row.variantId); const goodId = text(row.goodId); const goodsCode = text(row.goodsCode);
  const goodsName = text(row.goodsName); const optionName = text(row.optionName); const optionCode = text(row.optionCode);
  const sourceRow = int(row.sourceRow, { min: 1 }); const matchKind = text(row.matchKind) as StockMatchKind | null;
  const fileQty = int(row.fileQty, { min: 0 }); const stockQty = int(row.stockQty, { min: 0 });
  const pendingQty = int(row.pendingQty, { min: 0 }); const shippedSinceQty = int(row.shippedSinceQty, { min: 0 });
  const returnedSinceQty = int(row.returnedSinceQty, { min: 0 }); const awaitingReturnQty = int(row.awaitingReturnQty, { min: 0 });
  const adjustedSinceCount = int(row.adjustedSinceCount, { min: 0 }); const adjustedSinceQty = int(row.adjustedSinceQty);
  const difference = int(row.difference); const targetQty = int(row.targetQty, { min: 0 });
  const appliedDelta = row.appliedDelta === null ? null : int(row.appliedDelta);
  const stockAfter = row.stockAfter === null ? null : int(row.stockAfter, { min: 0 });
  const stockBefore = optionalCount(row.stockBefore); const appliedPendingQty = optionalCount(row.appliedPendingQty);
  const appliedShippedSinceQty = optionalCount(row.appliedShippedSinceQty); const appliedReturnedSinceQty = optionalCount(row.appliedReturnedSinceQty);
  const appliedAwaitingReturnQty = optionalCount(row.appliedAwaitingReturnQty);
  if (!variantId || !isUuid(variantId) || goodId === null || goodsCode === null || goodsName === null || optionName === null || optionCode === null
    || sourceRow === null || !matchKind || !Object.hasOwn(STOCK_MATCH_KIND_LABELS, matchKind) || fileQty === null || stockQty === null
    || pendingQty === null || shippedSinceQty === null || returnedSinceQty === null || awaitingReturnQty === null
    || adjustedSinceCount === null || adjustedSinceQty === null || difference === null || targetQty === null
    || (row.appliedDelta !== null && appliedDelta === null) || (row.stockAfter !== null && stockAfter === null) || typeof row.preorder !== 'boolean'
    || stockBefore === undefined || appliedPendingQty === undefined || appliedShippedSinceQty === undefined
    || appliedReturnedSinceQty === undefined || appliedAwaitingReturnQty === undefined
    /* 반영 시점 값은 다섯 칸이 함께 있거나 함께 없다(DB 제약과 같다). */
    || [appliedPendingQty, appliedShippedSinceQty, appliedReturnedSinceQty, appliedAwaitingReturnQty].some((value) => (value === null) !== (stockBefore === null))) return null;
  return { variantId, goodId, goodsCode, goodsName, optionName, optionCode, sourceRow, matchKind, fileQty, stockQty, pendingQty,
    shippedSinceQty, returnedSinceQty, awaitingReturnQty, adjustedSinceCount, adjustedSinceQty, difference, targetQty, appliedDelta,
    stockAfter, preorder: row.preorder, stockBefore, appliedPendingQty, appliedShippedSinceQty, appliedReturnedSinceQty, appliedAwaitingReturnQty };
}

/**
 * 결과 표에 그릴 값. 반영한 기록은 반영 시점 값(반영 전 재고수량·출고 대기 등)과 실제 반영 뒤 재고수량을 쓴다(QA1 S-T07-01) —
 * 미리보기 뒤 출고·주문이 끼어도 표의 칸끼리 계산이 맞는다. 반영 시점 값이 없는 옛 기록과 반영 전 미리보기는 그대로다.
 * 반영할 것이 없던 옵션은 반영 뒤에도 반영 전 재고수량 그대로다.
 */
export function stockReconcileDisplayItem(item: StockReconcileItem, applied: boolean): StockReconcileItem {
  if (!applied || item.stockBefore === null) return item;
  return {
    ...item,
    stockQty: item.stockBefore,
    pendingQty: item.appliedPendingQty ?? item.pendingQty,
    shippedSinceQty: item.appliedShippedSinceQty ?? item.shippedSinceQty,
    returnedSinceQty: item.appliedReturnedSinceQty ?? item.returnedSinceQty,
    awaitingReturnQty: item.appliedAwaitingReturnQty ?? item.awaitingReturnQty,
    targetQty: item.stockAfter ?? item.stockBefore,
  };
}

function parseIssue(value: unknown): StockReconcileIssue | null {
  const row = record(value);
  if (!row) return null;
  const sourceRow = int(row.row, { min: 1 }); const reason = text(row.reason) as StockReconcileIssueReason | null;
  if (sourceRow === null || !reason || !Object.hasOwn(STOCK_RECONCILE_ISSUE_LABELS, reason)) return null;
  return { row: sourceRow, key: text(row.key) ?? '', fileQty: int(row.fileQty, { min: 0 }), reason };
}

function parseSummaryFields(row: JsonRecord) {
  const id = text(row.id); const sourceLabel = text(row.sourceLabel); const asOf = time(row.asOf); const createdAt = time(row.createdAt);
  const originName = nullableText(row.originName); const appliedByName = nullableText(row.appliedByName);
  const rowCount = int(row.rowCount, { min: 0 }); const matchedCount = int(row.matchedCount, { min: 0 });
  const issueCount = int(row.issueCount, { min: 0 }); const changedCount = int(row.changedCount, { min: 0 });
  const appliedAt = row.appliedAt === null ? null : time(row.appliedAt); const applyResult = parseApplyResult(row.applyResult);
  if (!id || !isUuid(id) || sourceLabel === null || !asOf || !createdAt || originName === undefined || appliedByName === undefined
    || rowCount === null || matchedCount === null || issueCount === null || changedCount === null
    || (row.appliedAt !== null && appliedAt === null) || applyResult === undefined) return null;
  return { id, sourceLabel, asOf, createdAt, createdByName: text(row.createdByName) ?? '', originName, rowCount, matchedCount, issueCount,
    changedCount, appliedAt, appliedByName, applyResult };
}

export function parseStockReconcileDocument(value: unknown): StockReconcileDocument | null {
  const row = record(value);
  if (!row || !Array.isArray(row.items) || !Array.isArray(row.issues)) return null;
  const summary = parseSummaryFields(row);
  const originId = row.originId === null ? null : text(row.originId);
  const applyReason = nullableText(row.applyReason);
  if (!summary || (row.originId !== null && (!originId || !isUuid(originId))) || applyReason === undefined) return null;
  const items = row.items.map(parseItem);
  const issues = row.issues.map(parseIssue);
  if (items.some((item) => !item) || issues.some((issue) => !issue)) return null;
  return { ...summary, originId, applyReason, items: items as StockReconcileItem[], issues: issues as StockReconcileIssue[] };
}

export function parseStockReconcileSummaries(value: unknown): StockReconcileSummary[] | null {
  if (!Array.isArray(value)) return null;
  const rows = value.map((entry) => { const row = record(entry); return row ? parseSummaryFields(row) : null; });
  return rows.some((entry) => !entry) ? null : rows as StockReconcileSummary[];
}

/**
 * 반영을 거절한 이유(QA1 S-T07-01). DB `admin_apply_stock_reconcile`이 잠금 뒤 다시 잰 값으로 정한다.
 * 출고 대기 변동: 미리보기 뒤 주문·취소·출고·회수로 맞춘 뒤 재고수량이 달라짐. 재고 변동: 재고 조정·다른 대조로 재고수량을 직접 바꿈.
 */
export type StockReconcileConflictReason = 'pending_changed' | 'stock_changed' | 'pending_and_stock_changed' | 'goods_archived' | 'option_stopped';
export const STOCK_RECONCILE_CONFLICT_REASON_LABELS: Record<StockReconcileConflictReason, string> = {
  pending_changed: '출고 대기 변동 — 미리보기 뒤 주문·취소·출고·회수가 있었습니다',
  stock_changed: '재고 변동 — 미리보기 뒤 재고 조정이나 다른 대조로 재고수량을 바꿨습니다',
  pending_and_stock_changed: '출고 대기·재고 변동 — 주문·출고와 재고 조정이 함께 있었습니다',
  goods_archived: '상품을 보관함',
  option_stopped: '옵션을 사용 중지함',
};
export interface StockReconcileConflict {
  variantId: string; goodsName: string; optionName: string; optionCode: string;
  /** 미리보기 때와 지금(잠금 뒤 다시 잰) 재고수량·출고 대기·맞춘 뒤 재고수량·차이. */
  previewStockQty: number; currentStockQty: number; previewPendingQty: number; currentPendingQty: number;
  previewTargetQty: number; currentTargetQty: number; previewDifference: number; currentDifference: number;
  reason: StockReconcileConflictReason;
}
export type StockReconcileApplyOutcome =
  | { status: 'applied'; replayed: boolean; snapshot: StockReconcileDocument }
  | { status: 'conflict'; conflicts: StockReconcileConflict[] };

export function parseStockReconcileApplyOutcome(value: unknown): StockReconcileApplyOutcome | null {
  const row = record(value);
  if (!row) return null;
  if (row.status === 'applied') {
    const snapshot = parseStockReconcileDocument(row.snapshot);
    return snapshot && typeof row.replayed === 'boolean' ? { status: 'applied', replayed: row.replayed, snapshot } : null;
  }
  if (row.status !== 'conflict' || !Array.isArray(row.conflicts)) return null;
  const conflicts: StockReconcileConflict[] = [];
  for (const entry of row.conflicts) {
    const item = record(entry);
    const variantId = text(item?.variantId); const reason = text(item?.reason);
    const counts = ['previewStockQty', 'currentStockQty', 'previewPendingQty', 'currentPendingQty', 'previewTargetQty', 'currentTargetQty']
      .map((key) => int(item?.[key], { min: 0 }));
    const previewDifference = int(item?.previewDifference); const currentDifference = int(item?.currentDifference);
    if (!item || !variantId || counts.some((count) => count === null) || previewDifference === null || currentDifference === null
      || !reason || !Object.hasOwn(STOCK_RECONCILE_CONFLICT_REASON_LABELS, reason)) return null;
    const [previewStockQty, currentStockQty, previewPendingQty, currentPendingQty, previewTargetQty, currentTargetQty] = counts as number[];
    conflicts.push({ variantId, goodsName: text(item.goodsName) ?? '', optionName: text(item.optionName) ?? '', optionCode: text(item.optionCode) ?? '',
      previewStockQty, currentStockQty, previewPendingQty, currentPendingQty, previewTargetQty, currentTargetQty, previewDifference, currentDifference,
      reason: reason as StockReconcileConflictReason });
  }
  return { status: 'conflict', conflicts };
}

/* ---------------------------------------------------------------------------
 * 행 상태(표시용)
 * ------------------------------------------------------------------------- */
export type StockReconcileRowState = 'same' | 'increase' | 'decrease' | 'shortage';
/** 반영 전에는 미리보기 값, 반영 뒤에는 실제 반영 값(stockReconcileDisplayItem)으로 판정한다. 부족은 지금 창고 실물보다 출고 대기(와 회수 뒤 미반영)가 많은 것이다. */
export function stockReconcileRowState(item: Pick<StockReconcileItem, 'stockQty' | 'difference' | 'targetQty'>): StockReconcileRowState {
  if (item.stockQty + item.difference < 0) return 'shortage';
  if (item.targetQty > item.stockQty) return 'increase';
  if (item.targetQty < item.stockQty) return 'decrease';
  return 'same';
}
export const STOCK_RECONCILE_ROW_STATE_LABELS: Record<StockReconcileRowState, string> = {
  same: '같음', increase: '늘림', decrease: '줄임', shortage: '부족',
};
export function stockReconcileShortage(item: Pick<StockReconcileItem, 'stockQty' | 'difference'>): number {
  return Math.max(0, -(item.stockQty + item.difference));
}

export function defaultStockReconcileReason(label: string): string {
  return `재고 파일 대조 · ${label}`.slice(0, STOCK_RECONCILE_REASON_LIMIT);
}

/* ---------------------------------------------------------------------------
 * 출고지시 전 경고 (admin_stock_dispatch_warnings)
 * ------------------------------------------------------------------------- */
export interface StockDispatchWarning {
  variantId: string; goodsName: string; goodsCode: string; optionName: string; optionCode: string;
  kind: 'shortage' | 'mismatch'; asOf: string; fileQty: number; stockQty: number; pendingQty: number; shippedSinceQty: number;
  returnedSinceQty: number; awaitingReturnQty: number;
  /** 창고 예상 수량 = 파일 − 기준 시각 뒤 출고 + 기준 시각 뒤 회수 − 회수 뒤 재고 미반영. */
  expectedQty: number; difference: number; shortageQty: number;
}
export interface StockDispatchUnreconciled { variantId: string; goodsName: string; optionName: string; optionCode: string; pendingQty: number }
export interface StockDispatchWarnings {
  originId: string | null; checkedAt: string; batchVariantCount: number; latestAsOf: string | null;
  warnings: StockDispatchWarning[]; unreconciledCount: number; unreconciled: StockDispatchUnreconciled[];
}

/** 경고 목록의 옵션 표시 이름. 기본 옵션 하나뿐인 상품은 상품 이름만 쓴다. */
export const stockWarningName = (row: { goodsName: string; optionName: string }) =>
  row.optionName && row.optionName !== '기본 옵션' ? `${row.goodsName} / ${row.optionName}` : row.goodsName;

/**
 * 출고지시 내려받기 확인 단계에서 다시 알릴 재고 부족 요약(1007-011, QA 라운드 1 m9). 부족(창고 예상 < 출고 대기)만 세고,
 * 이름은 앞에서 몇 개만 보인다. 부족이 없거나 경고를 불러오지 못했으면 null이다.
 */
export function stockShortageSummary(data: StockDispatchWarnings | null, limit = 5): { count: number; names: string[] } | null {
  const shortages = data?.warnings.filter((warning) => warning.kind === 'shortage') ?? [];
  if (!shortages.length) return null;
  return { count: shortages.length, names: shortages.slice(0, limit).map((warning) => Number.isSafeInteger(warning.shortageQty)
    ? `${stockWarningName(warning)} (부족 ${warning.shortageQty.toLocaleString('ko-KR')})` : stockWarningName(warning)) };
}

export function parseStockDispatchWarnings(value: unknown): StockDispatchWarnings | null {
  const row = record(value);
  if (!row || !Array.isArray(row.warnings) || !Array.isArray(row.unreconciled)) return null;
  const checkedAt = time(row.checkedAt); const batchVariantCount = int(row.batchVariantCount, { min: 0 });
  const unreconciledCount = int(row.unreconciledCount, { min: 0 });
  const latestAsOf = row.latestAsOf === null ? null : time(row.latestAsOf);
  const originId = row.originId === null ? null : text(row.originId);
  if (!checkedAt || batchVariantCount === null || unreconciledCount === null || (row.latestAsOf !== null && !latestAsOf)
    || (row.originId !== null && !originId)) return null;
  const warnings: StockDispatchWarning[] = [];
  for (const entry of row.warnings) {
    const item = record(entry);
    if (!item) return null;
    const numbers = ['fileQty', 'stockQty', 'pendingQty', 'shippedSinceQty', 'returnedSinceQty', 'awaitingReturnQty', 'expectedQty', 'difference',
      'shortageQty'].map((key) => int(item[key]));
    const variantId = text(item.variantId); const asOf = time(item.asOf);
    if (!variantId || !asOf || numbers.some((number) => number === null) || (item.kind !== 'shortage' && item.kind !== 'mismatch')) return null;
    const [fileQty, stockQty, pendingQty, shippedSinceQty, returnedSinceQty, awaitingReturnQty, expectedQty, difference, shortageQty] = numbers as number[];
    warnings.push({ variantId, goodsName: text(item.goodsName) ?? '', goodsCode: text(item.goodsCode) ?? '', optionName: text(item.optionName) ?? '',
      optionCode: text(item.optionCode) ?? '', kind: item.kind, asOf, fileQty, stockQty, pendingQty, shippedSinceQty, returnedSinceQty,
      awaitingReturnQty, expectedQty, difference, shortageQty });
  }
  const unreconciled: StockDispatchUnreconciled[] = [];
  for (const entry of row.unreconciled) {
    const item = record(entry);
    const variantId = text(item?.variantId); const pendingQty = int(item?.pendingQty, { min: 0 });
    if (!item || !variantId || pendingQty === null) return null;
    unreconciled.push({ variantId, goodsName: text(item.goodsName) ?? '', optionName: text(item.optionName) ?? '', optionCode: text(item.optionCode) ?? '', pendingQty });
  }
  return { originId, checkedAt, batchVariantCount, latestAsOf, warnings, unreconciledCount, unreconciled };
}

/** 운영 화면 오류 문구. DB 메시지(영문 코드)를 그대로 보이지 않는다. */
export function stockReconcileErrorMessage(error: { code?: unknown; message?: unknown } | null | undefined): string {
  const code = typeof error?.code === 'string' ? error.code : '';
  const message = typeof error?.message === 'string' ? error.message : '';
  if (code === '42501' || code === '28000' || message.includes('operator_capability_required')) return '재고를 대조할 권한이 없습니다.';
  if (message.includes('stock_reconcile_already_applied')) return '이미 반영한 미리보기입니다. 대조 기록에서 결과를 확인해주세요.';
  if (message.includes('stock_reconcile_preview_mismatch')) return '화면의 미리보기와 저장된 미리보기가 다릅니다. 다시 미리보기 해주세요.';
  if (message.includes('stock_reconcile_expired')) return '24시간이 지난 미리보기는 반영할 수 없습니다. 파일을 다시 올려 미리보기 해주세요.';
  if (message.includes('stock_reconcile_not_found')) return '미리보기를 찾지 못했습니다. 다시 미리보기 해주세요.';
  if (message.includes('invalid_stock_reconcile_as_of')) return `재고 기준 시각은 지금부터 ${STOCK_RECONCILE_AS_OF_DAYS}일 안이어야 합니다.`;
  if (message.includes('invalid_stock_reconcile_reason')) return '반영 사유를 200자 이내로 입력해주세요.';
  if (message.includes('fulfillment_origin_not_found')) return '고른 출고지를 찾지 못했습니다. 새로고침한 뒤 다시 골라주세요.';
  if (message.includes('invalid_stock_reconcile')) return '대조할 행을 확인한 뒤 다시 시도해주세요.';
  return '재고 대조를 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';
}
