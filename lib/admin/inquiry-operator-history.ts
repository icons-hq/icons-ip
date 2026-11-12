import { consoleDatePresetRange, shiftKstDay } from '@/components/admin/console/date-presets';
import { isInquiryStatus, type InquiryStatus } from '@/lib/inquiries';
import { isUuid } from '@/lib/uuid';
import { MANAGER_ROLES, type ManagerRole } from './access';

/*
 * 운영자별 처리 이력(1014-105, 사용자 결정 2026-11-12 "운영자별 처리 이력" — 누가 언제 답변·완료했는지 운영자별 목록).
 * 운영자 활동 기록이라 매니저 관리 권한(operators.manage)으로만 열고, DB `admin_operator_inquiry_history`가 열람을 감사한다.
 * 문의 하나의 처리 이력은 문의 화면(고객문의 상세·상담하기)에서 그 문의를 여는 운영자 누구나 본다.
 */

export const INQUIRY_OPERATOR_HISTORY_PATH = '/admin/cs/operator-history';
/** DB가 받는 최대 조회 기간(양 끝 포함 날짜 수 - 1). */
export const INQUIRY_OPERATOR_HISTORY_MAX_DAYS = 366;

export const OPERATOR_INQUIRY_EVENT_LABELS = { answered: '답변', closed: '완료', reassigned: '담당 변경' } as const;
export type OperatorInquiryEventKind = keyof typeof OPERATOR_INQUIRY_EVENT_LABELS;

export interface InquiryOperatorHistoryFilters {
  /** KST `YYYY-MM-DD`(포함). */
  from: string;
  /** KST `YYYY-MM-DD`(포함). */
  to: string;
  /** 처리 목록을 볼 운영자. 없으면 집계만. */
  operator: string | null;
  page: number;
  /** 주소의 기간이 잘못됐거나 최대 기간을 넘어 최근 1개월로 바꿔 조회했는지. 화면이 안내한다. */
  rangeAdjusted?: boolean;
}

export interface OperatorInquirySummaryRow {
  operatorId: string;
  name: string;
  managerRole: ManagerRole | null;
  answers: number;
  closes: number;
  reassignments: number;
  /** 답변·완료·담당 변경을 한 문의 수. */
  inquiries: number;
  lastAt: string;
}

export interface OperatorInquiryEvent {
  id: string;
  at: string;
  kind: OperatorInquiryEventKind;
  inquiryId: string | null;
  reference: number | null;
  title: string | null;
  status: InquiryStatus | null;
  fromName: string | null;
  toName: string | null;
}

export interface OperatorInquiryDetail {
  operatorId: string;
  name: string;
  page: number;
  pageSize: number;
  total: number;
  items: OperatorInquiryEvent[];
}

export interface InquiryOperatorHistoryData {
  from: string;
  to: string;
  operators: OperatorInquirySummaryRow[];
  detail: OperatorInquiryDetail | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function validDay(value: unknown): value is string {
  if (typeof value !== 'string' || !DAY.test(value)) return false;
  try { return shiftKstDay(value, 0) === value; } catch { return false; }
}

function dayDiff(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** 기간이 비었거나 잘못됐거나 너무 길면 최근 1개월(오늘 포함)로 연다. 처리 목록 운영자와 페이지는 URL 값을 검증해 받는다. */
export function normalizeInquiryOperatorHistoryFilters(params: Record<string, string | string[] | undefined>, now: Date = new Date()): InquiryOperatorHistoryFilters {
  const single = (key: string) => typeof params[key] === 'string' ? (params[key] as string).trim() : '';
  const fallback = consoleDatePresetRange('month', now);
  const from = single('from');
  const to = single('to');
  const valid = validDay(from) && validDay(to) && dayDiff(from, to) >= 0 && dayDiff(from, to) <= INQUIRY_OPERATOR_HISTORY_MAX_DAYS;
  const range = valid ? { from, to } : fallback;
  const operator = single('operator').toLowerCase();
  const page = Number(single('page'));
  return { ...range, operator: isUuid(operator) ? operator : null, page: Number.isSafeInteger(page) && page > 0 && page <= 100_000 ? page : 1,
    rangeAdjusted: !valid && Boolean(from || to) };
}

export function inquiryOperatorHistoryHref(filters: InquiryOperatorHistoryFilters, overrides: Partial<InquiryOperatorHistoryFilters> = {}) {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams({ from: next.from, to: next.to });
  if (next.operator) params.set('operator', next.operator);
  if (next.operator && next.page > 1) params.set('page', String(next.page));
  return `${INQUIRY_OPERATOR_HISTORY_PATH}?${params}`;
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function count(value: unknown, min = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
}
function instant(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function name(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 200;
}
function nullableName(value: unknown): value is string | null {
  return value === null || name(value);
}

function parseSummaryRow(value: unknown): OperatorInquirySummaryRow | null {
  if (!record(value) || !isUuid(value.operatorId) || !name(value.name)
    || !(value.managerRole === null || MANAGER_ROLES.includes(value.managerRole as ManagerRole))
    || !count(value.answers) || !count(value.closes) || !count(value.reassignments) || !count(value.inquiries, 1)
    || value.answers + value.closes + value.reassignments < 1 || !instant(value.lastAt)) return null;
  return { operatorId: value.operatorId, name: value.name, managerRole: value.managerRole as ManagerRole | null,
    answers: value.answers, closes: value.closes, reassignments: value.reassignments, inquiries: value.inquiries, lastAt: value.lastAt };
}

function parseEvent(value: unknown): OperatorInquiryEvent | null {
  if (!record(value) || typeof value.id !== 'string' || !value.id || !instant(value.at)
    || !Object.hasOwn(OPERATOR_INQUIRY_EVENT_LABELS, String(value.kind))
    || !(value.inquiryId === null || isUuid(value.inquiryId)) || !(value.reference === null || count(value.reference, 1))
    || !(value.title === null || typeof value.title === 'string') || !(value.status === null || isInquiryStatus(value.status))
    || !nullableName(value.fromName) || !nullableName(value.toName)) return null;
  return { id: value.id, at: value.at, kind: value.kind as OperatorInquiryEventKind, inquiryId: value.inquiryId as string | null,
    reference: value.reference as number | null, title: value.title as string | null, status: value.status as InquiryStatus | null,
    fromName: value.fromName, toName: value.toName };
}

/** 계약과 다른 응답은 빈 목록이 아니라 읽기 실패다('처리한 사람이 없다'로 읽히면 안 된다). */
export function parseInquiryOperatorHistory(value: unknown): InquiryOperatorHistoryData | null {
  if (!record(value) || !validDay(value.from) || !validDay(value.to) || !Array.isArray(value.operators)
    || !(value.detail === null || record(value.detail))) return null;
  const operators: OperatorInquirySummaryRow[] = [];
  for (const row of value.operators) {
    const parsed = parseSummaryRow(row);
    if (!parsed) return null;
    operators.push(parsed);
  }
  if (new Set(operators.map(row => row.operatorId)).size !== operators.length) return null;
  let detail: OperatorInquiryDetail | null = null;
  if (record(value.detail)) {
    const raw = value.detail;
    if (!isUuid(raw.operatorId) || !name(raw.name) || !count(raw.page, 1) || !count(raw.pageSize, 1) || !count(raw.total)
      || !Array.isArray(raw.items) || raw.items.length > raw.pageSize || raw.items.length > raw.total) return null;
    const items: OperatorInquiryEvent[] = [];
    for (const row of raw.items) {
      const parsed = parseEvent(row);
      if (!parsed) return null;
      items.push(parsed);
    }
    if (new Set(items.map(item => item.id)).size !== items.length) return null;
    detail = { operatorId: raw.operatorId, name: raw.name, page: raw.page, pageSize: raw.pageSize, total: raw.total, items };
  }
  return { from: value.from, to: value.to, operators, detail };
}
