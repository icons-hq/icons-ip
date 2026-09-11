'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';
import { isGoodsShipDate } from '@/lib/goods-preorders';

export interface ShipmentPromiseChange {
  id: string; fromDate: string; toDate: string; reason: string; actorName: string | null; changedAt: string;
}
export interface ShipmentPreorderPromise {
  shipmentId: string; orderId: string; status: 'ready' | 'shipping' | 'delivered' | 'canceled';
  originalExpectedShipDate: string | null; expectedShipDate: string | null; updatedAt: string; changes: ShipmentPromiseChange[];
}
type Failure = { ok: false; error: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function timestamp(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
async function staff() {
  const auth = await getCurrentAdminAuthState();
  return auth.isConfigured && Boolean(auth.user) && auth.isStaff;
}
function parsePromise(value: unknown): ShipmentPreorderPromise | null {
  if (!record(value) || !uuid(value.shipmentId) || !uuid(value.orderId) || !timestamp(value.updatedAt)
    || !['ready', 'shipping', 'delivered', 'canceled'].includes(String(value.status)) || !Array.isArray(value.changes)
    || (value.originalExpectedShipDate !== null && !isGoodsShipDate(value.originalExpectedShipDate))
    || (value.expectedShipDate !== null && !isGoodsShipDate(value.expectedShipDate))) return null;
  const changes: ShipmentPromiseChange[] = [];
  for (const row of value.changes) {
    if (!record(row) || !uuid(row.id) || !isGoodsShipDate(row.fromDate) || !isGoodsShipDate(row.toDate)
      || typeof row.reason !== 'string' || !timestamp(row.changedAt) || (row.actorName !== null && typeof row.actorName !== 'string')) return null;
    changes.push({ id: row.id, fromDate: row.fromDate, toDate: row.toDate, reason: row.reason, actorName: row.actorName as string | null, changedAt: row.changedAt });
  }
  return { shipmentId: value.shipmentId, orderId: value.orderId, status: value.status as ShipmentPreorderPromise['status'],
    originalExpectedShipDate: value.originalExpectedShipDate as string | null, expectedShipDate: value.expectedShipDate as string | null,
    updatedAt: value.updatedAt, changes };
}
export async function readShipmentPreorderPromiseAction(shipmentId: unknown): Promise<{ ok: true; promise: ShipmentPreorderPromise } | Failure> {
  if (!await staff()) return { ok: false, error: '예약 발송 일정은 운영자가 확인할 수 있습니다.' };
  if (!uuid(shipmentId)) return { ok: false, error: '배송 건을 다시 선택해주세요.' };
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_read_shipment_preorder_promise', { p_shipment_id: shipmentId });
    const promise = error ? null : parsePromise(data);
    return promise ? { ok: true, promise } : { ok: false, error: '예약 발송 일정을 불러오지 못했습니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '예약 발송 일정을 불러오지 못했습니다.' }; }
}
export async function changeShipmentPreorderDateAction(formData: FormData): Promise<{ ok: true; message: string } | Failure> {
  if (!await staff()) return { ok: false, error: '예약 발송 일정은 운영자가 변경할 수 있습니다.' };
  const shipmentId = formData.get('shipmentId');
  const date = formData.get('expectedShipDate');
  const expectedVersion = formData.get('updatedAt');
  const reason = String(formData.get('reason') ?? '').trim();
  if (!uuid(shipmentId) || !isGoodsShipDate(date) || !timestamp(expectedVersion) || !reason || reason.length > 2000) {
    return { ok: false, error: '새 발송 예정일과 변경 사유를 입력해주세요.' };
  }
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_change_shipment_preorder_date', {
      p_shipment_id: shipmentId, p_expected_ship_date: date, p_reason: reason, p_expected_updated_at: expectedVersion,
    });
    if (error) return { ok: false, error: error.message === 'shipment_promise_changed'
      ? '배송 건 정보가 변경되었습니다. 일정을 새로고침한 뒤 다시 확인해주세요.'
      : error.message === 'preorder_shipment_already_dispatched' ? '발송 준비 중인 배송 건만 예정일을 변경할 수 있습니다.'
        : '발송 예정일을 변경하지 못했습니다. 새 예정일과 배송 상태를 확인해주세요.' };
    if (!record(data) || typeof data.changed !== 'boolean') return { ok: false, error: '일정 변경 결과를 확인하지 못했습니다. 일정을 새로고침해주세요.' };
    for (const path of ['/admin/sales/orders', '/admin/sales/dispatch', '/admin/sales/shipping', '/orders']) revalidatePath(path);
    revalidatePath('/orders/[orderId]', 'page'); revalidatePath('/admin/sales/orders/[orderId]', 'page');
    return { ok: true, message: data.changed ? '발송 예정일과 변경 사유를 기록했습니다. 주문 당시 예정일은 보존됩니다.' : '이미 같은 발송 예정일로 설정되어 있습니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: '일정 변경 결과를 확인하지 못했습니다. 일정을 새로고침해주세요.' }; }
}
