import { isUuid } from '../uuid';

export const ADMIN_GIFT_STATES = ['awaiting_acceptance', 'accepted', 'ordered', 'declined', 'expired', 'canceled'] as const;
export type AdminGiftState = typeof ADMIN_GIFT_STATES[number];
export const ADMIN_GIFT_STATE_LABELS: Record<AdminGiftState, string> = {
  awaiting_acceptance: '수락 대기', accepted: '수락 완료 · 주문 전', ordered: '주문 생성', declined: '수락 거절', expired: '기한 만료', canceled: '선물 취소',
};
export interface AdminGiftFilters { state: AdminGiftState | null; query: string; page: number; pageSize: 50 | 100 | 200 }
export interface AdminGiftRow {
  id: string; state: AdminGiftState; senderName: string; recipientName: string | null; goodsLabel: string; quantity: number;
  createdAt: string; expiresAt: string; acceptedAt: string | null; orderId: string | null;
}
export interface AdminGiftData { rows: AdminGiftRow[]; total: number; page: number; pageSize: number; asOf: string; filters: AdminGiftFilters }
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const integer = (value: unknown, min = 0): value is number => Number.isSafeInteger(value) && (value as number) >= min;
const instant = (value: unknown): value is string => typeof value === 'string' && value.length <= 35 && Number.isFinite(Date.parse(value));
export function normalizeAdminGiftFilters(query: Record<string, unknown>): AdminGiftFilters {
  return { state: query.state === 'all' ? null : ADMIN_GIFT_STATES.includes(query.state as AdminGiftState) ? query.state as AdminGiftState : 'awaiting_acceptance',
    query: typeof query.query === 'string' ? query.query.trim().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 100) : '',
    page: typeof query.page === 'string' && /^[1-9][0-9]{0,5}$/.test(query.page) ? Number(query.page) : 1,
    pageSize: query.pageSize === '50' ? 50 : query.pageSize === '200' ? 200 : 100 };
}
export function adminGiftsQuery(filters: AdminGiftFilters, includePage = true, page = filters.page) {
  const query = new URLSearchParams();
  if (filters.state !== 'awaiting_acceptance') query.set('state', filters.state ?? 'all');
  if (filters.query) query.set('query', filters.query);
  if (includePage && filters.pageSize !== 100) query.set('pageSize', String(filters.pageSize));
  if (includePage && page > 1) query.set('page', String(page));
  return query;
}
export function adminGiftsHref(filters: AdminGiftFilters, page = filters.page) {
  const query = adminGiftsQuery(filters, true, page); return `/admin/sales/gifts${query.size ? `?${query}` : ''}`;
}
export function parseAdminGiftRow(value: unknown): AdminGiftRow | null {
  if (!record(value) || !isUuid(value.id) || !ADMIN_GIFT_STATES.includes(value.state as AdminGiftState)
    || typeof value.senderName !== 'string' || value.senderName.length > 200
    || value.recipientName !== null && (typeof value.recipientName !== 'string' || value.recipientName.length > 200)
    || typeof value.goodsLabel !== 'string' || value.goodsLabel.length > 45000 || !integer(value.quantity)
    || !instant(value.createdAt) || !instant(value.expiresAt) || value.acceptedAt !== null && !instant(value.acceptedAt)
    || value.orderId !== null && !isUuid(value.orderId) || value.state === 'ordered' && value.orderId === null) return null;
  return { id: value.id, state: value.state as AdminGiftState, senderName: value.senderName, recipientName: value.recipientName as string | null,
    goodsLabel: value.goodsLabel, quantity: value.quantity, createdAt: value.createdAt, expiresAt: value.expiresAt,
    acceptedAt: value.acceptedAt as string | null, orderId: value.orderId as string | null };
}
export function parseAdminGiftRows(value: unknown, limit = 200): AdminGiftRow[] | null {
  if (!Array.isArray(value) || value.length > limit) return null;
  const rows = value.map(parseAdminGiftRow); return rows.some(row => row === null) ? null : rows as AdminGiftRow[];
}
export function parseAdminGiftData(value: unknown, filters: AdminGiftFilters): AdminGiftData | null {
  if (!record(value) || !integer(value.total) || value.page !== filters.page || value.pageSize !== filters.pageSize || !instant(value.asOf)) return null;
  const rows = parseAdminGiftRows(value.rows); if (!rows || rows.length > filters.pageSize || value.total < rows.length) return null;
  return { rows, total: value.total, page: filters.page, pageSize: filters.pageSize, asOf: value.asOf, filters };
}
export function giftExportRows(rows: readonly AdminGiftRow[]) {
  return rows.map(row => [row.id, ADMIN_GIFT_STATE_LABELS[row.state], row.senderName, row.recipientName, row.goodsLabel, row.quantity,
    row.createdAt, row.expiresAt, row.acceptedAt, row.orderId]);
}
