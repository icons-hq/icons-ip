'use server';

import { adminOrderActionHref } from '@/lib/admin/orders';
import { isUuid } from '@/lib/uuid';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { createClient } from '@/lib/supabase/server';
import { isGoodsShipDate } from '@/lib/goods-preorders';

export interface ShipmentPromiseChange {
  id: string; fromDate: string; toDate: string; reason: string; actorName: string | null; changedAt: string;
  /** 일괄 변경(예약 주문 일정 일괄 변경)으로 남은 행의 일괄 변경 ID. 개별 변경은 null. */
  bulkChangeId: string | null;
  /** 일정은 그대로 두고 고객에게 안내만 한 행(from=to, 일괄 변경). */
  noticeOnly: boolean;
}
export interface ShipmentPreorderPromise {
  shipmentId: string; orderId: string; status: 'ready' | 'shipping' | 'delivered' | 'canceled';
  originalExpectedShipDate: string | null; expectedShipDate: string | null; updatedAt: string; changes: ShipmentPromiseChange[];
}
type Failure = { ok: false; error: string };
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function timestamp(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function parsePromise(value: unknown): ShipmentPreorderPromise | null {
  if (!record(value) || !isUuid(value.shipmentId) || !isUuid(value.orderId) || !timestamp(value.updatedAt)
    || !['ready', 'shipping', 'delivered', 'canceled'].includes(String(value.status)) || !Array.isArray(value.changes)
    || (value.originalExpectedShipDate !== null && !isGoodsShipDate(value.originalExpectedShipDate))
    || (value.expectedShipDate !== null && !isGoodsShipDate(value.expectedShipDate))) return null;
  const changes: ShipmentPromiseChange[] = [];
  for (const row of value.changes) {
    if (!record(row) || !isUuid(row.id) || !isGoodsShipDate(row.fromDate) || !isGoodsShipDate(row.toDate)
      || typeof row.reason !== 'string' || !timestamp(row.changedAt) || (row.actorName !== null && typeof row.actorName !== 'string')) return null;
    changes.push({ id: row.id, fromDate: row.fromDate, toDate: row.toDate, reason: row.reason, actorName: row.actorName as string | null, changedAt: row.changedAt,
      bulkChangeId: isUuid(row.bulkChangeId) ? row.bulkChangeId : null, noticeOnly: row.noticeOnly === true });
  }
  return { shipmentId: value.shipmentId, orderId: value.orderId, status: value.status as ShipmentPreorderPromise['status'],
    originalExpectedShipDate: value.originalExpectedShipDate as string | null, expectedShipDate: value.expectedShipDate as string | null,
    updatedAt: value.updatedAt, changes };
}
export async function readShipmentPreorderPromiseAction(shipmentId: unknown, orderId?: string): Promise<{ ok: true; promise: ShipmentPreorderPromise } | Failure> {
  if (!await requireAdminActionAccess(adminOrderActionHref(orderId), { capability: 'sales.read' })) return { ok: false, error: '예약 발송 일정을 볼 권한이 없습니다. 주문 조회 권한이 있는 계정으로 로그인해주세요.' };
  if (!isUuid(shipmentId)) return { ok: false, error: '배송 건 정보를 읽지 못했습니다. 주문 상세를 새로고침해주세요.' };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_read_shipment_preorder_promise', { p_shipment_id: shipmentId });
    const promise = error ? null : parsePromise(data);
    return promise ? { ok: true, promise } : { ok: false, error: '예약 발송 일정을 불러오지 못했습니다. [예약 발송 일정 새로고침]을 눌러주세요.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '예약 발송 일정을 불러오지 못했습니다. [예약 발송 일정 새로고침]을 눌러주세요.' }; }
}
export async function changeShipmentPreorderDateAction(formData: FormData): Promise<{ ok: true; message: string } | Failure> {
  if (!await requireAdminActionAccess(adminOrderActionHref(formData.get('orderId')), { capability: 'sales.manage' })) return { ok: false, error: '예약 발송 일정을 바꿀 권한이 없습니다. 주문 관리 권한이 있는 계정으로 로그인해주세요.' };
  const shipmentId = formData.get('shipmentId');
  const date = formData.get('expectedShipDate');
  const expectedVersion = formData.get('updatedAt');
  const reason = String(formData.get('reason') ?? '').trim();
  if (!isUuid(shipmentId) || !isGoodsShipDate(date) || !timestamp(expectedVersion) || !reason || reason.length > 2000) {
    return { ok: false, error: '새 발송 예정일과 변경 사유(2,000자까지)를 입력해주세요.' };
  }
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_change_shipment_preorder_date', {
      p_shipment_id: shipmentId, p_expected_ship_date: date, p_reason: reason, p_expected_updated_at: expectedVersion,
    });
    if (error) return { ok: false, error: error.message === 'shipment_promise_changed'
      ? '다른 화면에서 이 배송 건이 먼저 바뀌었습니다. [예약 발송 일정 새로고침]을 누른 뒤 다시 기록해주세요.'
      : error.message === 'preorder_shipment_already_dispatched' ? '발송 대기 중인 배송 건만 예정일을 바꿀 수 있습니다. 이 배송 건은 이미 발송됐거나 주문이 취소·완료됐습니다.'
        : '발송 예정일을 바꾸지 못했습니다. [예약 발송 일정 새로고침]으로 배송 건 상태를 확인한 뒤 다시 기록해주세요.' };
    if (!record(data) || typeof data.changed !== 'boolean') return { ok: false, error: '발송 예정일이 바뀌었는지 확인하지 못했습니다. [예약 발송 일정 새로고침]을 눌러 변경 이력에 남았는지 먼저 확인해주세요.' };
    for (const path of ['/admin/sales/orders', '/admin/sales/dispatch', '/admin/sales/shipping', '/orders']) revalidatePath(path);
    revalidatePath('/orders/[orderId]', 'page'); revalidatePath('/admin/sales/orders/[orderId]', 'page');
    return { ok: true, message: data.changed ? '발송 예정일과 변경 사유를 기록했습니다. 주문 당시 예정일은 그대로 남습니다.' : '이미 같은 발송 예정일로 설정되어 있습니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '발송 예정일이 바뀌었는지 확인하지 못했습니다. [예약 발송 일정 새로고침]을 눌러 변경 이력에 남았는지 먼저 확인해주세요.' }; }
}
