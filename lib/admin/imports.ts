/*
 * D-4b 업로드 파서 — 헤더를 읽어 열 위치를 정한다.
 *
 * 창고가 발주서를 그대로 되돌려 올릴 수 있어야 한다. 그래서 열 순서를 고정으로 보지 않고
 * 헤더 이름으로 찾는다 — 발주서에는 송장 말고도 열이 많고, 사람이 열을 옮기거나 지우기도 한다.
 * 송장 칸이 빈 줄은 「아직 안 보낸 줄」이라 오류가 아니라 건너뛴다.
 */

export const IMPORT_KINDS = [
  { value: 'tracking', label: '송장 회신 (발주서 되돌리기)' },
  { value: 'stock_set', label: '재고 수량 맞추기 (절대값)' },
] as const;

export type ImportKind = (typeof IMPORT_KINDS)[number]['value'];

export const IMPORT_ROW_LIMIT = 1000;

/** 열 이름 후보. 왼쪽이 우리 양식의 이름이고 나머지는 실무에서 흔한 표기다. */
const COLUMN_ALIASES: Record<ImportKind, Record<string, readonly string[]>> = {
  tracking: {
    order_ref: ['주문번호', '주문 번호', 'order_no', 'orderno'],
    carrier: ['택배사', '택배사코드', 'carrier'],
    tracking: ['송장번호', '운송장번호', '운송장', 'tracking', 'invoice'],
  },
  stock_set: {
    ref: ['자체 품목코드', '품목코드', '자체품목코드', '상품코드', 'ref', 'sku'],
    location_id: ['출고지', '출고지코드', '창고', 'location'],
    on_hand_qty: ['보유수량', '재고', '재고수량', '수량', 'qty', 'stock'],
    safety_qty: ['안전재고', 'safety'],
  },
};

export interface ImportIssue {
  line: number;
  code: string;
  message: string;
}

export interface ImportParseResult {
  rows: Record<string, unknown>[];
  issues: ImportIssue[];
  /** 헤더에서 찾은 열 → 원본 열 번호. 화면이 「무엇을 어디서 읽었는지」 보여준다. */
  mapping: Record<string, number>;
  skipped: number;
}

const IMPORT_ISSUE_MESSAGES: Record<string, string> = {
  header_missing: '필요한 열을 헤더에서 찾지 못했습니다.',
  row_limit: `한 번에 ${IMPORT_ROW_LIMIT}줄까지 올릴 수 있습니다.`,
  missing_cell: '빈 칸이 있습니다.',
  invalid_qty: '수량은 0 이상의 정수여야 합니다.',
  invalid_tracking: '송장번호는 영문·숫자·하이픈 6~40자여야 합니다.',
};

function normalizeHeader(value: string) {
  return value.replace(/^﻿/, '').replace(/\s+/g, '').toLowerCase();
}

/** CSV 한 줄을 칸으로 쪼갠다. 따옴표 안의 쉼표와 두 번 쓴 따옴표를 지킨다(RFC 4180). */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',' || char === '\t') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

/** 내보내기가 쓴 `="0123"` 셀을 되읽는다 — 우편번호·코드가 그대로 돌아오게. */
export function unwrapTextCell(value: string) {
  const match = /^="(.*)"$/.exec(value);
  return match ? match[1].replace(/""/g, '"') : value;
}

function findColumns(header: readonly string[], kind: ImportKind) {
  const normalized = header.map(normalizeHeader);
  const mapping: Record<string, number> = {};
  for (const [key, aliases] of Object.entries(COLUMN_ALIASES[kind])) {
    const index = normalized.findIndex((cell) => aliases.some((alias) => normalizeHeader(alias) === cell));
    if (index >= 0) mapping[key] = index;
  }
  return mapping;
}

const REQUIRED_COLUMNS: Record<ImportKind, readonly string[]> = {
  tracking: ['order_ref', 'carrier', 'tracking'],
  stock_set: ['ref', 'on_hand_qty'],
};

/** 표(헤더 1행 + 데이터)를 종류에 맞는 행 배열로. 셀은 이미 문자열로 정규화돼 있어야 한다. */
export function parseImportTable(table: readonly (readonly string[])[], kind: ImportKind): ImportParseResult {
  const issues: ImportIssue[] = [];
  const rows: Record<string, unknown>[] = [];
  let skipped = 0;

  const header = table[0] ?? [];
  const mapping = findColumns(header, kind);
  const missing = REQUIRED_COLUMNS[kind].filter((key) => mapping[key] === undefined);
  if (missing.length > 0) {
    return {
      rows: [],
      issues: [{ line: 1, code: 'header_missing', message: `${IMPORT_ISSUE_MESSAGES.header_missing} (${missing.join(', ')})` }],
      mapping,
      skipped: 0,
    };
  }

  const cellAt = (cells: readonly string[], key: string) => {
    const index = mapping[key];
    return index === undefined ? '' : unwrapTextCell((cells[index] ?? '').trim());
  };

  for (let index = 1; index < table.length; index += 1) {
    const cells = table[index];
    const line = index + 1;
    if (cells.every((cell) => cell.trim() === '')) continue;
    if (rows.length >= IMPORT_ROW_LIMIT) {
      issues.push({ line, code: 'row_limit', message: IMPORT_ISSUE_MESSAGES.row_limit });
      break;
    }

    if (kind === 'tracking') {
      const tracking = cellAt(cells, 'tracking');
      /* 송장 칸이 빈 줄은 아직 안 보낸 줄이다 — 발주서를 그대로 되돌려 올려도 통과해야 한다. */
      if (!tracking) {
        skipped += 1;
        continue;
      }
      const orderRef = cellAt(cells, 'order_ref');
      const carrier = cellAt(cells, 'carrier');
      if (!orderRef || !carrier) {
        issues.push({ line, code: 'missing_cell', message: IMPORT_ISSUE_MESSAGES.missing_cell });
        continue;
      }
      if (!/^[0-9A-Za-z-]{6,40}$/.test(tracking)) {
        issues.push({ line, code: 'invalid_tracking', message: IMPORT_ISSUE_MESSAGES.invalid_tracking });
        continue;
      }
      rows.push({ order_ref: orderRef, carrier, tracking, line });
      continue;
    }

    const ref = cellAt(cells, 'ref');
    const rawQty = cellAt(cells, 'on_hand_qty').replace(/,/g, '');
    if (!ref) {
      issues.push({ line, code: 'missing_cell', message: IMPORT_ISSUE_MESSAGES.missing_cell });
      continue;
    }
    if (!/^\d+$/.test(rawQty)) {
      issues.push({ line, code: 'invalid_qty', message: IMPORT_ISSUE_MESSAGES.invalid_qty });
      continue;
    }
    const row: Record<string, unknown> = { ref, on_hand_qty: Number(rawQty), line };
    const location = cellAt(cells, 'location_id');
    if (location) row.location_id = location;
    const safety = cellAt(cells, 'safety_qty').replace(/,/g, '');
    if (/^\d+$/.test(safety)) row.safety_qty = Number(safety);
    rows.push(row);
  }

  return { rows, issues, mapping, skipped };
}

/** CSV·TSV 텍스트를 표로. BOM 과 CRLF 를 걷어낸다. */
export function parseDelimitedText(text: string): string[][] {
  return text
    .replace(/^﻿/, '')
    .split(/\r\n|\r|\n/)
    .map((line) => splitCsvLine(line));
}

/** 서버가 돌려준 행별 코드에 사람 문장을 붙인다. */
export const IMPORT_REPORT_LABELS: Record<string, string> = {
  ref_missing: '품목 참조가 비었습니다',
  variant_not_found: '품목을 찾지 못했습니다',
  variant_ambiguous: '품목이 여러 개입니다 — 품목코드로 지정하세요',
  invalid_qty: '수량이 올바르지 않습니다',
  missing_cell: '빈 칸이 있습니다',
  invalid_tracking: '송장번호 형식이 올바르지 않습니다',
  order_not_found: '주문을 찾지 못했습니다',
  carrier_not_found: '택배사를 찾지 못했습니다',
  duplicate_order: '같은 주문에 송장이 두 번 적혔습니다',
};
