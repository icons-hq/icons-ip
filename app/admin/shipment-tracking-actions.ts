'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { shipmentMutationError } from '@/lib/admin/shipment-dispatch';
import { SHIPMENT_EXTRA_TRACKING_REASON_LIMIT } from '@/lib/admin/shipment-tracking';
import { createClient } from '@/lib/supabase/server';
import { carrierTrackingNumberIssue, findShippingCarrier, isSelectableShippingCarrier, isTrackingNumber, normalizeTrackingNumber } from '@/lib/orders/shipment';
import { getShippingCarrierRegistry } from '@/lib/orders/shipment.server';
import { enqueueOrderShippedEmails } from '@/lib/email/order-shipment-jobs.server';
import { objectParticle } from '@/lib/korean-particle';
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
  const registry = await getShippingCarrierRegistry();
  if (!isSelectableShippingCarrier(registry, carrier)) return { ok: false, error: shipmentMutationError('inactive_shipping_carrier') };
  if (!isTrackingNumber(trackingNumber)) return { ok: false, error: shipmentMutationError('invalid_tracking_input') };
  // 택배사별 형식(레지스트리)은 DB 등록 판정이 다시 본다. 여기서는 어느 규칙인지 먼저 알린다.
  const formatIssue = carrierTrackingNumberIssue(findShippingCarrier(registry, carrier)!, trackingNumber);
  if (formatIssue) return { ok: false, error: formatIssue };
  try {
    const { data, error } = await (await createClient()).rpc('admin_add_shipment_extra_tracking', {
      p_shipment_id: shipmentId, p_carrier: carrier, p_tracking_number: trackingNumber, p_reason: reason, p_operation_id: operationId,
    });
    if (error) return { ok: false, error: shipmentMutationError(error.message) };
    if (!data || typeof data !== 'object' || !['added', 'unchanged'].includes(String((data as { status?: unknown }).status))) {
      return { ok: false, error: '추가 운송장 저장 결과를 확인하지 못했습니다. 화면을 새로고침해주세요.' };
    }
    refresh();
    return { ok: true, message: `추가 운송장 ${trackingNumber}${objectParticle(trackingNumber)} 붙였습니다. 고객 주문 상세에도 보입니다.` };
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

/**
 * 뒤바뀐 운송장 맞바꾸기(SHP-031). 두 주문의 운송장이 서로 바뀌어 등록되면 운송장 정정은 상대 번호가 다른 주문에 쓰였다며 거절한다.
 * 이 배송 건과 상대 배송 건(합포장이면 묶음 전체)의 대표 운송장을 DB가 한 번에 맞바꾼다. 화면이 본 두 번호가 지금 값과 같을 때만
 * 바꾸므로 같은 요청을 다시 보내도 되돌아가지 않는다. 출고 권한·사유 필수, 두 배송 건 모두 감사 기록에 남는다.
 */
export async function swapShipmentTrackingAction(form: FormData): Promise<ShipmentExtraTrackingResult> {
  if (!await access()) return { ok: false, error: '출고 처리 권한이 있는 운영자만 운송장을 맞바꿀 수 있습니다.' };
  const shipmentId = String(form.get('shipmentId') ?? '');
  const expected = normalizeTrackingNumber(String(form.get('expectedTrackingNumber') ?? ''));
  // 화면의 배송건번호(16자리)는 띄어 써도 받는다. 전체 UUID는 그대로 넘긴다.
  const rawReference = String(form.get('otherReference') ?? '').trim(), compactReference = rawReference.replace(/[\s-]/g, '');
  const otherReference = isUuid(rawReference) ? rawReference : compactReference;
  const otherTracking = normalizeTrackingNumber(String(form.get('otherTrackingNumber') ?? ''));
  if (!isUuid(shipmentId) || !isTrackingNumber(expected)) return { ok: false, error: '배송 건을 다시 선택해주세요.' };
  if (!otherReference) return { ok: false, error: '맞바꿀 상대 배송건번호를 입력해주세요.' };
  if (!isTrackingNumber(otherTracking)) return { ok: false, error: '상대 배송 건에 지금 등록된 운송장번호를 입력해주세요.' };
  const reason = reasonOf(form);
  if (!reason) return { ok: false, error: shipmentMutationError('tracking_swap_reason_required') };
  try {
    const { data, error } = await (await createClient()).rpc('admin_swap_shipment_trackings', {
      p_shipment_id: shipmentId, p_expected_tracking: expected, p_other_reference: otherReference, p_expected_other_tracking: otherTracking, p_reason: reason,
    });
    if (error) return { ok: false, error: shipmentMutationError(error.message) };
    const result = data as { status?: unknown; trackingNumber?: unknown; otherTrackingNumber?: unknown } | null;
    if (!result || result.status !== 'swapped' || typeof result.trackingNumber !== 'string' || typeof result.otherTrackingNumber !== 'string') {
      return { ok: false, error: '맞바꾼 결과를 확인하지 못했습니다. 화면을 새로고침해 두 배송 건의 운송장을 확인해주세요.' };
    }
    refresh();
    return { ok: true, message: `운송장을 맞바꿨습니다. 이 배송 건은 ${result.trackingNumber}, 상대 배송 건은 ${result.otherTrackingNumber}입니다. 두 배송 건 모두 감사 기록에 사유가 남습니다.` };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '맞바꾼 결과를 확인하지 못했습니다. 화면을 새로고침해 두 배송 건의 운송장을 확인해주세요.' };
  }
}

/**
 * 중복 확인 후 등록(SHP-030 리뷰 2). 판정이 다른 주문의 쓰임으로 거절했지만 창고에 확인해 같은 상자가 맞는 경우(7일이 지난 합배송 확인,
 * 받는 분 표기가 달라 같은 집으로 묶이지 않은 경우 등) 사유를 적어 그 배송 건에 그 번호를 등록한다. 택배사 형식은 그대로 본다.
 * 발송 대기 건은 발송처리(배송 메일 대기열), 발송된 건은 운송장 정정과 같다. DB가 승인·감사 기록을 남긴다.
 */
export async function registerDuplicateShipmentTrackingAction(form: FormData): Promise<ShipmentExtraTrackingResult> {
  if (!await access()) return { ok: false, error: '출고 처리 권한이 있는 운영자만 중복 확인 후 등록할 수 있습니다.' };
  const shipmentId = String(form.get('shipmentId') ?? '');
  const carrier = String(form.get('carrier') ?? '').trim(), trackingNumber = normalizeTrackingNumber(String(form.get('trackingNumber') ?? ''));
  if (!isUuid(shipmentId)) return { ok: false, error: shipmentMutationError('invalid_tracking_duplicate') };
  const reason = reasonOf(form);
  if (!reason) return { ok: false, error: shipmentMutationError('tracking_duplicate_reason_required') };
  const registry = await getShippingCarrierRegistry();
  if (!isSelectableShippingCarrier(registry, carrier)) return { ok: false, error: shipmentMutationError('inactive_shipping_carrier') };
  if (!isTrackingNumber(trackingNumber)) return { ok: false, error: shipmentMutationError('invalid_tracking_input') };
  const formatIssue = carrierTrackingNumberIssue(findShippingCarrier(registry, carrier)!, trackingNumber);
  if (formatIssue) return { ok: false, error: formatIssue };
  try {
    const { data, error } = await (await createClient()).rpc('admin_register_shipment_tracking_duplicate', {
      p_shipment_id: shipmentId, p_carrier: carrier, p_tracking_number: trackingNumber, p_reason: reason,
    });
    if (error) return { ok: false, error: shipmentMutationError(error.message) };
    const result = data as { status?: unknown; packedShipments?: unknown } | null;
    if (!result || (result.status !== 'dispatched' && result.status !== 'corrected')) {
      return { ok: false, error: '등록 결과를 확인하지 못했습니다. 화면을 새로고침해 배송 상태를 확인해주세요.' };
    }
    let queueWarning = false;
    if (result.status === 'dispatched') {
      const deliveries = Array.isArray(result.packedShipments) ? (result.packedShipments as { orderId?: unknown; shipmentId?: unknown }[])
        .filter(row => typeof row.orderId === 'string' && typeof row.shipmentId === 'string') as { orderId: string; shipmentId: string }[] : [];
      try { if (deliveries.length) await enqueueOrderShippedEmails(deliveries); } catch { queueWarning = true; }
      revalidatePath('/admin/sales/dispatch');
    }
    refresh();
    return { ok: true, message: result.status === 'dispatched'
      ? `중복을 확인하고 운송장 ${trackingNumber}${objectParticle(trackingNumber)} 등록해 배송 중으로 옮겼습니다.${queueWarning ? ' 배송 안내 메일 발송 예약을 확인하지 못했습니다. 주문 상세의 배송 메일 처리 상태에서 확인해주세요.' : ''} 사유가 감사 기록에 남습니다.`
      : `중복을 확인하고 운송장을 고쳤습니다(${trackingNumber}). 사유가 감사 기록에 남습니다.` };
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: '등록 결과를 확인하지 못했습니다. 화면을 새로고침해 배송 상태를 확인해주세요.' };
  }
}
