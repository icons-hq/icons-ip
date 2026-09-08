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
  { value: 'goods_upsert', label: '굿즈 일괄 등록·수정' },
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
  goods_upsert: {
    good_id: ['굿즈코드', '상품코드', '상품 코드', 'good_id', 'id'],
    custom_code: ['자체 굿즈코드', '자체 상품코드', '자체상품코드', 'custom_code'],
    ip_id: ['ip코드', 'ip 코드', 'ip_id'],
    name: ['굿즈명', '상품명', 'name'],
    type: ['분류', '굿즈분류', '상품분류', 'type'],
    price: ['판매가', '판매 가격', 'price'],
    compare_at_price: ['정가', '소비자가', 'compare_at_price'],
    supply_price: ['공급가', '공급가액', 'supply_price'],
    tax_type: ['과세구분', '과세 구분', 'tax_type'],
    sale_mode: ['판매유형', '판매 유형', 'sale_mode'],
    sale_starts_at: ['판매시작', '판매 시작', '판매시작일시', 'sale_starts_at'],
    sale_ends_at: ['판매종료', '판매 종료', '판매종료일시', 'sale_ends_at'],
    preorder_ships_at: ['출고예정일', '출고 예정일', 'preorder_ships_at'],
    summary: ['요약', '요약설명', 'summary'],
    search_keywords: ['검색어', '검색 키워드', 'search_keywords'],
    default_location_id: ['기본 출고지', '기본출고지', 'default_location_id'],
    badge: ['배지', '뱃지', 'badge'],
    allow_bank_transfer: ['무통장입금', '무통장 입금', 'allow_bank_transfer'],
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
  invalid_price: '금액은 0 이상의 정수여야 합니다.',
  invalid_type: '분류가 목록에 없습니다.',
  invalid_tax_type: '과세구분은 과세·면세·영세 중 하나여야 합니다.',
  invalid_sale_mode: '판매유형은 일반·예약 중 하나여야 합니다.',
  invalid_date: '날짜는 YYYY-MM-DD 또는 YYYY-MM-DD HH:MM 형식이어야 합니다.',
  invalid_flag: 'Y 또는 N 으로 적어 주세요.',
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
  /* 상품코드 하나만 있으면 된다 — 나머지는 「파일에 있는 열만 바꾼다」에 따라 있는 만큼만 반영한다. */
  goods_upsert: ['good_id'],
};

const GOODS_TYPES = ['피규어', '인형', '키링', '아크릴', '문구', '쿠션', '파우치', '세트'] as const;
const TAX_TYPES: Record<string, string> = {
  과세: 'taxable', 면세: 'exempt', 영세: 'zero_rated',
  taxable: 'taxable', exempt: 'exempt', zero_rated: 'zero_rated',
};
const SALE_MODES: Record<string, string> = {
  일반: 'regular', 예약: 'preorder', 예약판매: 'preorder', regular: 'regular', preorder: 'preorder',
};
const TRUE_WORDS = new Set(['y', 'yes', 'o', 'true', '1', '예', '허용', '사용']);
const FALSE_WORDS = new Set(['n', 'no', 'x', 'false', '0', '아니오', '미허용', '미사용']);

/** 정수 금액. 자릿점·통화 기호는 걷어낸다(엑셀에서 서식 붙은 채로 오는 일이 잦다). */
function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[,\s₩원]/g, '');
  return /^\d+$/.test(cleaned) ? Number(cleaned) : null;
}

/**
 * `YYYY-MM-DD` 또는 `YYYY-MM-DD HH:MM` 을 KST 로 읽어 ISO 로 되돌린다.
 * 표에 적힌 시각은 사람이 서울에서 읽는 시각이지 UTC 가 아니다 — 여기서 못 박지 않으면
 * 판매 시작이 9시간 어긋난다.
 */
function parseSeoulDateTime(raw: string): string | null {
  const match = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(raw.trim());
  if (!match) return null;
  const [, y, m, d, hh = '0', mm = '0'] = match;
  const pad = (value: string) => value.padStart(2, '0');
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12 || day < 1 || day > 31 || Number(hh) > 23 || Number(mm) > 59) return null;
  return `${y}-${pad(m)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00+09:00`;
}

function parseYmd(raw: string): string | null {
  const iso = parseSeoulDateTime(raw);
  return iso ? iso.slice(0, 10) : null;
}

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

    if (kind === 'goods_upsert') {
      const goodId = cellAt(cells, 'good_id');
      if (!goodId) {
        issues.push({ line, code: 'missing_cell', message: IMPORT_ISSUE_MESSAGES.missing_cell });
        continue;
      }
      const row = buildGoodsRow(cells, mapping, cellAt);
      if (typeof row === 'string') {
        issues.push({ line, code: row, message: IMPORT_ISSUE_MESSAGES[row] ?? row });
        continue;
      }
      rows.push({ ...row, good_id: goodId, line });
      continue;
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

type CellReader = (cells: readonly string[], key: string) => string;

/**
 * 헤더에 있는 열만 담는다 — 없는 열은 키 자체를 만들지 않아 서버가 「손대지 않음」으로 읽는다.
 * 빈 칸의 뜻은 열마다 다르다: 비울 수 있는 열은 비우고(null), 비울 수 없는 열은 오류다.
 */
function buildGoodsRow(
  cells: readonly string[],
  mapping: Record<string, number>,
  cellAt: CellReader,
): Record<string, unknown> | string {
  const row: Record<string, unknown> = {};
  const has = (key: string) => mapping[key] !== undefined;
  const value = (key: string) => cellAt(cells, key);

  for (const key of ['name', 'type', 'ip_id'] as const) {
    if (!has(key)) continue;
    const cell = value(key);
    if (!cell) return 'missing_cell';
    if (key === 'type' && !GOODS_TYPES.includes(cell as (typeof GOODS_TYPES)[number])) return 'invalid_type';
    row[key] = cell;
  }

  if (has('price')) {
    const cell = value('price');
    if (!cell) return 'missing_cell';
    const amount = parseAmount(cell);
    if (amount === null) return 'invalid_price';
    row.price = amount;
  }

  for (const key of ['compare_at_price', 'supply_price'] as const) {
    if (!has(key)) continue;
    const cell = value(key);
    if (!cell) {
      row[key] = null;
      continue;
    }
    const amount = parseAmount(cell);
    if (amount === null) return 'invalid_price';
    row[key] = amount;
  }

  /* 값이 비어 있으면 「손대지 않음」인 열들 — 비울 수 없는 칸이라 지우기라는 뜻이 될 수 없다. */
  if (has('tax_type') && value('tax_type')) {
    const code = TAX_TYPES[value('tax_type').toLowerCase()] ?? TAX_TYPES[value('tax_type')];
    if (!code) return 'invalid_tax_type';
    row.tax_type = code;
  }
  if (has('sale_mode') && value('sale_mode')) {
    const code = SALE_MODES[value('sale_mode').toLowerCase()] ?? SALE_MODES[value('sale_mode')];
    if (!code) return 'invalid_sale_mode';
    row.sale_mode = code;
  }
  if (has('default_location_id') && value('default_location_id')) {
    row.default_location_id = value('default_location_id');
  }
  if (has('allow_bank_transfer') && value('allow_bank_transfer')) {
    const cell = value('allow_bank_transfer').toLowerCase();
    if (TRUE_WORDS.has(cell)) row.allow_bank_transfer = true;
    else if (FALSE_WORDS.has(cell)) row.allow_bank_transfer = false;
    else return 'invalid_flag';
  }

  /* 비우면 지우는 열들. 다운로드 받은 파일에서 칸을 지우는 건 「이 값을 없앤다」는 뜻이다. */
  for (const key of ['custom_code', 'badge', 'summary'] as const) {
    if (has(key)) row[key] = value(key) || null;
  }
  if (has('search_keywords')) {
    row.search_keywords = value('search_keywords')
      .split(/[,;]/)
      .map((word) => word.trim())
      .filter(Boolean);
  }
  for (const key of ['sale_starts_at', 'sale_ends_at'] as const) {
    if (!has(key)) continue;
    const cell = value(key);
    if (!cell) {
      row[key] = null;
      continue;
    }
    const iso = parseSeoulDateTime(cell);
    if (!iso) return 'invalid_date';
    row[key] = iso;
  }
  if (has('preorder_ships_at')) {
    const cell = value('preorder_ships_at');
    if (!cell) row.preorder_ships_at = null;
    else {
      const ymd = parseYmd(cell);
      if (!ymd) return 'invalid_date';
      row.preorder_ships_at = ymd;
    }
  }

  return row;
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
  good_incomplete: '새 굿즈는 IP코드·굿즈명·분류·판매가가 모두 있어야 합니다',
  duplicate_good: '같은 굿즈코드가 두 번 적혔습니다',
  ip_not_found: 'IP를 찾지 못했습니다',
  invalid_type: '분류가 목록에 없습니다',
  invalid_price: '금액이 올바르지 않습니다',
  compare_at_price_invalid: '소비자가는 판매가보다 커야 합니다',
  invalid_tax_type: '과세구분이 올바르지 않습니다',
  invalid_badge: '배지는 NEW 또는 EXCLUSIVE 만 됩니다',
  location_not_found: '출고지를 찾지 못했습니다',
  custom_code_taken: '자체 굿즈코드가 다른 굿즈에 이미 있습니다',
  invalid_sale_window: '판매 종료가 시작보다 빠릅니다',
  preorder_ships_required: '예약판매는 출고예정일이 있어야 합니다',
  invalid_date: '날짜 형식이 올바르지 않습니다',
  invalid_flag: 'Y 또는 N 으로 적어 주세요',
};
