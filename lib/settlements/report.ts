import { parseSettlementAccountIdentity, settlementAccountKey, type SettlementAccountIdentity } from './accounts';
import { settlementDecimal } from './decimal';
import { isSettlementDate, parseSettlementQuery, type SettlementMode, type SettlementQuery } from './types';
import type { PgSettlementFilters } from './console';
import { isUuid } from '@/lib/uuid';

export interface PgSettlementJob extends SettlementQuery, SettlementAccountIdentity {
  id: string; operationId: string; mode: SettlementMode;
  state: 'collecting' | 'verifying' | 'complete' | 'failed'; scan: 1 | 2; nextPage: number;
  recordCount: number; sourceCount: number; startedAt: string; updatedAt: string; completedAt: string | null; errorCode: string | null;
}
export type PgSettlementKind = 'approval' | 'cancel';
export type PgSettlementMatch = 'matched' | 'unlinked' | 'mismatch';
export interface PgSettlementTotals {
  currency: string; kind: PgSettlementKind; count: number; amount: string; interestFee: string; feeAmount: string;
  supplyAmount: string; vat: string; payOutAmount: string; cancelAmount: string;
}
export interface PgSettlementTransaction {
  id: string; kind: PgSettlementKind; currency: string; method: string; amount: string; interestFee: string;
  fees: { type: string; fee: string }[]; supplyAmount: string; vat: string; payOutAmount: string; cancelAmount: string | null;
  approvedAt: string; soldDate: string; paidOutDate: string; canceledAt: string | null;
  matchState: PgSettlementMatch; matchReason: string | null; purpose: 'order' | 'ticket' | null;
  referenceId: string | null; orderNumber: string | null;
}
export interface PgSettlementReport {
  coverage: 'uncollected' | 'complete' | 'empty'; snapshot: PgSettlementJob | null; jobs: PgSettlementJob[];
  totals: PgSettlementTotals[]; daily: (PgSettlementTotals & { date: string })[];
  transactions: PgSettlementTransaction[]; fees: { currency: string; kind: PgSettlementKind; type: string; count: number; fee: string }[];
  pagination: { page: number; pageSize: number; total: number }; fingerprint: string | null;
}
const object = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown, maximum = 200): value is string => typeof value === 'string' && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value);
const integer = (value: unknown, maximum = 20_000): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const timestamp = (value: unknown): value is string => text(value, 50) && Number.isFinite(Date.parse(value));
const currency = (value: unknown): value is string => typeof value === 'string' && /^[A-Z]{3}$/.test(value);
const kind = (value: unknown): value is PgSettlementKind => value === 'approval' || value === 'cancel';
const money = (value: unknown): value is string => settlementDecimal(value, 26) !== null;

export function parsePgSettlementJob(value: unknown): PgSettlementJob | null {
  const row = object(value), query = parseSettlementQuery(value), account = parseSettlementAccountIdentity(value);
  if (!row || !query || !account || !isUuid(row.id) || !isUuid(row.operationId) || !['test', 'live'].includes(String(row.mode))
    || !['collecting', 'verifying', 'complete', 'failed'].includes(String(row.state)) || (row.scan !== 1 && row.scan !== 2)
    || !integer(row.nextPage, 21) || row.nextPage < 1 || !integer(row.recordCount) || !integer(row.sourceCount, 40_000)
    || !timestamp(row.startedAt) || !timestamp(row.updatedAt) || (row.completedAt !== null && !timestamp(row.completedAt))
    || (row.errorCode !== null && (!text(row.errorCode, 80) || !/^[a-z_]+$/.test(row.errorCode)))
    || ((row.state === 'complete') !== (row.completedAt !== null))
    || (row.state === 'collecting' && row.scan !== 1) || (['verifying', 'complete'].includes(String(row.state)) && row.scan !== 2)) return null;
  return { ...query, ...account, id: row.id, operationId: row.operationId, mode: row.mode as SettlementMode, state: row.state as PgSettlementJob['state'],
    scan: row.scan as 1 | 2, nextPage: row.nextPage, recordCount: row.recordCount, sourceCount: row.sourceCount,
    startedAt: row.startedAt, updatedAt: row.updatedAt, completedAt: row.completedAt as string | null, errorCode: row.errorCode as string | null };
}

function parseTotals(value: unknown): PgSettlementTotals | null {
  const row = object(value);
  if (!row || !currency(row.currency) || !kind(row.kind) || !integer(row.count)
    || !money(row.amount) || !money(row.interestFee) || !money(row.feeAmount) || !money(row.supplyAmount)
    || !money(row.vat) || !money(row.payOutAmount) || !money(row.cancelAmount)) return null;
  return { currency: row.currency, kind: row.kind, count: row.count, amount: row.amount, interestFee: row.interestFee,
    feeAmount: row.feeAmount, supplyAmount: row.supplyAmount, vat: row.vat, payOutAmount: row.payOutAmount, cancelAmount: row.cancelAmount };
}
function parseFee(value: unknown): { type: string; fee: string } | null {
  const row = object(value);
  return row && text(row.type, 40) && /^[A-Z_]+$/.test(row.type) && money(row.fee) ? { type: row.type, fee: row.fee } : null;
}
function parseTransaction(value: unknown): PgSettlementTransaction | null {
  const row = object(value);
  if (!row || !isUuid(row.id) || !kind(row.kind) || !currency(row.currency) || !text(row.method, 40)
    || !money(row.amount) || !money(row.interestFee) || !money(row.supplyAmount) || !money(row.vat) || !money(row.payOutAmount)
    || (row.cancelAmount !== null && !money(row.cancelAmount)) || !timestamp(row.approvedAt)
    || !isSettlementDate(row.soldDate) || !isSettlementDate(row.paidOutDate) || (row.canceledAt !== null && !timestamp(row.canceledAt))
    || !['matched', 'unlinked', 'mismatch'].includes(String(row.matchState))
    || (row.matchReason !== null && !text(row.matchReason, 80))
    || (row.purpose !== null && row.purpose !== 'order' && row.purpose !== 'ticket')
    || (row.referenceId !== null && !isUuid(row.referenceId)) || (row.orderNumber !== null && !text(row.orderNumber, 80))
    || !Array.isArray(row.fees) || row.fees.length > 100) return null;
  const fees = row.fees.map(parseFee);
  if (fees.some(item => !item)) return null;
  return { id: row.id, kind: row.kind, currency: row.currency, method: row.method, amount: row.amount, interestFee: row.interestFee,
    fees: fees as { type: string; fee: string }[], supplyAmount: row.supplyAmount, vat: row.vat, payOutAmount: row.payOutAmount,
    cancelAmount: row.cancelAmount as string | null, approvedAt: row.approvedAt, soldDate: row.soldDate, paidOutDate: row.paidOutDate,
    canceledAt: row.canceledAt as string | null, matchState: row.matchState as PgSettlementMatch, matchReason: row.matchReason as string | null,
    purpose: row.purpose as PgSettlementTransaction['purpose'], referenceId: row.referenceId as string | null, orderNumber: row.orderNumber as string | null };
}

export function pgSettlementRpcQuery(filters: PgSettlementFilters): Record<string, unknown> {
  return { account: filters.account, dateType: filters.dateType, startDate: filters.startDate, endDate: filters.endDate, mode: filters.mode,
    kind: filters.kind, match: filters.match, query: filters.query, currency: filters.currency, importId: filters.importId,
    page: filters.page, pageSize: filters.pageSize };
}
export function jobMatchesQuery(job: PgSettlementJob, query: SettlementQuery & { mode: SettlementMode; account?: string | null }) {
  return (query.account && query.account !== 'current' ? settlementAccountKey(job) === query.account : job.integration === 'toss_payment') && job.dateType === query.dateType && job.startDate === query.startDate && job.endDate === query.endDate && job.mode === query.mode;
}

/** Explicit projection prevents accidental future private RPC fields from reaching the browser. */
export function parsePgSettlementReport(value: unknown, filters: PgSettlementFilters, exporting = false): PgSettlementReport | null {
  const row = object(value);
  if (!row || !['uncollected', 'complete', 'empty'].includes(String(row.coverage))) return null;
  const snapshot = row.snapshot === null ? null : parsePgSettlementJob(row.snapshot);
  if ((row.snapshot !== null && !snapshot) || (snapshot && (snapshot.state !== 'complete' || !jobMatchesQuery(snapshot, filters)
    || (filters.importId !== null && snapshot.id !== filters.importId))) || ((row.coverage === 'uncollected') !== (snapshot === null))) return null;
  if (![row.jobs, row.totals, row.daily, row.transactions, row.fees].every(Array.isArray)) return null;
  const jobs = (row.jobs as unknown[]).map(parsePgSettlementJob);
  const totals = (row.totals as unknown[]).map(parseTotals);
  const daily = (row.daily as unknown[]).map(item => {
    const total = parseTotals(item), date = object(item)?.date;
    return total && isSettlementDate(date) && date >= filters.startDate && date <= filters.endDate ? { ...total, date } : null;
  });
  const transactions = (row.transactions as unknown[]).map(parseTransaction);
  const fees = (row.fees as unknown[]).map(item => {
    const fee = parseFee(item), data = object(item);
    return fee && data && currency(data.currency) && kind(data.kind) && integer(data.count) ? { ...fee, currency: data.currency, kind: data.kind, count: data.count } : null;
  });
  const pagination = object(row.pagination);
  if ([...jobs, ...totals, ...daily, ...transactions, ...fees].some(item => !item)
    || jobs.some(job => job && !jobMatchesQuery(job, filters)) || !pagination || !integer(pagination.page, 1_000_000) || pagination.page < 1
    || !integer(pagination.pageSize) || pagination.pageSize < 1 || !integer(pagination.total)
    || transactions.length > (exporting ? 20_000 : filters.pageSize)
    || (!exporting && (pagination.page !== filters.page || pagination.pageSize !== filters.pageSize))
    || new Set(transactions.map(item => item?.id)).size !== transactions.length
    || transactions.some(item => item && (item[filters.dateType] < filters.startDate || item[filters.dateType] > filters.endDate))
    || (row.coverage === 'empty' && snapshot?.recordCount !== 0)
    || (row.coverage === 'uncollected' && (totals.length || daily.length || transactions.length || fees.length || pagination.total !== 0))) return null;
  const fingerprint = typeof row.fingerprint === 'string' && /^[a-f0-9]{64}$/.test(row.fingerprint) ? row.fingerprint : null;
  if (exporting && (!snapshot || !fingerprint || transactions.length !== pagination.total)) return null;
  return { coverage: row.coverage as PgSettlementReport['coverage'], snapshot, jobs: jobs as PgSettlementJob[], totals: totals as PgSettlementTotals[],
    daily: daily as PgSettlementReport['daily'], transactions: transactions as PgSettlementTransaction[], fees: fees as PgSettlementReport['fees'],
    pagination: { page: pagination.page, pageSize: pagination.pageSize, total: pagination.total }, fingerprint };
}

export const PG_SETTLEMENT_KIND_LABELS = { approval: '승인', cancel: '취소' } as const;
export const PG_SETTLEMENT_MATCH_LABELS = { matched: '일치', unlinked: '미연결', mismatch: '불일치' } as const;
export const PG_SETTLEMENT_FEE_LABELS: Record<string, string> = { BASE: '기본 수수료', INSTALLMENT_DISCOUNT: '카드사·PG 무이자 할부', INSTALLMENT: '상점 무이자 할부', POINT_SAVING: '카드사 포인트', ETC: '기타 수수료' };
