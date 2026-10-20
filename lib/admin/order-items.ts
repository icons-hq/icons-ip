import { isUuid } from '@/lib/uuid';
import { readGoodsCustomInputSnapshot } from '@/lib/goods-custom-inputs';
import { isOpenOrderClaimStage, isOrderClaimStage, isOrderClaimType, type OrderClaimStage, type OrderClaimType } from '@/lib/orders/claims';
import { ADMIN_ORDER_STATUSES, adminOrdersHref, normalizeAdminOrderFilters, type AdminOrderFilters, type AdminOrderStatus } from './orders';

export type AdminOrderItemFilters = Omit<AdminOrderFilters, 'field'> & { field: AdminOrderFilters['field'] | 'item' };
export interface AdminOrderItemRow {
  id: string; orderId: string; userId: string; buyerName: string; recipientName: string | null;
  status: AdminOrderStatus; createdAt: string; goodId: string; goodName: string;
  variantName: string | null; variantCode: string | null; customInputs: ReturnType<typeof readGoodsCustomInputSnapshot>;
  qty: number; unitPrice: number; itemAmount: number; shipmentId: string | null; shipmentStatus: string | null;
  originName: string | null; trackingNumber: string | null; carrierLabel: string | null;
  claim: { id: string; type: OrderClaimType; stage: OrderClaimStage } | null;
}
export interface AdminOrderItemData {
  filters: AdminOrderItemFilters; rows: AdminOrderItemRow[]; total: number; orderCount: number; qty: number;
  fingerprint: string; counts: Record<AdminOrderStatus, number>;
}
const record = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const nullableString = (v: unknown) => v === null || typeof v === 'string';
export function normalizeAdminOrderItemFilters(params: Record<string, string | string[] | undefined>): AdminOrderItemFilters {
  const base = normalizeAdminOrderFilters(params); const field = Array.isArray(params.field) ? params.field[0] : params.field;
  return { ...base, orderId: null, field: field === 'item' ? 'item' : base.field };
}
export function adminOrderItemsHref(filters: AdminOrderItemFilters, overrides: Partial<AdminOrderItemFilters> = {}) {
  const merged = { ...filters, ...overrides };
  const url = new URL(adminOrdersHref({ ...merged, field: merged.field === 'item' ? 'all' : merged.field, orderId: null }), 'https://admin.invalid');
  url.searchParams.set('view', 'items'); if (merged.field === 'item') url.searchParams.set('field', 'item');
  return url.pathname + url.search;
}
export function orderViewHref(filters: AdminOrderFilters | AdminOrderItemFilters, view: 'orders' | 'items') {
  if (view === 'items') return adminOrderItemsHref({ ...filters, page: 1, orderId: null });
  return adminOrdersHref({ ...filters, field: filters.field === 'item' ? 'all' : filters.field, query: filters.field === 'item' ? '' : filters.query, page: 1, orderId: null });
}
export function parseAdminOrderItemData(value: unknown, filters: AdminOrderItemFilters): AdminOrderItemData | null {
  if (!record(value) || !count(value.total) || !count(value.orderCount) || value.orderCount > value.total || !count(value.qty)
    || typeof value.fingerprint !== 'string' || !/^[a-f0-9]{32}$/.test(value.fingerprint) || !record(value.counts)
    || !ADMIN_ORDER_STATUSES.every(status => count((value.counts as Record<string, unknown>)[status]))
    || !Array.isArray(value.rows) || value.rows.length > 500 || value.rows.length > value.total) return null;
  const rows: AdminOrderItemRow[] = []; const ids = new Set<string>();
  for (const row of value.rows) {
    if (!record(row) || !isUuid(row.id) || ids.has(row.id) || !isUuid(row.orderId) || !isUuid(row.userId)
      || typeof row.buyerName !== 'string' || typeof row.goodId !== 'string' || !row.goodId || typeof row.goodName !== 'string'
      || !ADMIN_ORDER_STATUSES.includes(row.status as AdminOrderStatus) || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt))
      || !['recipientName', 'variantName', 'variantCode', 'originName', 'trackingNumber', 'carrierLabel'].every(key => nullableString(row[key]))
      || !count(row.qty) || row.qty < 1 || !count(row.unitPrice) || !count(row.itemAmount) || row.qty * row.unitPrice !== row.itemAmount
      || (row.shipmentId !== null && !isUuid(row.shipmentId)) || (row.shipmentStatus !== null && !['ready', 'shipping', 'delivered', 'canceled'].includes(String(row.shipmentStatus)))) return null;
    if (row.claim !== null && (!record(row.claim) || !isUuid(row.claim.id) || !isOrderClaimType(row.claim.type) || !isOrderClaimStage(row.claim.stage))) return null;
    ids.add(row.id);
    rows.push({ ...row, customInputs: readGoodsCustomInputSnapshot(row.customInputs) } as unknown as AdminOrderItemRow);
  }
  return { filters, rows, total: value.total, orderCount: value.orderCount, qty: value.qty, fingerprint: value.fingerprint, counts: value.counts as Record<AdminOrderStatus, number> };
}

/** The only mutation shortcut on this item list still targets complete orders. */
export function selectedConfirmableOrderIds(rows: AdminOrderItemRow[], selectedItemIds: readonly string[]): string[] {
  const selected = new Set(selectedItemIds);
  return [...new Set(rows.filter(row => selected.has(row.id) && row.status === 'paid'
    && (!row.claim || !isOpenOrderClaimStage(row.claim.stage))).map(row => row.orderId))];
}
