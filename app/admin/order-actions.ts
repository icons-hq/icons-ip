'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  normalizeAdminCancellationDecisionForm,
  normalizeAdminOrderStatusForm,
  normalizeAdminOrderTrackingForm,
  type AdminOrderFieldErrors,
} from '@/lib/admin/orders';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { parseOrderEmailDedupeKey } from '@/lib/email/dedupe';
import {
  sendOrderConfirmationEmail,
  sendOrderShippedEmail,
} from '@/lib/email/transactional.server';
import { reconcileOrderCancellation } from '@/lib/orders/cancellation-orchestrator.server';
import { orderShipment } from '@/lib/orders/shipment';
import { createClient } from '@/lib/supabase/server';

export interface AdminOrderActionState {
  errors?: AdminOrderFieldErrors & { form?: string };
  message?: string;
}

function loginPath() {
  return `/login?next=${encodeURIComponent('/admin')}`;
}

async function requireStaffAction() {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) redirect(loginPath());
  if (!auth.isStaff) {
    return { auth: null, error: { errors: { form: '관리자 권한이 필요합니다.' } } as AdminOrderActionState };
  }
  return { auth, error: null };
}

function revalidateOrderSurfaces(orderId?: string) {
  revalidatePath('/admin');
  revalidatePath('/orders');
  if (orderId) revalidatePath(`/orders/${orderId}`);
}

async function reconcileApprovedRequest(requestId: string, actorId: string) {
  try {
    return await reconcileOrderCancellation({ requestId, actorId });
  } catch {
    return { ok: false as const, code: 'local_finalize_failed' as const };
  }
}

const REVIEW_REQUIRED = '결제 취소 상태를 확정하지 못했습니다. 운영 화면의 최신 상태에서 다시 확인해주세요.';

export async function updateAdminOrderStatusAction(
  _state: AdminOrderActionState,
  formData: FormData,
): Promise<AdminOrderActionState> {
  const access = await requireStaffAction();
  if (access.error) return access.error;

  const normalized = normalizeAdminOrderStatusForm(formData);
  if (!normalized.ok) return { errors: normalized.errors };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_update_order_status', {
    p_carrier: normalized.value.carrier,
    p_order_id: normalized.value.orderId,
    p_status: normalized.value.status,
    p_tracking_number: normalized.value.trackingNumber,
  });
  if (error) {
    return { errors: { form: '주문 상태를 변경하지 못했습니다. 최신 상태를 확인해주세요.' } };
  }

  // 배송 시작 메일(#180). 방금 등록한 운송장을 그대로 실어 보낸다 — 값을 넘기지 않으면
  // 구매자는 "운송장 정보가 등록되면…"만 담긴 메일을 받고, dedupe 행이 sent로 닫혀
  // 다시 보낼 수도 없다. 발송 결과는 상태 전이에 영향을 주지 않는다.
  if (normalized.value.status === 'shipping') {
    const shipment = orderShipment(normalized.value.carrier, normalized.value.trackingNumber);
    const delivery = await sendOrderShippedEmail({
      orderId: normalized.value.orderId,
      carrierName: shipment?.carrierLabel ?? null,
      trackingNumber: shipment?.trackingNumber ?? null,
      trackingUrl: shipment?.trackingUrl ?? null,
    });
    // 결과를 버리면 실패가 로그에도 남지 않는다. 재발송 대상은 발송 이력 화면에서 본다.
    if (delivery.status === 'failed') {
      console.error(`[admin] shipped email failed (order:${normalized.value.orderId}): ${delivery.error}`);
    }
  }

  revalidateOrderSurfaces(normalized.value.orderId);
  return {
    message: normalized.value.status === 'shipping'
      ? '배송을 시작했습니다.'
      : '주문을 완료 처리했습니다.',
  };
}

export async function updateAdminOrderTrackingAction(
  _state: AdminOrderActionState,
  formData: FormData,
): Promise<AdminOrderActionState> {
  const access = await requireStaffAction();
  if (access.error) return access.error;

  const normalized = normalizeAdminOrderTrackingForm(formData);
  if (!normalized.ok) return { errors: normalized.errors };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_update_order_tracking', {
    p_carrier: normalized.value.carrier,
    p_order_id: normalized.value.orderId,
    p_tracking_number: normalized.value.trackingNumber,
  });
  if (error) {
    return { errors: { form: '운송장 정보를 저장하지 못했습니다. 최신 상태를 확인해주세요.' } };
  }

  revalidateOrderSurfaces(normalized.value.orderId);
  return { message: '운송장 정보를 저장했습니다.' };
}

/**
 * 실패한 트랜잭션 메일 재발송(#180 범위 5).
 *
 * 멱등은 깨지 않는다 — DB 게이트가 이미 sent인 건을 거절하고, 통과하더라도 실제 발송은
 * claim_email_delivery를 다시 잡는 기존 훅이 수행한다. 같은 버튼을 연타해도 이미 도착한
 * 메일이 두 번 가지 않는다.
 */
export async function resendOrderEmailAction(
  _state: AdminOrderActionState,
  formData: FormData,
): Promise<AdminOrderActionState> {
  const access = await requireStaffAction();
  if (access.error) return access.error;

  const dedupeKey = String(formData.get('dedupeKey') ?? '').trim();
  const parsed = parseOrderEmailDedupeKey(dedupeKey);
  if (!parsed) return { errors: { form: '다시 보낼 수 있는 메일이 아닙니다.' } };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_request_email_resend', { p_dedupe_key: dedupeKey });
  if (error) {
    return { errors: { form: '메일을 다시 보낼 수 없습니다. 발송 이력의 최신 상태를 확인해주세요.' } };
  }

  // 운송장 값은 넘기지 않는다 — 발송 훅이 주문 행에서 읽는다.
  const delivery = parsed.template === 'order_confirmation'
    ? await sendOrderConfirmationEmail(parsed.orderId)
    : await sendOrderShippedEmail({ orderId: parsed.orderId });

  revalidatePath('/admin');

  if (delivery.status === 'sent') return { message: '메일을 다시 보냈습니다.' };
  if (delivery.status === 'skipped') {
    return { errors: { form: '지금은 다시 보낼 수 없습니다. 이미 발송됐거나 발송 설정이 없습니다.' } };
  }
  console.error(`[admin] email resend failed (${dedupeKey}): ${delivery.error}`);
  return { errors: { form: '메일 발송이 다시 실패했습니다. 발송 이력의 오류 메시지를 확인해주세요.' } };
}

export async function approveAdminOrderCancellationAction(
  _state: AdminOrderActionState,
  formData: FormData,
): Promise<AdminOrderActionState> {
  const access = await requireStaffAction();
  if (access.error || !access.auth?.user) return access.error ?? { errors: { form: '관리자 권한이 필요합니다.' } };

  const normalized = normalizeAdminCancellationDecisionForm(formData, 'approve');
  if (!normalized.ok) return { errors: normalized.errors };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_decide_order_cancellation', {
    p_decision: 'approve',
    p_note: null,
    p_request_id: normalized.value.requestId,
  });
  if (error) {
    return { errors: { form: '청약철회 요청을 승인하지 못했습니다. 최신 상태를 확인해주세요.' } };
  }

  const result = await reconcileApprovedRequest(normalized.value.requestId, access.auth.user.id);
  revalidateOrderSurfaces();
  if (!result.ok) return { errors: { form: REVIEW_REQUIRED } };
  return { message: '청약철회를 완료했습니다.' };
}

export async function rejectAdminOrderCancellationAction(
  _state: AdminOrderActionState,
  formData: FormData,
): Promise<AdminOrderActionState> {
  const access = await requireStaffAction();
  if (access.error) return access.error;

  const normalized = normalizeAdminCancellationDecisionForm(formData, 'reject');
  if (!normalized.ok) return { errors: normalized.errors };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_decide_order_cancellation', {
    p_decision: 'reject',
    p_note: normalized.value.reason,
    p_request_id: normalized.value.requestId,
  });
  if (error) {
    return { errors: { form: '청약철회 요청을 거절하지 못했습니다. 최신 상태를 확인해주세요.' } };
  }

  revalidateOrderSurfaces();
  return { message: '청약철회 요청을 거절했습니다.' };
}

export async function reconcileAdminOrderCancellationAction(
  _state: AdminOrderActionState,
  formData: FormData,
): Promise<AdminOrderActionState> {
  const access = await requireStaffAction();
  if (access.error || !access.auth?.user) return access.error ?? { errors: { form: '관리자 권한이 필요합니다.' } };

  const normalized = normalizeAdminCancellationDecisionForm(formData, 'approve');
  if (!normalized.ok) return { errors: normalized.errors };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_begin_order_cancellation_reconcile', {
    p_request_id: normalized.value.requestId,
  });
  if (error) {
    return { errors: { form: '청약철회 요청을 다시 확인하지 못했습니다. 최신 상태를 확인해주세요.' } };
  }

  const result = await reconcileApprovedRequest(normalized.value.requestId, access.auth.user.id);
  revalidateOrderSurfaces();
  if (!result.ok) return { errors: { form: REVIEW_REQUIRED } };
  return { message: '결제 취소 상태를 정합화했습니다.' };
}
