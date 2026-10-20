import { isUuid } from '@/lib/uuid';
import { normalizeStoreCreditAmount, parseStoreCreditBalanceValues, storeCreditErrorMessage, type StoreCreditBalanceValues } from '@/lib/store-credits';
export const STORE_CREDIT_CONSOLE_PATH = '/admin/sales/store-credits';
export const STORE_CREDIT_TARGET_LIMIT = 1000;
export const STORE_CREDIT_KINDS = ['grant','adjustment_credit','adjustment_debit','expire','reserve','consume','restore','earned_reversal','debt_offset','restoration_expired'] as const;
export interface StoreCreditCustomer { id: string; nickname: string; maskedEmail: string; eligible: boolean }
export interface StoreCreditBatchRow { target: string; userId: string | null; nickname: string | null; error: string | null; balance: StoreCreditBalanceValues; offset: number }
export interface StoreCreditBatch {
  id: string; status: 'invalid' | 'prepared' | 'completed' | 'failed'; purpose: 'promotion' | 'general'; reason: string;
  amount: number; expiresAt: string; count: number; invalidCount: number; gross: number; offset: number; net: number;
  rows: StoreCreditBatchRow[]; createdAt: string; error: string | null; completedCount?: number; failedCount?: number; finishedAt?: string; canExecute?: boolean;
}
export interface StoreCreditConsoleFilters { mode: 'batches' | 'ledger'; query: string; from: string; to: string; kind: string; page: number; pageSize: 20 | 50 | 100 }
export interface StoreCreditConsoleRow {
  id: string; createdAt: string; source: 'batch' | 'individual' | 'ledger'; kind: string; reason: string; amount: number;
  recipients: number; gross: number; completed: number; purpose: string; userId: string | null; orderId: string | null;
  actorId: string | null; batchId: string | null; availableDelta: number | null; reservedDelta: number | null; debtDelta: number | null;
  expiresAt: string | null; nickname: string; maskedEmail: string;
}
export interface StoreCreditConsoleData { filters: StoreCreditConsoleFilters; total: number; rows: StoreCreditConsoleRow[] }
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value);
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const nullableUuid = (value: unknown) => value === null || typeof value === 'string' && isUuid(value);
export function parseStoreCreditTargets(raw: string): { targets: string[]; duplicates: number } {
  const values = raw.split(/[\s,;]+/).map(value => value.trim().toLowerCase()).filter(Boolean);
  if (!values.length || values.length > 5000 || values.some(value => value.length > 200 || !isUuid(value) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value))) throw new Error('고객 ID 또는 정확한 이메일을 한 줄에 하나씩 입력해주세요.');
  const targets = [...new Set(values)];
  if (targets.length > STORE_CREDIT_TARGET_LIMIT) throw new Error('한 번에 최대 1,000명까지 지급할 수 있습니다.');
  return { targets, duplicates: values.length - targets.length };
}
export function parseStoreCreditBatch(value: unknown): StoreCreditBatch | null {
  if (!record(value) || typeof value.id !== 'string' || !isUuid(value.id) || !['invalid','prepared','completed','failed'].includes(String(value.status))
    || !['promotion','general'].includes(String(value.purpose)) || typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 1000
    || normalizeStoreCreditAmount(value.amount) === null || Number(value.amount) < 1 || !date(value.expiresAt) || !date(value.createdAt)
    || !integer(value.count) || value.count < 1 || value.count > 1000 || !integer(value.invalidCount) || value.invalidCount < 0 || value.invalidCount > value.count
    || ![value.gross,value.offset,value.net].every(item => integer(item) && item >= 0) || value.gross !== Number(value.amount) * value.count
    || Number(value.offset) + Number(value.net) !== value.gross || !Array.isArray(value.rows) || value.rows.length !== value.count
    || !(value.error === null || typeof value.error === 'string') || !(value.canExecute === undefined || typeof value.canExecute === 'boolean')) return null;
  for (const row of value.rows) if (!record(row) || typeof row.target !== 'string' || !nullableUuid(row.userId)
    || !(row.nickname === null || typeof row.nickname === 'string') || !(row.error === null || typeof row.error === 'string')
    || !parseStoreCreditBalanceValues(row.balance) || !integer(row.offset) || row.offset < 0 || row.offset > Number(value.amount)) return null;
  if (value.rows.filter(row => row.error !== null).length !== value.invalidCount || value.rows.reduce((sum,row) => sum + row.offset,0) !== value.offset
    || value.status !== 'invalid' && value.invalidCount !== 0 || value.status === 'invalid' && value.invalidCount === 0) return null;
  if (value.status === 'completed' && (value.completedCount !== value.count || value.failedCount !== 0 || !date(value.finishedAt))) return null;
  if (value.status === 'failed' && (value.completedCount !== 0 || value.failedCount !== value.count || !date(value.finishedAt) || !value.error)) return null;
  return value as unknown as StoreCreditBatch;
}
export function normalizeStoreCreditConsoleFilters(raw: Record<string, string | string[] | undefined>): StoreCreditConsoleFilters {
  const text = (key: string) => typeof raw[key] === 'string' ? raw[key].trim() : '';
  const mode = text('mode') === 'ledger' ? 'ledger' : 'batches';
  const day = (key: string) => /^\d{4}-\d{2}-\d{2}$/.test(text(key)) && date(text(key)) && new Date(text(key)).toISOString().slice(0,10) === text(key) ? text(key) : '';
  const page = Number(text('page')); const size = Number(text('pageSize')); const kind = text('kind');
  const allowed: readonly string[] = mode === 'ledger' ? STORE_CREDIT_KINDS : ['prepared','completed','failed'];
  const from = day('from'); let to = day('to'); if (from && to && from > to) to = from;
  return { mode, query: text('query').slice(0,200), from, to, kind: allowed.includes(kind) ? kind : '', page: Number.isSafeInteger(page) && page > 0 && page <= 100000 ? page : 1, pageSize: [20,50,100].includes(size) ? size as 20|50|100 : 50 };
}
export function storeCreditConsoleHref(filters: StoreCreditConsoleFilters): string {
  const params = new URLSearchParams();
  if (filters.mode === 'ledger') params.set('mode','ledger');
  for (const key of ['query','from','to','kind'] as const) if (filters[key]) params.set(key,filters[key]);
  if (filters.page > 1) params.set('page',String(filters.page));
  if (filters.pageSize !== 50) params.set('pageSize',String(filters.pageSize));
  return `${STORE_CREDIT_CONSOLE_PATH}${params.size ? `?${params}` : ''}`;
}
export function parseStoreCreditConsoleData(value: unknown, filters: StoreCreditConsoleFilters, maxRows: number = filters.pageSize): StoreCreditConsoleData | null {
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > 10000 || !record(value) || !integer(value.total) || value.total < 0 || !Array.isArray(value.rows) || value.rows.length > maxRows || value.rows.length > value.total) return null;
  for (const row of value.rows) {
    if (!record(row) || typeof row.id !== 'string' || !date(row.createdAt) || !['batch','individual','ledger'].includes(String(row.source))
      || typeof row.kind !== 'string' || typeof row.reason !== 'string' || typeof row.purpose !== 'string' || typeof row.nickname !== 'string' || typeof row.maskedEmail !== 'string'
      || ![row.amount,row.recipients,row.gross,row.completed].every(integer) || ![row.userId,row.orderId,row.actorId,row.batchId].every(nullableUuid)
      || ![row.availableDelta,row.reservedDelta,row.debtDelta].every(item => item === null || integer(item)) || !(row.expiresAt === null || date(row.expiresAt))) return null;
  }
  return { filters, total: value.total, rows: value.rows as unknown as StoreCreditConsoleRow[] };
}
export function storeCreditBatchError(reason: string | null): string {
  if (reason === 'customer_not_found') return '정확한 고객 ID·이메일을 확인해주세요.';
  if (reason === 'duplicate_customer') return '같은 고객이 ID와 이메일로 중복 입력됐습니다.';
  if (reason === 'customer_unavailable' || reason === 'account_suspended' || reason === 'account_deletion_in_progress') return '현재 지급할 수 없는 고객 계정입니다.';
  if (reason === 'store_credit_preview_stale') return '확인 유효시간이 지났거나 정책이 바뀌었습니다. 새로 검증해주세요.';
  return storeCreditErrorMessage(reason);
}
