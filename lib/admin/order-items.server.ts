import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { parseAdminOrderItemData, type AdminOrderItemFilters } from './order-items';
import { loadOrderItemAllocations, loadOrderItemAllocationsForScreen } from './item-allocation.server';
import { loadOrderFulfillmentHolds } from './fulfillment-holds.server';

/** `strictAllocations`: 엑셀은 배분 조회가 실패하면 멈추고, 화면은 배분 칸만 비운다. */
/**
 * 상품주문 목록 화면의 추가(연결) 운송장(QNA-019). 주문 조회 운영자의 RLS 읽기라 목록과 같은 권한이다. 읽지 못하면 대표 운송장만
 * 보이던 종전 화면으로 둔다(보조 표시라 목록을 막지 않는다). 엑셀(strict)은 열이 없어 읽지 않는다.
 */
async function loadExtraTrackingNumbers(client: Awaited<ReturnType<typeof createClient>>, shipmentIds: string[]): Promise<Map<string, string[]> | null> {
  const ids = [...new Set(shipmentIds)];
  if (!ids.length) return null;
  const { data, error } = await client.from('order_shipment_extra_trackings').select('id,shipment_id,tracking_number,created_at').in('shipment_id', ids)
    .order('created_at').order('id');
  if (error || !Array.isArray(data)) return null;
  const numbers = new Map<string, string[]>();
  for (const row of data as { shipment_id: string; tracking_number: string }[]) numbers.set(row.shipment_id, [...(numbers.get(row.shipment_id) ?? []), row.tracking_number]);
  return numbers;
}

/**
 * 출고 보류 중인 주문(I-01). 일괄 발주확인 대상인 신규주문 줄만 본다 — 보류 주문은 DB가 발주확인을 거절하므로 화면이 그 줄의 체크칸을 뺀다.
 * 읽지 못하면 체크칸을 그대로 둔다(보조 표시라 목록을 막지 않고, 판정은 DB가 한다). 엑셀(strict)은 열이 없어 읽지 않는다.
 */
async function loadHeldOrderIds(client: Awaited<ReturnType<typeof createClient>>, orderIds: string[]): Promise<Set<string> | null> {
  const ids = [...new Set(orderIds)];
  if (!ids.length) return null;
  try {
    const holds = await loadOrderFulfillmentHolds(ids, client);
    return new Set([...holds].filter(([, list]) => list.length > 0).map(([orderId]) => orderId));
  } catch (error) {
    /* 로그인 이동 같은 Next 내부 신호는 삼키지 않는다. */
    unstable_rethrow(error);
    return null;
  }
}

export async function getAdminOrderItemData(filters: AdminOrderItemFilters, limit = filters.pageSize ?? 20, options: { strictAllocations?: boolean } = {}) {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_search_order_items_console', {
    p_status: filters.status === 'all' ? null : filters.status, p_from: filters.from, p_to: filters.to, p_query: filters.query || null,
    p_limit: limit, p_offset: (filters.page - 1) * limit, p_field: filters.field, p_date_field: filters.dateField ?? 'ordered',
    p_sort: filters.sort ?? 'newest', p_payment_method: filters.paymentMethod ?? null,
  });
  const result = parseAdminOrderItemData(data, filters);
  if (error || !result) throw new Error('Failed to load order item console');
  const orderIds = result.rows.map(row => row.orderId);
  const allocations = options.strictAllocations ? await loadOrderItemAllocations(orderIds, client) : await loadOrderItemAllocationsForScreen(orderIds);
  const extras = options.strictAllocations ? null : await loadExtraTrackingNumbers(client, result.rows.flatMap(row => row.shipmentId ? [row.shipmentId] : []));
  const held = options.strictAllocations ? null : await loadHeldOrderIds(client, result.rows.flatMap(row => row.status === 'paid' ? [row.orderId] : []));
  return { ...result, rows: result.rows.map(row => {
    const numbers = row.shipmentId ? extras?.get(row.shipmentId) : undefined;
    return { ...row, allocation: allocations?.get(row.id)?.allocation ?? null, ...(numbers?.length ? { extraTrackingNumbers: numbers } : {}),
      ...(held?.has(row.orderId) ? { fulfillmentHold: true } : {}) };
  }) };
}
