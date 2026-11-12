'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { shipmentMutationError } from '@/lib/admin/shipment-dispatch';
import { SHIPMENT_EXTRA_TRACKING_REASON_LIMIT } from '@/lib/admin/shipment-tracking';
import { createClient } from '@/lib/supabase/server';
import { isSelectableShippingCarrier, isTrackingNumber, normalizeTrackingNumber } from '@/lib/orders/shipment';
import { getShippingCarrierRegistry } from '@/lib/orders/shipment.server';
import { isUuid } from '@/lib/uuid';

/*
 * 배송 건 추가(연결) 운송장을 운영자가 더하고 지운다(QNA-019 — 회신 파일 오기 정정·김포 분리배송). 운송장 정정과 같은 출고 권한
 * (sales.dispatch, sales.manage가 포함)이고 사유가 필수다. DB가 다른 고객 배송 건의 번호·대표와 같은 번호·발송 전 배송 건을 거절하고,
 * 이력(private)과 감사 기록을 남긴다. operation ID로 같은 요청을 다시 보내도 한 번만 반영한다.
 */
export type ShipmentExtraTrackingResult = { ok: true; message: string } | { ok: false; error: string };

const SHIPPING_PATH = '/admin/sales/shipping';
const access = () => requireAdminActionAccess(SHIPPING_PATH, { capability: 'sales.dispatch' });
const DENIED: ShipmentExtraTrackingResult = { ok: false, error: '출고 처리 권한이 있는 운영자만 추가 운송장을 바꿀 수 있습니다.' };

function refresh() {
  for (const path of ['/admin/sales/shipping', '/admin/sales/orders', '/orders']) revalidatePath(path);
  revalidatePath('/orders/[orderId]', 'page'); revalidatePath('/admin/sales/orders/[orderId]', 'page');
}

function reasonOf(form: FormData): string | null {
  const reason = String(form.get('reason') ?? '').trim();
  return reason && reason.length <= SHIPMENT_EXTRA_TRACKING_REASON_LIMIT ? reason : null;
}

export async function addShipmentExtraTrackingAction(form: FormData): Promise<ShipmentExtraTrackingResult> {
  if (!await access()) return DENIED;
  const shipmentId = String(form.get('shipmentId') ?? ''), operationId = String(form.get('operationId') ?? '');
  const carrier = String(form.get('carrier') ?? '').trim(), trackingNumber = normalizeTrackingNumber(String(form.get('trackingNumber') ?? ''));
  if (!isUuid(shipmentId) || !isUuid(operationId)) return { ok: false, error: '배송 건을 다시 선택해주세요.' };
  const reason = reasonOf(form);
  if (!reason) return { ok: false, error: shipmentMutationError('extra_tracking_reason_required') };
  if (!isSelectableShippingCarrier(await getShippingCarrierRegistry(), carrier)) return { ok: false, error: shipmentMutationError('inactive_shipping_carrier') };
  if (!isTrackingNumber(trackingNumber)) return { ok: false, error: shipmentMutationError('invalid_tracking_input') };
  try {
    const { data, error } = await (await createClient()).rpc('admin_add_shipment_extra_tracking', {
      p_shipment_id: shipmentId, p_carrier: carrier, p_tracking_number: trackingNumber, p_reason: reason, p_operation_id: operationId,
    });
    if (error) return { ok: false, error: shipmentMutationError(error.message) };
    if (!data || typeof data !== 'object' || !['added', 'unchanged'].includes(String((data as { status?: unknown }).status))) {
      return { ok: false, error: '추가 운송장 저장 결과를 확인하지 못했습니다. 화면을 새로고침해주세요.' };
    }
    refresh();
    return { ok: true, message: `추가 운송장 ${trackingNumber}을(를) 붙였습니다. 고객 주문 상세에도 보입니다.` };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '추가 운송장 저장 결과를 확인하지 못했습니다. 같은 내용으로 다시 시도하거나 새로고침해주세요.' };
  }
}

export async function removeShipmentExtraTrackingAction(form: FormData): Promise<ShipmentExtraTrackingResult> {
  if (!await access()) return DENIED;
  const extraTrackingId = String(form.get('extraTrackingId') ?? ''), operationId = String(form.get('operationId') ?? '');
  if (!isUuid(extraTrackingId) || !isUuid(operationId)) return { ok: false, error: '지울 추가 운송장을 다시 선택해주세요.' };
  const reason = reasonOf(form);
  if (!reason) return { ok: false, error: shipmentMutationError('extra_tracking_reason_required') };
  try {
    const { data, error } = await (await createClient()).rpc('admin_remove_shipment_extra_tracking', {
      p_extra_tracking_id: extraTrackingId, p_reason: reason, p_operation_id: operationId,
    });
    if (error) return { ok: false, error: shipmentMutationError(error.message) };
    if (!data || typeof data !== 'object' || !['removed', 'unchanged'].includes(String((data as { status?: unknown }).status))) {
      return { ok: false, error: '추가 운송장 삭제 결과를 확인하지 못했습니다. 화면을 새로고침해주세요.' };
    }
    refresh();
    return { ok: true, message: '추가 운송장을 지웠습니다. 이력과 감사 기록에 사유가 남습니다.' };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '추가 운송장 삭제 결과를 확인하지 못했습니다. 같은 내용으로 다시 시도하거나 새로고침해주세요.' };
  }
}
