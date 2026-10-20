import { isUuid } from '../uuid';
import { SUBSCRIPTION_CYCLE_STATES, SUBSCRIPTION_PLAN_STATES, SUBSCRIPTION_PLAN_LABELS, type SubscriptionCycleState, type SubscriptionPlanState } from '../subscriptions/model';
import { parseSubscriptionSchedule, type SubscriptionSchedule } from '../subscriptions/schedule';
import { parseSubscriptionCyclePage, type SubscriptionCyclePage } from '../subscriptions/customer';
export interface AdminSubscriptionFilters { state: SubscriptionPlanState | null; query: string; page: number }
export interface AdminSubscriptionRow {
  id: string; ownerId: string; buyerName: string; state: SubscriptionPlanState; revision: number; createdAt: string; updatedAt: string; nextRunAt: string | null;
  reason: string | null; schedule: SubscriptionSchedule; renewalOnlineTotal: number; renewalCollectTotal: number; goodsLabel: string;
  cycleCount: number; paidCycleCount: number; paidOnlineTotal: number;
  latestCycle: { id: string; number: number; state: SubscriptionCycleState; orderId: string | null; dispatchedAt: string | null; nextCheckAt: string | null; reason: string | null } | null;
}
export interface AdminSubscriptionData { rows: AdminSubscriptionRow[]; total: number; page: number; pageSize: number; asOf: string; filters: AdminSubscriptionFilters }
export interface AdminSubscriptionDetail { subscription: AdminSubscriptionRow; cycles: SubscriptionCyclePage }
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown, min = 0): value is number => Number.isSafeInteger(value) && (value as number) >= min;
const instant = (value: unknown): value is string => typeof value === 'string' && value.length <= 35 && Number.isFinite(Date.parse(value));
const nullableInstant = (value: unknown) => value === null || instant(value);
const reason = (value: unknown) => value === null || typeof value === 'string' && /^[a-z0-9_]{1,64}$/.test(value);
export function normalizeAdminSubscriptionFilters(query: Record<string, unknown>): AdminSubscriptionFilters {
  return { state: SUBSCRIPTION_PLAN_STATES.includes(query.state as SubscriptionPlanState) ? query.state as SubscriptionPlanState : null,
    query: typeof query.query === 'string' ? query.query.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 100) : '',
    page: typeof query.page === 'string' && /^[1-9][0-9]{0,5}$/.test(query.page) ? Number(query.page) : 1 };
}
export function adminSubscriptionsHref(filters: AdminSubscriptionFilters, page = filters.page) {
  const query = new URLSearchParams(); if (filters.state) query.set('state', filters.state); if (filters.query) query.set('query', filters.query); if (page > 1) query.set('page', String(page));
  return `/admin/sales/subscriptions${query.size ? `?${query}` : ''}`;
}
export function parseAdminSubscriptionRow(value: unknown): AdminSubscriptionRow | null {
  if (!record(value) || !isUuid(value.id) || !isUuid(value.ownerId) || typeof value.buyerName !== 'string' || value.buyerName.length > 200
    || !SUBSCRIPTION_PLAN_STATES.includes(value.state as SubscriptionPlanState) || !integer(value.revision, 1) || !instant(value.createdAt) || !instant(value.updatedAt)
    || !nullableInstant(value.nextRunAt) || !reason(value.reason) || !integer(value.renewalOnlineTotal) || !integer(value.renewalCollectTotal)
    || typeof value.goodsLabel !== 'string' || value.goodsLabel.length > 30000 || !integer(value.cycleCount) || !integer(value.paidCycleCount) || !integer(value.paidOnlineTotal)) return null;
  const schedule = parseSubscriptionSchedule(value.schedule); if (!schedule) return null;
  const latest = value.latestCycle;
  if (latest !== null && (!record(latest) || !isUuid(latest.id) || !integer(latest.number, 1) || !SUBSCRIPTION_CYCLE_STATES.includes(latest.state as SubscriptionCycleState)
    || latest.orderId !== null && !isUuid(latest.orderId) || !nullableInstant(latest.dispatchedAt) || !nullableInstant(latest.nextCheckAt) || !reason(latest.reason))) return null;
  return { id: value.id, ownerId: value.ownerId, buyerName: value.buyerName, state: value.state as SubscriptionPlanState, revision: value.revision,
    createdAt: value.createdAt, updatedAt: value.updatedAt, nextRunAt: value.nextRunAt as string | null, reason: value.reason as string | null, schedule,
    renewalOnlineTotal: value.renewalOnlineTotal, renewalCollectTotal: value.renewalCollectTotal, goodsLabel: value.goodsLabel, cycleCount: value.cycleCount,
    paidCycleCount: value.paidCycleCount, paidOnlineTotal: value.paidOnlineTotal, latestCycle: latest === null ? null : {
      id: (latest as Record<string, unknown>).id as string, number: (latest as Record<string, unknown>).number as number,
      state: (latest as Record<string, unknown>).state as SubscriptionCycleState, orderId: (latest as Record<string, unknown>).orderId as string | null,
      dispatchedAt: (latest as Record<string, unknown>).dispatchedAt as string | null, nextCheckAt: (latest as Record<string, unknown>).nextCheckAt as string | null,
      reason: (latest as Record<string, unknown>).reason as string | null } };
}
export function parseAdminSubscriptionRows(value: unknown, limit = 100): AdminSubscriptionRow[] | null {
  if (!Array.isArray(value) || value.length > limit) return null;
  const rows = value.map(parseAdminSubscriptionRow); return rows.some(row => row === null) ? null : rows as AdminSubscriptionRow[];
}
export function parseAdminSubscriptionData(value: unknown, filters: AdminSubscriptionFilters): AdminSubscriptionData | null {
  if (!record(value) || !integer(value.total) || value.page !== filters.page || !integer(value.pageSize, 1) || value.pageSize > 100 || !instant(value.asOf)) return null;
  const rows = parseAdminSubscriptionRows(value.rows); if (!rows || rows.length > value.pageSize || value.total < rows.length) return null;
  return { rows, total: value.total, page: value.page as number, pageSize: value.pageSize, asOf: value.asOf, filters };
}
export function parseAdminSubscriptionDetail(value: unknown): AdminSubscriptionDetail | null {
  if (!record(value)) return null; const subscription = parseAdminSubscriptionRow(value.subscription), cycles = parseSubscriptionCyclePage(value.cycles);
  return subscription && cycles ? { subscription, cycles } : null;
}
export function subscriptionScheduleLabel(schedule: SubscriptionSchedule) { return `${schedule.interval}${schedule.unit === 'week' ? '주' : '개월'}${schedule.monthEnd ? ' · 말일' : ''}`; }
export function subscriptionExportRows(rows: readonly AdminSubscriptionRow[]) {
  return rows.map(row => [row.id, row.ownerId, row.buyerName, row.goodsLabel, SUBSCRIPTION_PLAN_LABELS[row.state], subscriptionScheduleLabel(row.schedule),
    row.nextRunAt, row.renewalOnlineTotal, row.renewalCollectTotal, row.cycleCount, row.paidCycleCount, row.paidOnlineTotal, row.createdAt, row.updatedAt]);
}
