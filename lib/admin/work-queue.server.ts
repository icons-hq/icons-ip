import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { GOODS_READINESS_REASONS, type GoodsReadinessReasonCode } from './goods-readiness';
import { goodsListHref, normalizeGoodsListFilters } from './goods-list';
import { goodsWorkspaceQuery } from './goods-list.server';
import type { AdminWorkQueueCount, AdminWorkQueueData } from './work-queue';

const UNKNOWN: AdminWorkQueueCount = { state: 'error', count: null };
function count(value: unknown): AdminWorkQueueCount {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof number === 'number' && Number.isSafeInteger(number) && number >= 0 ? { state: 'ready', count: number } : UNKNOWN;
}
/** Reuse list RPCs, including the shipment console's preorder delay definition.
 * One summary per domain; no order/line downloads or bespoke SLA calculation. */
export async function loadAdminWorkQueue(): Promise<AdminWorkQueueData> {
  const client = await createClient();
  const [orders, shipments, inquiries, goods] = await Promise.allSettled([
    client.rpc('admin_search_orders', { p_field: 'all', p_from: null, p_to: null, p_query: null, p_status: 'paid', p_limit: 1, p_offset: 0 }),
    client.rpc('admin_search_shipments', { p_tab: 'ready', p_origin_id: null, p_query: null, p_from: null, p_to: null, p_limit: 1, p_offset: 0 }),
    client.rpc('admin_inquiry_status_counts'),
    client.rpc('admin_search_goods_workspace', { ...goodsWorkspaceQuery(normalizeGoodsListFilters({ readiness: 'review_required' })), p_limit: 0, p_offset: 0 }),
  ]);
  const result = (value: typeof orders): unknown => value.status === 'fulfilled' && !value.value.error ? value.value.data : null;
  const orderRows = result(orders);
  const shipment = result(shipments) as { counts?: { ready?: unknown; delayed?: unknown } } | null;
  const inquiryRows = result(inquiries);
  const goodsResult = result(goods) as { total?: unknown; reasonCounts?: unknown } | null;
  const goodsCount = count(goodsResult?.total);
  const reasons = goodsResult?.reasonCounts;
  const validReasons = reasons !== null && typeof reasons === 'object' && !Array.isArray(reasons)
    && Object.entries(reasons).every(([code, value]) => Object.hasOwn(GOODS_READINESS_REASONS, code) && count(value).state === 'ready');
  return { checkedAt: new Date().toISOString(), counts: {
    orders: Array.isArray(orderRows) ? orderRows.length ? count(orderRows[0].total_count) : count(0) : UNKNOWN,
    ready: count(shipment?.counts?.ready), delayed: count(shipment?.counts?.delayed),
    inquiries: Array.isArray(inquiryRows) ? count(inquiryRows.find(row => row.status === 'open')?.total) : UNKNOWN,
    goods: validReasons ? goodsCount : UNKNOWN,
  }, goodsReasons: validReasons && goodsCount.state === 'ready' ? Object.entries(reasons as Record<string, number>)
    .map(([code, value]) => ({ code: code as GoodsReadinessReasonCode, count: Number(value), href: goodsListHref(normalizeGoodsListFilters({ readiness: code })) })) : [] };
}
