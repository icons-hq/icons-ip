'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { SHIPMENT_REVERT_REASON_MAX, SHIPMENT_REVERT_REASON_MIN, shipmentRevertError } from '@/lib/admin/shipment-revert';
import { objectParticle } from '@/lib/korean-particle';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

/*
 * 배송 상태 오처리 정정(원장 #14 SHP-048, ADR-0045). 엉뚱한 배송 건을 배송완료·발송 처리한 것을 한 단계 되돌린다.
 * 권한은 판매 관리(sales.manage) — 출고 담당(sales.dispatch)보다 넓고 강제 배송완료와 같다. DB가 권한·조건을 다시 보고,
 * 사유·작업 ID 재전송·화면이 본 값 대조·감사를 맡는다.
 */
export type ShipmentRevertResult = { ok: true; tone: 'success' | 'warning'; message: string } | { ok: false; error: string };

const PATH = '/admin/sales/shipping';
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const DENIED: ShipmentRevertResult = { ok: false, error: shipmentRevertError('operator_capability_required') };

function refresh(orderId: unknown) {
  for (const path of ['/admin/sales/shipping', '/admin/sales/dispatch', '/admin/sales/orders', '/orders']) revalidatePath(path);
  revalidatePath('/orders/[orderId]', 'page'); revalidatePath('/admin/sales/orders/[orderId]', 'page');
  if (typeof orderId === 'string' && isUuid(orderId)) revalidatePath(`/admin/sales/orders/${orderId}`);
}
function reasonOf(value: unknown): string | null {
  const reason = typeof value === 'string' ? value.trim() : '';
  return reason.length >= SHIPMENT_REVERT_REASON_MIN && reason.length <= SHIPMENT_REVERT_REASON_MAX ? reason : null;
}
function referenceOf(value: unknown, shipmentId: string) {
  return typeof value === 'string' && /^[0-9A-Za-z-]{1,40}$/.test(value) ? value : shipmentId.slice(-8).toUpperCase();
}
type Receipt = { orderId?: unknown; orderCount?: unknown; emailSent?: unknown; shipmentId?: unknown; shipmentStatus?: unknown };
function receiptOf(data: unknown, shipmentId: string): Receipt | null {
  return data && typeof data === 'object' && (data as Receipt).shipmentId === shipmentId ? data as Receipt : null;
}

export async function revertShipmentDeliveryAction(input: { shipmentId: unknown; reason: unknown; operationId: unknown; expectedDeliveredAt: unknown; reference?: unknown }): Promise<ShipmentRevertResult> {
  try {
    if (!await requireAdminActionAccess(PATH, { capability: 'sales.manage' })) return DENIED;
    const { shipmentId, operationId, expectedDeliveredAt } = input;
    if (typeof shipmentId !== 'string' || !isUuid(shipmentId) || !isUuid(operationId) || typeof expectedDeliveredAt !== 'string' || !INSTANT.test(expectedDeliveredAt)) {
      return { ok: false, error: shipmentRevertError('invalid_shipment_revert') };
    }
    const reason = reasonOf(input.reason);
    if (!reason) return { ok: false, error: shipmentRevertError('shipment_revert_reason_required') };
    const { data, error } = await (await createClient()).rpc('admin_revert_shipment_delivery', {
      p_shipment_id: shipmentId.toLowerCase(), p_reason: reason, p_operation_id: operationId, p_expected_delivered_at: expectedDeliveredAt,
    });
    if (error) return { ok: false, error: shipmentRevertError(error.message) };
    const receipt = receiptOf(data, shipmentId.toLowerCase());
    if (!receipt) return { ok: false, error: shipmentRevertError() };
    refresh(receipt.orderId);
    const reference = referenceOf(input.reference, shipmentId);
    const count = Number(receipt.orderCount);
    const pack = count > 1 ? `(합포장으로 주문 ${count}건 함께)` : '';
    // 운송장 없이 강제 배송완료한 건은 발송된 적이 없어 발송 대기로(주문은 발주확인으로) 돌아간다.
    if (receipt.shipmentStatus === 'ready') return { ok: true, tone: 'success', message: `배송 건 ${reference}${objectParticle(reference)} 발송 대기로 되돌렸습니다${pack}. `
      + '운송장 없이 강제 배송완료한 건이라 주문은 발주확인으로 돌아갔습니다. 실제로 발송하면 운송장을 등록해 발송 처리해주세요. 사유는 감사 기록에 남았습니다.' };
    return { ok: true, tone: 'success', message: `배송 건 ${reference}${objectParticle(reference)} 배송중으로 되돌렸습니다${pack}. `
      + '실제 도착을 확인하면 택배사 배송완료 일시를 넣어 다시 배송완료 처리해주세요. 사유는 감사 기록에 남았습니다.' };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: shipmentRevertError() }; }
}

export async function revertShipmentDispatchAction(input: { shipmentId: unknown; reason: unknown; operationId: unknown; expectedTrackingNumber: unknown; reference?: unknown }): Promise<ShipmentRevertResult> {
  try {
    if (!await requireAdminActionAccess(PATH, { capability: 'sales.manage' })) return DENIED;
    const { shipmentId, operationId, expectedTrackingNumber } = input;
    const tracking = typeof expectedTrackingNumber === 'string' ? expectedTrackingNumber.trim().toUpperCase() : expectedTrackingNumber === null ? '' : null;
    if (typeof shipmentId !== 'string' || !isUuid(shipmentId) || !isUuid(operationId) || tracking === null || (tracking && !/^[A-Z0-9]{8,30}$/.test(tracking))) {
      return { ok: false, error: shipmentRevertError('invalid_shipment_revert') };
    }
    const reason = reasonOf(input.reason);
    if (!reason) return { ok: false, error: shipmentRevertError('shipment_revert_reason_required') };
    const { data, error } = await (await createClient()).rpc('admin_revert_shipment_dispatch', {
      p_shipment_id: shipmentId.toLowerCase(), p_reason: reason, p_operation_id: operationId, p_expected_tracking_number: tracking,
    });
    if (error) return { ok: false, error: shipmentRevertError(error.message) };
    const receipt = receiptOf(data, shipmentId.toLowerCase());
    if (!receipt) return { ok: false, error: shipmentRevertError() };
    refresh(receipt.orderId);
    const reference = referenceOf(input.reference, shipmentId);
    const count = Number(receipt.orderCount);
    const sent = receipt.emailSent === true;
    return { ok: true, tone: sent ? 'warning' : 'success', message: `배송 건 ${reference}${objectParticle(reference)} 발송 대기로 되돌렸습니다${count > 1 ? `(합포장으로 주문 ${count}건 함께)` : ''}. `
      + '올바른 운송장으로 다시 발송 처리해주세요.'
      + (sent ? ' 배송 안내 메일이 이미 나갔습니다. 다시 발송처리해도 같은 배송 건의 메일은 다시 보내지 않으니 고객에게 올바른 운송장을 직접 안내해주세요.' : '') };
  } catch (error) { unstable_rethrow(error); return { ok: false, error: shipmentRevertError() }; }
}
