'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import {
  normalizeCanceledDispatchResolution,
  normalizeWarehouseStopReplyInput,
  parseOrderWarehouseStopContext,
  warehouseStopErrorMessage,
  type OrderWarehouseStopContext,
} from '@/lib/admin/warehouse-stop';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

export type WarehouseStopActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

function refresh(orderId: string) {
  for (const path of ['/admin/sales/orders', `/admin/sales/orders/${orderId}`, '/admin/sales/dispatch', '/admin/sales/shipping']) revalidatePath(path);
  revalidatePath('/admin');
}

/**
 * 주문 상세·주문 패널의 창고 회신·취소 뒤 출고 발견(ADR-0046). 주문 조회 권한(sales.read)이면 읽고,
 * 기록·처리 버튼은 DB가 알려주는 canRecord(sales.dispatch)·canResolve(sales.manage)로만 그린다.
 */
export async function loadOrderWarehouseStopAction(orderId: unknown): Promise<WarehouseStopActionResult<OrderWarehouseStopContext>> {
  const id = typeof orderId === 'string' && isUuid(orderId) ? orderId.toLowerCase() : null;
  if (!id) return { ok: false, error: '주문을 확인해주세요.' };
  if (!await requireAdminActionAccess(`/admin/sales/orders/${id}`, { capability: 'sales.read' })) {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }
  try {
    const { data, error } = await (await createClient()).rpc('admin_order_warehouse_stop_context', { p_order_id: id });
    if (error) return { ok: false, error: warehouseStopErrorMessage(error.message) };
    const context = parseOrderWarehouseStopContext(data);
    return context ? { ok: true, value: context } : { ok: false, error: '창고 회신 기록을 읽지 못했습니다. 새로고침해주세요.' };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '창고 회신 기록을 읽지 못했습니다. 새로고침해주세요.' };
  }
}

/**
 * 창고 회신 기록(출고 담당 sales.dispatch — sales.manage가 포함한다). 출고지시가 나간 배송 건의 창고 회신을 남긴다.
 * '출고 중단 확인'은 운영자 전액·부분 취소의 근거가 되고, 이미 취소된 배송 건의 '이미 출고'는 취소 뒤 출고 발견을 만든다.
 * 같은 요청번호의 재요청은 처음 결과를 돌려준다.
 */
export async function recordWarehouseStopReplyAction(input: unknown): Promise<WarehouseStopActionResult<{ message: string }>> {
  const normalized = normalizeWarehouseStopReplyInput(input);
  if (!normalized.ok) return normalized;
  const { orderId, shipmentIds, outcome, channel, repliedAt, note, operationId } = normalized.value;
  if (!await requireAdminActionAccess(`/admin/sales/orders/${orderId}`, { capability: 'sales.dispatch' })) {
    return { ok: false, error: '창고 회신을 기록할 권한이 없습니다.' };
  }
  try {
    const { data, error } = await (await createClient()).rpc('admin_record_warehouse_stop_reply', {
      p_shipment_ids: shipmentIds, p_outcome: outcome, p_channel: channel, p_replied_at: repliedAt, p_note: note, p_operation_id: operationId,
    });
    if (error) return { ok: false, error: warehouseStopErrorMessage(error.message) };
    const result = data as { orderId?: unknown; discoveryIds?: unknown } | null;
    if (!result || result.orderId !== orderId) return { ok: false, error: '기록 결과를 확인하지 못했습니다. 새로고침해 회신 기록을 확인해주세요.' };
    refresh(orderId);
    const discovered = Array.isArray(result.discoveryIds) ? result.discoveryIds.length : 0;
    return { ok: true, value: { message: discovered
      ? `창고 회신을 기록했습니다. 이미 취소된 배송 건 ${discovered}건을 취소 뒤 출고 발견으로 남기고 재고를 다시 뺐습니다. 고객 연락과 회수를 진행해주세요.`
      : outcome === 'stopped'
        ? '창고의 출고 중단 회신을 기록했습니다. 이 회신을 근거로 전액·부분 취소를 한 번 실행할 수 있습니다.'
        : '창고의 이미 출고 회신을 기록했습니다. 이 배송 건은 취소하지 말고 운송장 회신을 받아 발송 처리한 뒤 고객 반품으로 접수해주세요.' } };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '기록 결과를 확인하지 못했습니다. 새로고침해 회신 기록을 확인해주세요.' };
  }
}

/**
 * 취소 뒤 출고 발견 처리(주문 처리 sales.manage). 회수 입고면 발견 때 다시 뺀 재고를 되돌리고, 손실이면 그대로 둔다.
 * 근거 메모는 5자 이상이고 감사에 남는다. 한 번만 처리하며 같은 요청번호의 재요청은 처음 결과를 돌려준다.
 */
export async function resolveCanceledShipmentDispatchAction(input: unknown): Promise<WarehouseStopActionResult<{ message: string }>> {
  const normalized = normalizeCanceledDispatchResolution(input);
  if (!normalized.ok) return normalized;
  const { orderId, dispatchId, outcome, note, operationId } = normalized.value;
  if (!await requireAdminActionAccess(`/admin/sales/orders/${orderId}`, { capability: 'sales.manage' })) {
    return { ok: false, error: '취소 뒤 출고를 처리할 권한이 없습니다.' };
  }
  try {
    const { data, error } = await (await createClient()).rpc('admin_resolve_canceled_shipment_dispatch', {
      p_dispatch_id: dispatchId, p_outcome: outcome, p_note: note, p_operation_id: operationId,
    });
    if (error) return { ok: false, error: warehouseStopErrorMessage(error.message) };
    const result = data as { orderId?: unknown; state?: unknown; returnedQty?: unknown } | null;
    if (!result || result.orderId !== orderId || result.state !== outcome) {
      return { ok: false, error: '처리 결과를 확인하지 못했습니다. 새로고침해 기록을 확인해주세요.' };
    }
    refresh(orderId);
    return { ok: true, value: { message: outcome === 'returned'
      ? `회수 입고로 처리했습니다. 발견 때 뺀 재고 ${typeof result.returnedQty === 'number' ? result.returnedQty : 0}개를 되돌렸습니다.`
      : '손실로 처리했습니다. 재고는 발견 때 뺀 그대로입니다.' } };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '처리 결과를 확인하지 못했습니다. 새로고침해 기록을 확인해주세요.' };
  }
}
