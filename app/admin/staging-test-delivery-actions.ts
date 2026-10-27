'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { AUTO_ORDER_CONFIRMATION_PATH } from '@/lib/admin/auto-order-confirmation';
import { ORDER_NUMBER_PATTERN, parseStagingTestDeliveryReceipt, stagingTestDeliveryError, type StagingTestDeliveryReceipt } from '@/lib/admin/staging-test-tools';
import { stagingTestToolsRuntimeAllowed } from '@/lib/admin/staging-test-tools.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

export type StagingTestDeliveryResult = { receipt: StagingTestDeliveryReceipt } | { error: string };

/** 스테이징 전용 테스트 배송완료. 운영 런타임은 DB 호출 전에 거절하고, DB도 허용 행이 없으면 거절한다. */
export async function markStagingTestDeliveredAction(orderNumber: unknown, operationId: unknown): Promise<StagingTestDeliveryResult> {
  try {
    if (!stagingTestToolsRuntimeAllowed()) return { error: stagingTestDeliveryError(undefined, 'staging_test_delivery_unavailable') };
    if (!await requireAdminActionAccess(AUTO_ORDER_CONFIRMATION_PATH, { capability: 'sales.manage' })) return { error: stagingTestDeliveryError('42501') };
    if (typeof orderNumber !== 'string' || !ORDER_NUMBER_PATTERN.test(orderNumber) || !isUuid(operationId)) return { error: stagingTestDeliveryError(undefined, 'invalid_staging_test_delivery') };
    const { data, error } = await (await createClient()).rpc('admin_mark_staging_test_delivered', { p_order_number: orderNumber, p_operation_id: operationId });
    if (error) return { error: stagingTestDeliveryError(error.code, error.message) };
    const receipt = parseStagingTestDeliveryReceipt(data);
    if (!receipt || receipt.orderNumber !== orderNumber) return { error: stagingTestDeliveryError() };
    revalidatePath(AUTO_ORDER_CONFIRMATION_PATH); revalidatePath('/admin/sales/shipping'); revalidatePath(`/admin/sales/orders/${receipt.orderId}`);
    return { receipt };
  } catch (error) { unstable_rethrow(error); return { error: stagingTestDeliveryError() }; }
}
