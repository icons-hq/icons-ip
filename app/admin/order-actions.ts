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
import { sendOrderShippedEmail } from '@/lib/email/transactional.server';
import { reconcileOrderCancellation } from '@/lib/orders/cancellation-orchestrator.server';
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

  // 배송 시작 메일(#180). 운송장 값은 아직 인자로 열려 있고 #178이 채운다.
  // 발송 결과는 상태 전이에 영향을 주지 않는다 — 메일 실패로 배송 처리를 되돌리지 않는다.
  if (normalized.value.status === 'shipping') {
    await sendOrderShippedEmail({ orderId: normalized.value.orderId });
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
