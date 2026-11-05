import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { GOODS_READINESS_REASONS, type GoodsReadinessReasonCode } from './goods-readiness';
import { goodsListHref, normalizeGoodsListFilters } from './goods-list';
import { goodsWorkspaceQuery } from './goods-list.server';
import { parseRefundTransferPage, REFUND_TRANSFERS_PAGE_SIZE } from './refund-transfers';
import type { AdminWorkQueueCount, AdminWorkQueueData } from './work-queue';

const UNKNOWN: AdminWorkQueueCount = { state: 'error', count: null };
const HIDDEN: AdminWorkQueueCount = { state: 'hidden', count: null };
function count(value: unknown): AdminWorkQueueCount {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  return typeof number === 'number' && Number.isSafeInteger(number) && number >= 0 ? { state: 'ready', count: number } : UNKNOWN;
}
/** 목록 RPC가 행마다 싣는 `total_count`. 빈 배열은 확인된 0건이다. */
function rowsTotal(rows: unknown): AdminWorkQueueCount {
  if (!Array.isArray(rows)) return UNKNOWN;
  return rows.length ? count((rows[0] as { total_count?: unknown } | null)?.total_count) : count(0);
}
function refundTotal(value: unknown): AdminWorkQueueCount {
  const page = value === null ? null : parseRefundTransferPage(value, 1);
  return page ? count(page.total) : UNKNOWN;
}
/** 권한이 필요한 대기열의 노출 범위. 호출부가 화면 권한(`canAccessAdminScreen`)으로 정한다. */
export interface AdminWorkQueueScope { unpaid: boolean; refundTransfers: boolean }
const NO_SCOPED_QUEUES: AdminWorkQueueScope = { unpaid: false, refundTransfers: false };

/** Reuse list RPCs, including the shipment console's preorder delay definition.
 * One summary per domain; no order/line downloads or bespoke SLA calculation. */
export async function loadAdminWorkQueue(scope: AdminWorkQueueScope = NO_SCOPED_QUEUES): Promise<AdminWorkQueueData> {
  const client = await createClient();
  const skipped = Promise.resolve({ data: null, error: null });
  const [orders, shipments, inquiries, goods, unpaid, refunds] = await Promise.allSettled([
    client.rpc('admin_search_orders', { p_field: 'all', p_from: null, p_to: null, p_query: null, p_status: 'paid', p_limit: 1, p_offset: 0 }),
    client.rpc('admin_search_shipments', { p_tab: 'ready', p_origin_id: null, p_query: null, p_from: null, p_to: null, p_limit: 1, p_offset: 0 }),
    client.rpc('admin_inquiry_status_counts'),
    client.rpc('admin_search_goods_workspace', { ...goodsWorkspaceQuery(normalizeGoodsListFilters({ readiness: 'review_required' })), p_limit: 0, p_offset: 0 }),
    /* 미결제 확인 목록과 같은 기본 범위(상태 필터 없음)의 전체 건수. */
    scope.unpaid
      ? client.rpc('admin_unpaid_bank_transfer_orders_console', { p_query: null, p_limit: 1, p_offset: 0, p_state: null, p_sort: 'oldest' })
      : skipped,
    /* 환불 송금 대기 1페이지와 같은 호출 — 파서가 응답의 limit·offset까지 검증한다. 계좌 정보는 이 RPC에 없다. */
    scope.refundTransfers ? client.rpc('admin_list_bank_transfer_refunds_numbered', { p_limit: REFUND_TRANSFERS_PAGE_SIZE, p_offset: 0 }) : skipped,
  ]);
  const result = (value: PromiseSettledResult<{ data: unknown; error: unknown }>): unknown => value.status === 'fulfilled' && !value.value.error ? value.value.data : null;
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
    unpaid: scope.unpaid ? rowsTotal(result(unpaid)) : HIDDEN,
    refundTransfers: scope.refundTransfers ? refundTotal(result(refunds)) : HIDDEN,
  }, goodsReasons: validReasons && goodsCount.state === 'ready' ? Object.entries(reasons as Record<string, number>)
    .map(([code, value]) => ({ code: code as GoodsReadinessReasonCode, count: Number(value), href: goodsListHref(normalizeGoodsListFilters({ readiness: code })) })) : [] };
}
