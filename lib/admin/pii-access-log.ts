import { consoleDatePresetRange, shiftKstDay } from '@/components/admin/console/date-presets';
import { isUuid } from '@/lib/uuid';
import { kstDateTimeText, type ListExportCellValue, type ListExportColumn } from './list-export';

/*
 * 개인정보 접속기록(CUS-084·OPS-014·OPS-015). 개인정보의 안전성 확보조치 기준 제8조의 접속기록 — 누가(운영자)·언제·어디서(IP)·
 * 누구의(회원·주문·클레임·배송 건 ID)·무슨 업무(열람·검색·내려받기·원문 확인·정정)를 2년 보관하고 매니저 관리 권한이 점검한다.
 * 개인정보 원문(이름·연락처·주소·검색어)은 기록하지 않는다. 원장은 DB `private.operator_pii_access_log`(append-only)다.
 */

export const PII_ACCESS_LOG_PATH = '/admin/settings/access-log';
export const PII_ACCESS_LOG_EXPORT_PATH = '/api/admin/pii-access-log/export';
/** DB `private.pii_access_log_retention()`과 같다. 법정 최소(1년, 5만 명 이상·고유식별정보 처리 시 2년) 중 긴 쪽. */
export const PII_ACCESS_LOG_RETENTION_YEARS = 2;
/** DB가 받는 최대 조회 기간(양 끝 포함 날짜 수 - 1). */
export const PII_ACCESS_LOG_MAX_DAYS = 366;
/** 한 기록에 남기는 대상 ID 상한. 넘는 대상은 건수로만 남는다. */
export const PII_ACCESS_SUBJECT_ID_LIMIT = 1000;
/** 이상 징후 기준. DB `private.pii_access_log_entries`와 같은 값이다. */
export const PII_ACCESS_BULK_SUBJECTS = 1000;
export const PII_ACCESS_BURST_PER_HOUR = 50;

export const PII_ACCESS_ACTION_LABELS = {
  view: '열람', search: '검색', export: '내려받기', reveal: '원문 확인', correct: '정정',
} as const;
export type PiiAccessAction = keyof typeof PII_ACCESS_ACTION_LABELS;

export const PII_ACCESS_SURFACE_LABELS = {
  'customer.detail': '고객 상세',
  'customer.store_credits': '고객 적립금',
  'order.detail': '주문 상세',
  'order.search': '주문 검색',
  'claim.detail': '클레임 상세',
  'claim.contact': '클레임 회수·재배송지',
  'claim.contact_history': '클레임 회수·재배송지 이력',
  refund_account: '환불계좌',
  'export.list': '목록 엑셀',
  'export.shipment': '출고지시 파일',
  'export.gifts': '선물 목록 엑셀',
  'export.subscriptions': '정기구매 엑셀',
  'export.store_credits': '적립금 엑셀',
  'export.reviews': '리뷰 엑셀',
  'export.review_events': '리뷰이벤트 응모 엑셀',
  'export.settled': '거래확정 엑셀',
  access_log: '접속기록 점검',
} as const;
export type PiiAccessSurface = keyof typeof PII_ACCESS_SURFACE_LABELS;

export const PII_ACCESS_SUBJECT_LABELS = {
  member: '회원', order: '주문', claim: '클레임', shipment: '배송 건', none: '대상 없음',
} as const;
export type PiiAccessSubjectKind = keyof typeof PII_ACCESS_SUBJECT_LABELS;

export const PII_ACCESS_FLAG_LABELS = { off_hours: '근무시간 외', bulk: '대량', burst: '몰아보기' } as const;
export type PiiAccessFlag = keyof typeof PII_ACCESS_FLAG_LABELS;
export const PII_ACCESS_FLAG_RULES: Record<PiiAccessFlag, string> = {
  off_hours: '평일 08~21시(KST) 밖이나 주말에 남은 기록',
  bulk: `한 번에 대상 ${PII_ACCESS_BULK_SUBJECTS.toLocaleString('ko-KR')}건 이상(내려받기·검색)`,
  burst: `같은 운영자가 같은 1시간에 상세·원문을 ${PII_ACCESS_BURST_PER_HOUR}건 이상 연 기록`,
};
export const PII_ACCESS_FLAG_FILTERS = ['any', 'off_hours', 'bulk', 'burst'] as const;
export type PiiAccessFlagFilter = typeof PII_ACCESS_FLAG_FILTERS[number];

/** 주문 검색에서 이름·이메일·연락처가 검색어가 될 수 있는 유형(전체 포함). 주문번호·운송장·상품 검색은 남기지 않는다. */
export const PII_ORDER_SEARCH_FIELDS: ReadonlySet<string> = new Set(['all', 'nickname', 'email', 'recipient', 'phone']);

export function isPiiAccessAction(value: unknown): value is PiiAccessAction {
  return typeof value === 'string' && Object.hasOwn(PII_ACCESS_ACTION_LABELS, value);
}
export function isPiiAccessSurface(value: unknown): value is PiiAccessSurface {
  return typeof value === 'string' && Object.hasOwn(PII_ACCESS_SURFACE_LABELS, value);
}
export function isPiiAccessSubjectKind(value: unknown): value is PiiAccessSubjectKind {
  return typeof value === 'string' && Object.hasOwn(PII_ACCESS_SUBJECT_LABELS, value);
}
function isFlag(value: unknown): value is PiiAccessFlag {
  return typeof value === 'string' && Object.hasOwn(PII_ACCESS_FLAG_LABELS, value);
}
function isFlagFilter(value: unknown): value is PiiAccessFlagFilter {
  return typeof value === 'string' && (PII_ACCESS_FLAG_FILTERS as readonly string[]).includes(value);
}

/** 기록하는 경로. 쿼리 문자열(검색어가 들어간다)·해시는 버리고, DB가 받는 문자만 남긴다. */
export function piiAccessPath(pathname: string): string {
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/admin';
  return /^\/(admin|api\/admin)(\/[A-Za-z0-9._~%-]+)*$/.test(path) && path.length <= 300 ? path : '/admin';
}

export interface PiiAccessLogFilters {
  /** KST `YYYY-MM-DD`(포함). */
  from: string;
  /** KST `YYYY-MM-DD`(포함). */
  to: string;
  actor: string | null;
  action: PiiAccessAction | null;
  surface: PiiAccessSurface | null;
  /** 회원·주문·클레임·배송 건 ID. 회원 ID는 그 회원 주문의 기록도 찾는다. */
  subject: string | null;
  flag: PiiAccessFlagFilter | null;
  page: number;
  /** 주소의 조건이 잘못돼 기본값으로 바꿔 조회했는지. 화면이 안내한다. */
  adjusted?: boolean;
  /** 기본(최근 1개월·조건 없음)과 다른 조건으로 조회했는지. 화면이 조회 조건을 펼쳐 둔다. */
  chosen?: boolean;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
function validDay(value: unknown): value is string {
  if (typeof value !== 'string' || !DAY.test(value)) return false;
  try { return shiftKstDay(value, 0) === value; } catch { return false; }
}
function dayDiff(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function normalizePiiAccessLogFilters(params: Record<string, string | string[] | undefined>, now: Date = new Date()): PiiAccessLogFilters {
  const single = (key: string) => typeof params[key] === 'string' ? (params[key] as string).trim() : '';
  const fallback = consoleDatePresetRange('month', now);
  const from = single('from'), to = single('to');
  const validRange = validDay(from) && validDay(to) && dayDiff(from, to) >= 0 && dayDiff(from, to) <= PII_ACCESS_LOG_MAX_DAYS;
  const range = validRange ? { from, to } : fallback;
  const actor = single('actor').toLowerCase(), subject = single('subject').toLowerCase();
  const action = single('action'), surface = single('surface'), flag = single('flag');
  const page = Number(single('page'));
  const adjusted = (!validRange && Boolean(from || to)) || (Boolean(actor) && !isUuid(actor)) || (Boolean(subject) && !isUuid(subject))
    || (Boolean(action) && !isPiiAccessAction(action)) || (Boolean(surface) && !isPiiAccessSurface(surface)) || (Boolean(flag) && !isFlagFilter(flag));
  const filters: PiiAccessLogFilters = {
    ...range,
    actor: isUuid(actor) ? actor : null,
    action: isPiiAccessAction(action) ? action : null,
    surface: isPiiAccessSurface(surface) ? surface : null,
    subject: isUuid(subject) ? subject : null,
    flag: isFlagFilter(flag) ? flag : null,
    page: Number.isSafeInteger(page) && page > 0 && page <= 100_000 ? page : 1,
  };
  return { ...filters, adjusted,
    chosen: range.from !== fallback.from || range.to !== fallback.to || Boolean(filters.actor || filters.action || filters.surface || filters.subject || filters.flag) };
}

function filterParams(filters: PiiAccessLogFilters) {
  const params = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.actor) params.set('actor', filters.actor);
  if (filters.action) params.set('action', filters.action);
  if (filters.surface) params.set('surface', filters.surface);
  if (filters.subject) params.set('subject', filters.subject);
  if (filters.flag) params.set('flag', filters.flag);
  return params;
}

export function piiAccessLogHref(filters: PiiAccessLogFilters, overrides: Partial<PiiAccessLogFilters> = {}) {
  const next = { ...filters, ...overrides };
  const params = filterParams(next);
  if (next.page > 1) params.set('page', String(next.page));
  return `${PII_ACCESS_LOG_PATH}?${params}`;
}

/** 내려받기 POST 주소. 쪽 번호는 싣지 않는다(같은 조건 전체). */
export function piiAccessLogExportHref(filters: PiiAccessLogFilters) {
  return `${PII_ACCESS_LOG_EXPORT_PATH}?${filterParams(filters)}`;
}
export const PII_ACCESS_LOG_EXPORT_QUERY_KEYS = ['from', 'to', 'actor', 'action', 'surface', 'subject', 'flag'] as const;

export interface PiiAccessLogEntry {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  actorAccess: string;
  ip: string | null;
  action: PiiAccessAction;
  surface: PiiAccessSurface | string;
  path: string;
  subjectKind: PiiAccessSubjectKind;
  subjectIds: string[];
  subjectCount: number;
  memberIds: string[];
  memberCount: number;
  detail: Record<string, string | number | boolean | null>;
  flags: PiiAccessFlag[];
}

export interface PiiAccessLogSummary { total: number; offHours: number; bulk: number; burst: number; flagged: number }
export interface PiiAccessLogActor { id: string; name: string; count: number }
export interface PiiAccessLogData {
  from: string;
  to: string;
  page: number;
  pageSize: number;
  total: number;
  summary: PiiAccessLogSummary;
  items: PiiAccessLogEntry[];
  actors: PiiAccessLogActor[];
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
function text(value: unknown, max = 300): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}
function uuidList(value: unknown, max: number): value is string[] {
  return Array.isArray(value) && value.length <= max && value.every(isUuid);
}

function parseEntry(value: unknown, idLimit: number): PiiAccessLogEntry | null {
  if (!record(value) || !text(value.id, 20) || !/^\d+$/.test(value.id) || !instant(value.at) || !isUuid(value.actorId)
    || !text(value.actorName, 200) || !text(value.actorAccess, 32) || !(value.ip === null || text(value.ip, 64))
    || !isPiiAccessAction(value.action) || !text(value.surface, 100) || !text(value.path) || !isPiiAccessSubjectKind(value.subjectKind)
    || !uuidList(value.subjectIds, idLimit) || !count(value.subjectCount) || value.subjectIds.length > value.subjectCount
    || !uuidList(value.memberIds, idLimit) || !count(value.memberCount) || value.memberIds.length > value.memberCount
    || !record(value.detail) || Object.values(value.detail).some(item => item !== null && !['string', 'number', 'boolean'].includes(typeof item))
    || !Array.isArray(value.flags) || !value.flags.every(isFlag)) return null;
  return {
    id: value.id, at: value.at, actorId: value.actorId, actorName: value.actorName, actorAccess: value.actorAccess,
    ip: value.ip as string | null, action: value.action, surface: value.surface, path: value.path, subjectKind: value.subjectKind,
    subjectIds: value.subjectIds, subjectCount: value.subjectCount, memberIds: value.memberIds, memberCount: value.memberCount,
    detail: value.detail as PiiAccessLogEntry['detail'], flags: value.flags as PiiAccessFlag[],
  };
}

function parseEntries(value: unknown, idLimit: number, max: number): PiiAccessLogEntry[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const items: PiiAccessLogEntry[] = [];
  for (const row of value) {
    const parsed = parseEntry(row, idLimit);
    if (!parsed) return null;
    items.push(parsed);
  }
  return new Set(items.map(item => item.id)).size === items.length ? items : null;
}

/** 계약과 다른 응답은 빈 목록이 아니라 읽기 실패다('기록이 없다'로 읽히면 안 된다). */
export function parsePiiAccessLog(value: unknown): PiiAccessLogData | null {
  if (!record(value) || !validDay(value.from) || !validDay(value.to) || !count(value.page, 1) || !count(value.pageSize, 1)
    || !count(value.total) || !record(value.summary) || !Array.isArray(value.actors)) return null;
  const summary = value.summary;
  if (!count(summary.total) || !count(summary.offHours) || !count(summary.bulk) || !count(summary.burst) || !count(summary.flagged)
    || summary.flagged > summary.total) return null;
  const items = parseEntries(value.items, 5, value.pageSize);
  if (!items || items.length > value.total) return null;
  const actors: PiiAccessLogActor[] = [];
  for (const row of value.actors) {
    if (!record(row) || !isUuid(row.id) || !text(row.name, 200) || !count(row.count, 1)) return null;
    actors.push({ id: row.id, name: row.name, count: row.count });
  }
  return { from: value.from, to: value.to, page: value.page, pageSize: value.pageSize, total: value.total,
    summary: { total: summary.total, offHours: summary.offHours, bulk: summary.bulk, burst: summary.burst, flagged: summary.flagged },
    items, actors };
}

export interface PiiAccessLogExport { from: string; to: string; total: number; capturedAt: string; rows: PiiAccessLogEntry[] }
export function parsePiiAccessLogExport(value: unknown): PiiAccessLogExport | null {
  if (!record(value) || !validDay(value.from) || !validDay(value.to) || !count(value.total) || !instant(value.capturedAt)) return null;
  const rows = parseEntries(value.rows, 1000, 10_000);
  return rows && rows.length === value.total ? { from: value.from, to: value.to, total: value.total, capturedAt: value.capturedAt, rows } : null;
}

export function piiAccessSurfaceLabel(surface: string) {
  return isPiiAccessSurface(surface) ? PII_ACCESS_SURFACE_LABELS[surface] : surface;
}

const ACCESS_LABELS: Record<string, string> = {
  owner: '통합 매니저', primary: '계정 주매니저', deputy: '계정 부매니저', influencer: '인플루언서', agency: '대행사', logistics: '물류출고관리',
  legacy_admin: '호환 단계 관리자', legacy_staff: '호환 단계 직원', none: '권한 없음',
};
export function piiAccessActorAccessLabel(value: string) {
  return ACCESS_LABELS[value] ?? value;
}

/** 대상 칸: 종류·건수와 앞의 ID 몇 개. 회원 ID는 고객 상세로 이어 볼 수 있게 화면이 링크를 단다. */
export function piiAccessSubjectSummary(entry: Pick<PiiAccessLogEntry, 'subjectKind' | 'subjectCount' | 'subjectIds'>) {
  if (entry.subjectKind === 'none') return '대상 없음';
  return `${PII_ACCESS_SUBJECT_LABELS[entry.subjectKind]} ${entry.subjectCount.toLocaleString('ko-KR')}건`;
}

const DETAIL_LABELS: Record<string, string> = {
  screen: '화면', field: '검색 유형', page: '쪽', rowCount: '파일 행', records: '건수', via: '경로', mode: '목록', layout: '양식', format: '형식',
  command: '작업', target: '대상', auditId: '감사 기록', receiptId: '영수증',
};
export function piiAccessDetailText(detail: PiiAccessLogEntry['detail']) {
  return Object.entries(detail)
    .filter(([, value]) => value !== null && value !== '')
    .map(([key, value]) => `${DETAIL_LABELS[key] ?? key} ${typeof value === 'number' ? value.toLocaleString('ko-KR') : String(value)}`)
    .join(' · ');
}

const EXPORT_ID_CELL_LIMIT = 100;
function idCell(ids: string[], total: number) {
  if (!ids.length) return null;
  const shown = ids.slice(0, EXPORT_ID_CELL_LIMIT).join(', ');
  return total > Math.min(ids.length, EXPORT_ID_CELL_LIMIT) ? `${shown} 외 ${(total - Math.min(ids.length, EXPORT_ID_CELL_LIMIT)).toLocaleString('ko-KR')}건` : shown;
}

const column = (header: string, kind: ListExportColumn['kind'] = 'text', width = 22): ListExportColumn => ({ header, kind, width });

/** 점검 목록 엑셀 시트. 한 기록이 한 행이다. 대상 ID는 칸마다 앞의 100개만 적고 나머지는 건수로 적는다. */
export function piiAccessLogExportSheet(data: PiiAccessLogExport, filters: PiiAccessLogFilters, actorName: string | null) {
  const rows: ListExportCellValue[][] = data.rows.map(entry => [
    entry.id, kstDateTimeText(entry.at), entry.actorName, entry.actorId, piiAccessActorAccessLabel(entry.actorAccess), entry.ip,
    PII_ACCESS_ACTION_LABELS[entry.action], piiAccessSurfaceLabel(entry.surface), entry.path, PII_ACCESS_SUBJECT_LABELS[entry.subjectKind],
    entry.subjectCount, idCell(entry.subjectIds, entry.subjectCount), idCell(entry.memberIds, entry.memberCount), piiAccessDetailText(entry.detail) || null,
    entry.flags.map(flag => PII_ACCESS_FLAG_LABELS[flag]).join(', ') || null,
  ]);
  return {
    screenLabel: '개인정보 접속기록',
    title: '접속기록',
    recordCount: data.rows.length,
    rows,
    columns: [column('기록 번호', 'code', 14), column('접속일시 (KST)', 'text', 20), column('운영자'), column('운영자 ID', 'code', 40),
      column('역할', 'text', 16), column('접속지(IP)', 'code', 20), column('수행 업무', 'text', 12), column('화면', 'text', 24),
      column('경로', 'code', 44), column('대상 종류', 'text', 12), column('대상 수', 'count', 12), column('대상 ID', 'code', 44),
      column('관련 회원 ID', 'code', 44), column('조건·참고', 'text', 36), column('이상 징후', 'text', 20)],
    conditions: [
      ['기간', `${filters.from} ~ ${filters.to} (KST)`],
      ['운영자', actorName ?? (filters.actor ? filters.actor : '전체')],
      ['수행 업무', filters.action ? PII_ACCESS_ACTION_LABELS[filters.action] : '전체'],
      ['화면', filters.surface ? PII_ACCESS_SURFACE_LABELS[filters.surface] : '전체'],
      ['대상 ID', filters.subject ?? '전체'],
      ['이상 징후', filters.flag === 'any' ? '이상 징후 전체' : filters.flag ? PII_ACCESS_FLAG_LABELS[filters.flag] : '전체'],
    ] as [string, string][],
    notes: [
      '한 행이 접속기록 한 건입니다. 개인정보 원문(이름·연락처·주소·검색어)은 기록하지 않으며 대상은 ID와 건수로 남습니다.',
      `이상 징후: ${(Object.keys(PII_ACCESS_FLAG_RULES) as PiiAccessFlag[]).map(flag => `${PII_ACCESS_FLAG_LABELS[flag]}=${PII_ACCESS_FLAG_RULES[flag]}`).join(' / ')}.`,
      '운영자 IP가 담긴 보안 기록입니다. 점검 목적 밖으로 공유하지 말고 확인이 끝나면 삭제해주세요. 이 파일을 내려받은 기록도 남습니다.',
    ],
    filters: { from: filters.from, to: filters.to, actor: filters.actor, action: filters.action, surface: filters.surface, subject: filters.subject, flag: filters.flag },
  };
}
