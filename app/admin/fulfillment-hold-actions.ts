'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { FULFILLMENT_HOLD_REASONS, fulfillmentHoldReleaseError, type FulfillmentHoldReason } from '@/lib/admin/fulfillment-holds';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

export type FulfillmentHoldReleaseResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * 출고 보류 해제(sales.manage). 사유는 5~500자이고 감사 기록에 남는다. 같은 요청번호의 재요청은 처음 결과를 돌려준다.
 * 해제해도 DB의 다른 출고 조건(취소 요청·예약 입고 확인 등)은 그대로다.
 */
export async function releaseOrderFulfillmentHoldAction(input: {
  orderId: string; reason: FulfillmentHoldReason; note: string; operationId: string;
}): Promise<FulfillmentHoldReleaseResult> {
  const orderId = typeof input?.orderId === 'string' ? input.orderId : '';
  const auth = await requireAdminActionAccess(isUuid(orderId) ? `/admin/sales/orders/${orderId}` : '/admin/sales/orders', { capability: 'sales.manage' });
  if (!auth) return { ok: false, error: fulfillmentHoldReleaseError('42501') };
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (!isUuid(orderId) || !isUuid(input.operationId) || !(FULFILLMENT_HOLD_REASONS as readonly string[]).includes(input.reason)) {
    return { ok: false, error: '주문 화면을 새로고침한 뒤 다시 시도해주세요.' };
  }
  const length = [...note].length;
  if (length < 5 || length > 500) return { ok: false, error: fulfillmentHoldReleaseError(null, 'invalid_fulfillment_hold_release') };
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc('admin_release_order_fulfillment_hold', {
      p_order_id: orderId, p_reason: input.reason, p_note: note, p_operation_id: input.operationId,
    });
    if (error) return { ok: false, error: fulfillmentHoldReleaseError(error.code, error.message) };
    if (!data || typeof data !== 'object' || (data as { orderId?: unknown }).orderId !== orderId) {
      return { ok: false, error: fulfillmentHoldReleaseError() };
    }
  } catch (error) {
    unstable_rethrow(error);
    return { ok: false, error: fulfillmentHoldReleaseError() };
  }
  for (const path of ['/admin/sales/orders', '/admin/sales/dispatch', `/admin/sales/orders/${orderId}`]) revalidatePath(path);
  revalidatePath('/admin');
  return { ok: true, message: '출고 보류를 해제했습니다. 다른 출고 조건(취소 요청·예약 입고 확인 등)은 그대로 확인됩니다.' };
}
