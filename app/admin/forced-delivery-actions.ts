'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { AUTO_ORDER_CONFIRMATION_PATH } from '@/lib/admin/auto-order-confirmation';
import {
  FORCED_DELIVERY_REASON_MAX_LENGTH, forcedDeliveryError, normalizeForcedDeliveryOrderNumber, parseForcedDeliveryPreview, parseForcedDeliveryReceipt,
  type ForcedDeliveryPreview, type ForcedDeliveryReceipt,
} from '@/lib/admin/forced-delivery';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

/*
 * 운영 강제 배송완료(1014-083). 스테이징 전용이던 테스트 배송완료를 운영에서도 연다 — 대신 사유 필수, 확인창(미리보기),
 * 같은 요청 번호 재전송, 감사 기록. 권한은 배송 처리 권한(sales.manage)이고 DB가 다시 확인한다.
 */
export type ForcedDeliveryPreviewResult = { preview: ForcedDeliveryPreview } | { error: string };
export type ForcedDeliveryResult = { receipt: ForcedDeliveryReceipt } | { error: string };

export async function previewForcedDeliveryAction(orderNumber: unknown): Promise<ForcedDeliveryPreviewResult> {
  try {
    if (!await requireAdminActionAccess(AUTO_ORDER_CONFIRMATION_PATH, { capability: 'sales.manage' })) return { error: forcedDeliveryError('42501') };
    const value = normalizeForcedDeliveryOrderNumber(orderNumber);
    if (!value) return { error: forcedDeliveryError(undefined, 'invalid_forced_delivery') };
    const { data, error } = await (await createClient()).rpc('admin_force_order_delivery_preview', { p_order_number: value });
    if (error) return { error: forcedDeliveryError(error.code, error.message) };
    const preview = parseForcedDeliveryPreview(data);
    return preview && preview.orderNumber === value ? { preview } : { error: forcedDeliveryError() };
  } catch (error) { unstable_rethrow(error); return { error: forcedDeliveryError() }; }
}

export async function forceOrderDeliveredAction(orderNumber: unknown, reason: unknown, operationId: unknown): Promise<ForcedDeliveryResult> {
  try {
    if (!await requireAdminActionAccess(AUTO_ORDER_CONFIRMATION_PATH, { capability: 'sales.manage' })) return { error: forcedDeliveryError('42501') };
    const value = normalizeForcedDeliveryOrderNumber(orderNumber);
    const trimmed = typeof reason === 'string' ? reason.trim() : '';
    if (!value || !isUuid(operationId)) return { error: forcedDeliveryError(undefined, 'invalid_forced_delivery') };
    if (!trimmed || trimmed.length > FORCED_DELIVERY_REASON_MAX_LENGTH) return { error: forcedDeliveryError(undefined, 'forced_delivery_reason_required') };
    const { data, error } = await (await createClient()).rpc('admin_force_order_delivered', { p_order_number: value, p_reason: trimmed, p_operation_id: operationId });
    if (error) return { error: forcedDeliveryError(error.code, error.message) };
    const receipt = parseForcedDeliveryReceipt(data);
    if (!receipt || receipt.orderNumber !== value) return { error: forcedDeliveryError() };
    revalidatePath(AUTO_ORDER_CONFIRMATION_PATH); revalidatePath('/admin/sales/shipping'); revalidatePath('/admin/sales/orders');
    revalidatePath(`/admin/sales/orders/${receipt.orderId}`); revalidatePath('/orders/[orderId]', 'page'); revalidatePath('/orders');
    return { receipt };
  } catch (error) { unstable_rethrow(error); return { error: forcedDeliveryError() }; }
}
