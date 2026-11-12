import type { OrderClaimType } from '@/lib/orders/claims';

/*
 * 반품입고 회신 업로드(QNA-034·ADR-0034). 서원 반품입고 파일 양식이 오기 전이라 열 이름 대응표(DB 설정
 * `private.return_pickup_settings.intake_columns`)로 네 칸만 읽는다: 회수 송장·주문번호·연락처·입고일. 나머지 열(이름·주소 등)은 읽지 않고
 * 서버로도 보내지 않는다. 회수 묶음에 맞추는 일은 DB가 하고(미리보기), 확정은 회수 묶음마다 회수 확인 경로로 기록한다.
 */

export const RETURN_INTAKE_FIELDS = ['trackingNumber', 'orderNumber', 'phone', 'receivedOn'] as const;
export type ReturnIntakeField = (typeof RETURN_INTAKE_FIELDS)[number];
export type ReturnIntakeColumns = Record<ReturnIntakeField, string[]>;
export const RETURN_INTAKE_FIELD_LABELS: Record<ReturnIntakeField, string> = { trackingNumber: '회수 송장', orderNumber: '주문번호', phone: '연락처', receivedOn: '입고일' };
/** 한 파일의 데이터 줄 상한. DB 미리보기·확정도 같은 수다. */
export const RETURN_INTAKE_ROW_LIMIT = 1000;
/** 머리글 줄을 찾는 범위(파일 위쪽 안내 줄을 건너뛴다). */
const HEADER_SCAN_ROWS = 10;

export interface ReturnIntakeRow {
  rowNumber: number;
  trackingNumber: string | null;
  orderNumber: string | null;
  phone: string | null;
  /** 'YYYY-MM-DD'. 날짜로 읽지 못하면 빈 문자열이고, DB가 '입고일 형식 오류'로 돌려준다. */
  receivedOn: string;
}
export interface ReturnIntakeIssue { line: number; reason: string }
export interface ReturnIntakeTable { rows: ReturnIntakeRow[]; issues: ReturnIntakeIssue[]; headerLine: number; found: ReturnIntakeField[] }

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function normalizeReturnIntakeHeader(value: string): string {
  return value.replace(/^﻿/u, '').replace(/\s+/gu, '').toLowerCase();
}

export function parseReturnIntakeColumns(value: unknown): ReturnIntakeColumns | null {
  if (!record(value)) return null;
  const columns = {} as ReturnIntakeColumns;
  for (const field of RETURN_INTAKE_FIELDS) {
    const aliases = value[field];
    if (!Array.isArray(aliases) || !aliases.length || aliases.length > 10 || !aliases.every(alias => typeof alias === 'string' && alias.trim())) return null;
    columns[field] = aliases.map(alias => String(alias).trim());
  }
  return columns;
}

/** 입고일을 'YYYY-MM-DD'로. 2026-11-12 · 2026.11.12 · 2026/11/12 · 20261112 · 2026년 11월 12일(뒤의 시각은 무시). 달력에 없는 날은 null. */
export function normalizeReturnIntakeDate(value: string): string | null {
  const text = value.trim();
  const match = /^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})\s*일?(?:[\sT].*)?$/u.exec(text) ?? /^(\d{4})(\d{2})(\d{2})$/u.exec(text);
  if (!match) return null;
  const [year, month, day] = match.slice(1, 4).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function headerColumns(row: readonly string[], columns: ReturnIntakeColumns): Partial<Record<ReturnIntakeField, number>> {
  const found: Partial<Record<ReturnIntakeField, number>> = {};
  const normalized = row.map(cell => normalizeReturnIntakeHeader(cell ?? ''));
  for (const field of RETURN_INTAKE_FIELDS) {
    const aliases = new Set(columns[field].map(normalizeReturnIntakeHeader));
    const index = normalized.findIndex(cell => cell && aliases.has(cell));
    if (index >= 0) found[field] = index;
  }
  return found;
}

const usable = (found: Partial<Record<ReturnIntakeField, number>>) =>
  found.receivedOn !== undefined && (found.trackingNumber !== undefined || found.orderNumber !== undefined);

/**
 * 표(줄 × 칸 문자열)에서 대응표의 네 칸만 읽는다. 머리글 줄은 위에서 열 줄 안에서 입고일과 회수 송장 또는 주문번호가 함께 있는 첫 줄이다.
 * 데이터 줄 번호(rowNumber)는 파일의 줄 번호(1부터)다 — 확정 근거에 그대로 남는다. 네 칸이 모두 빈 줄은 건너뛴다.
 * `lineErrors`는 파일을 읽을 때 그 줄에서 난 오류(수식 등)다 — 그 줄은 보내지 않고 '읽지 못한 줄'로 보인다.
 */
export function mapReturnIntakeTable(table: readonly (readonly string[])[], columns: ReturnIntakeColumns, lineErrors: Readonly<Record<number, string>> = {}): ReturnIntakeTable | { error: string } {
  let headerIndex = -1;
  let found: Partial<Record<ReturnIntakeField, number>> = {};
  for (let index = 0; index < Math.min(table.length, HEADER_SCAN_ROWS); index += 1) {
    const candidate = headerColumns(table[index], columns);
    if (usable(candidate)) { headerIndex = index; found = candidate; break; }
  }
  if (headerIndex < 0) {
    return { error: `열 이름을 찾지 못했습니다. 첫 줄 근처에 입고일 열과 회수 송장 또는 주문번호 열이 있어야 합니다. 지금 대응표: ${RETURN_INTAKE_FIELDS.map(field => `${RETURN_INTAKE_FIELD_LABELS[field]}(${columns[field].join('·')})`).join(' / ')}` };
  }
  const rows: ReturnIntakeRow[] = [];
  const issues: ReturnIntakeIssue[] = [];
  const cell = (row: readonly string[], field: ReturnIntakeField) => {
    const index = found[field];
    return index === undefined ? '' : String(row[index] ?? '').trim();
  };
  for (let index = headerIndex + 1; index < table.length; index += 1) {
    const line = index + 1;
    const row = table[index];
    const values = { trackingNumber: cell(row, 'trackingNumber'), orderNumber: cell(row, 'orderNumber'), phone: cell(row, 'phone'), receivedOn: cell(row, 'receivedOn') };
    if (lineErrors[line]) { issues.push({ line, reason: lineErrors[line] }); continue; }
    if (!values.trackingNumber && !values.orderNumber && !values.phone && !values.receivedOn) continue;
    if (values.trackingNumber.length > 60 || values.orderNumber.length > 60 || values.phone.length > 40) {
      issues.push({ line, reason: '회수 송장·주문번호·연락처 칸의 내용이 너무 깁니다.' });
      continue;
    }
    rows.push({ rowNumber: line, trackingNumber: values.trackingNumber || null, orderNumber: values.orderNumber || null,
      phone: values.phone || null, receivedOn: normalizeReturnIntakeDate(values.receivedOn) ?? '' });
  }
  if (rows.length > RETURN_INTAKE_ROW_LIMIT) return { error: `반품입고 회신은 한 번에 ${RETURN_INTAKE_ROW_LIMIT.toLocaleString('ko-KR')}줄까지 올릴 수 있습니다. 파일을 나눠 올려주세요.` };
  return { rows, issues, headerLine: headerIndex + 1, found: RETURN_INTAKE_FIELDS.filter(field => found[field] !== undefined) };
}

/** DB 미리보기의 줄 상태. */
export const RETURN_INTAKE_STATUS_LABELS: Record<string, string> = {
  matched: '입고 확정 대상',
  not_found: '못 찾음',
  ambiguous: '반품지가 여러 곳 — 상세에서 확인',
  phone_required: '연락처가 있어야 주문번호로 찾음',
  already_collected: '이미 입고 확인',
  not_collectable: '입고를 확인할 단계가 아님',
  waived: '회수 생략 배송 건 — 상세에서 확인',
  duplicate: '같은 회수 묶음이 앞 줄에 있음',
  received_on_invalid: '입고일 형식 오류',
  received_on_future: '입고일이 오늘 이후',
  received_on_before_order: '입고일이 주문일 이전',
};
export const RETURN_INTAKE_OUTCOME_LABELS: Record<string, string> = {
  recorded: '입고완료로 기록',
  changed: '미리보기 뒤 바뀌어 기록하지 않음',
  failed: '기록하지 못함',
  skipped: '확정 대상 아님',
};

export interface ReturnIntakePreviewRow {
  rowNumber: number;
  status: string;
  matchedBy?: 'tracking' | 'order_phone';
  trackingNumber?: string;
  receivedOn?: string;
  claimId?: string;
  claimType?: OrderClaimType;
  claimReference?: number;
  orderNumber?: string;
  bundleId?: string;
  returnLabel?: string;
  items?: string;
}
export interface ReturnIntakeConfirmRow { rowNumber: number; outcome: string; status?: string; errorCode?: string; claimId?: string; claimType?: OrderClaimType; claimReference?: number; orderNumber?: string; returnLabel?: string; receivedOn?: string }
export interface ReturnIntakeConfirmResult { operationId: string; recorded: number; changed: number; failed: number; skipped: number; replayed: boolean; rows: ReturnIntakeConfirmRow[] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const optionalText = (value: unknown) => value === undefined || typeof value === 'string';
const claimType = (value: unknown): value is OrderClaimType => value === 'return' || value === 'exchange' || value === 'cancel';

function previewRow(value: unknown): ReturnIntakePreviewRow | null {
  if (!record(value) || !Number.isSafeInteger(value.rowNumber) || typeof value.status !== 'string'
    || !['matchedBy', 'trackingNumber', 'receivedOn', 'orderNumber', 'returnLabel', 'items'].every(key => optionalText(value[key]))
    || (value.claimId !== undefined && (typeof value.claimId !== 'string' || !UUID.test(value.claimId)))
    || (value.bundleId !== undefined && (typeof value.bundleId !== 'string' || !UUID.test(value.bundleId)))
    || (value.claimType !== undefined && !claimType(value.claimType))
    || (value.claimReference !== undefined && !Number.isSafeInteger(value.claimReference))) return null;
  return value as unknown as ReturnIntakePreviewRow;
}

export function parseReturnIntakePreview(value: unknown): { rows: ReturnIntakePreviewRow[]; counts: Record<string, number> } | null {
  if (!record(value) || !Array.isArray(value.rows) || !record(value.counts)) return null;
  const rows = value.rows.map(previewRow);
  if (rows.some(row => !row)) return null;
  const counts: Record<string, number> = {};
  for (const [key, count] of Object.entries(value.counts)) {
    if (!Number.isSafeInteger(count)) return null;
    counts[key] = Number(count);
  }
  return { rows: rows as ReturnIntakePreviewRow[], counts };
}

export function parseReturnIntakeConfirmResult(value: unknown): ReturnIntakeConfirmResult | null {
  if (!record(value) || typeof value.operationId !== 'string' || !UUID.test(value.operationId) || !Array.isArray(value.rows)
    || !['recorded', 'changed', 'failed', 'skipped'].every(key => Number.isSafeInteger(value[key]))) return null;
  const rows = value.rows.filter(record).filter(row => Number.isSafeInteger(row.rowNumber) && typeof row.outcome === 'string') as unknown as ReturnIntakeConfirmRow[];
  if (rows.length !== value.rows.length) return null;
  return { operationId: value.operationId, recorded: Number(value.recorded), changed: Number(value.changed), failed: Number(value.failed),
    skipped: Number(value.skipped), replayed: value.replayed === true, rows };
}

/** 기록 실패 줄의 사유(회수 확인 경로의 오류 코드). */
export function returnIntakeErrorText(code: string | undefined): string {
  switch (code) {
    case 'claim_collection_conflict': return '이미 다른 근거로 입고 확인된 회수 묶음입니다.';
    case 'invalid_collection_received_on': return '입고일은 주문일부터 오늘 사이여야 합니다.';
    case 'claim_not_collectable': return '지금 단계에서는 입고를 확인할 수 없습니다.';
    case 'claim_return_address_required': return '회수 주소가 없는 출고지입니다. 출고지 반품 주소를 등록해주세요.';
    default: return '기록하지 못했습니다. 상세에서 확인해주세요.';
  }
}
