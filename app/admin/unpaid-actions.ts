'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { normalizeAdminUnpaidReasonForm } from '@/lib/admin/unpaid';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';

/*
 * 미입금 확인 콘솔 액션(#256).
 *
 * 이 파일은 주문을 결제완료로 바꾸지 않는다. 확정은 DB
 * admin_confirm_bank_transfer_deposit → finalize_goods_payment_attempt 경로가
 * 하고, 여기서는 폼 검증과 운영자 문구만 맡는다. 앱이 orders.status를 직접
 * 건드리기 시작하면 재고·원장·뽑기권 부수효과가 두 곳으로 갈라진다.
 */

export interface AdminUnpaidActionState {
  error?: string;
  message?: string;
}

const CONFIRM_FAILED = '입금을 확정하지 못했습니다. 최신 상태를 확인해주세요.';
const EXTEND_FAILED = '기한을 연장하지 못했습니다. 최신 상태를 확인해주세요.';
const CANCEL_FAILED = '주문을 취소하지 못했습니다. 최신 상태를 확인해주세요.';

/** DB message를 운영자 문구로 옮긴다. 원문을 그대로 노출하지 않는다. */
function rpcErrorMessage(message: string | null | undefined, fallback: string) {
  const value = (message ?? '').toLowerCase();
  if (value.includes('order_not_bank_transfer')) return '무통장 주문이 아닙니다.';
  if (value.includes('order_not_unpaid')) {
    return '이미 처리된 주문입니다. 목록을 새로고침해주세요.';
  }
  if (value.includes('bank_transfer_attempt_not_found')) {
    return '이 주문에는 입금 원장이 없습니다. 결제 내역을 먼저 확인해주세요.';
  }
  if (value.includes('bank_transfer_attempt_not_confirmable')) {
    return '입금 원장이 이미 닫혔습니다. 기한 만료로 자동 취소됐는지 확인해주세요.';
  }
  if (value.includes('bank_transfer_attempt_not_cancelable')) {
    return '확정이 진행 중인 주문입니다. 결과를 확인한 뒤 다시 시도해주세요.';
  }
  if (value.includes('bank_transfer_already_extended')) {
    return '기한 연장은 주문당 한 번입니다. 더 기다릴 수 없다면 취소해주세요.';
  }
  if (value.includes('order_not_found')) return '주문을 찾을 수 없습니다.';
  if (value.includes('staff required')) return '관리자 권한이 필요합니다.';
  return fallback;
}

async function requireStaffAction(): Promise<AdminUnpaidActionState | null> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) {
    redirect(`/login?next=${encodeURIComponent('/admin/sales/unpaid')}`);
  }
  if (!auth.isStaff) return { error: '관리자 권한이 필요합니다.' };
  return null;
}

function revalidateUnpaidSurfaces(orderId: string) {
  revalidatePath('/admin/sales/unpaid');
  /* 확정된 주문은 즉시 발주 큐로 넘어간다. 한쪽만 갱신하면 방금 처리한 주문이
     다른 화면에 미입금으로 남아 두 번 처리된다. */
  revalidatePath('/admin/sales/orders');
  revalidatePath('/admin/sales/dispatch');
  revalidatePath(`/orders/${orderId}`);
  revalidatePath('/orders');
}

export async function confirmBankTransferDepositAction(
  _state: AdminUnpaidActionState,
  formData: FormData,
): Promise<AdminUnpaidActionState> {
  const denied = await requireStaffAction();
  if (denied) return denied;

  const normalized = normalizeAdminUnpaidReasonForm(
    formData,
    'memo',
    '입금 근거를 5자 이상 200자 이하로 남겨주세요. 은행·입금자명·금액을 적으면 나중에 대조할 수 있습니다.',
  );
  if (!normalized.ok) return { error: normalized.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_confirm_bank_transfer_deposit', {
    p_order_id: normalized.value.orderId,
    p_memo: normalized.value.reason,
  });
  if (error) return { error: rpcErrorMessage(error.message, CONFIRM_FAILED) };

  revalidateUnpaidSurfaces(normalized.value.orderId);
  return { message: '입금을 확인해 주문을 결제완료로 확정했습니다.' };
}

export async function extendBankTransferDeadlineAction(
  _state: AdminUnpaidActionState,
  formData: FormData,
): Promise<AdminUnpaidActionState> {
  const denied = await requireStaffAction();
  if (denied) return denied;

  const normalized = normalizeAdminUnpaidReasonForm(
    formData,
    'reason',
    '연장 사유를 5자 이상 200자 이하로 남겨주세요. 재고를 하루 더 묶는 판단입니다.',
  );
  if (!normalized.ok) return { error: normalized.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_extend_bank_transfer_deadline', {
    p_order_id: normalized.value.orderId,
    p_reason: normalized.value.reason,
  });
  if (error) return { error: rpcErrorMessage(error.message, EXTEND_FAILED) };

  revalidateUnpaidSurfaces(normalized.value.orderId);
  return { message: '입금 기한을 24시간 연장했습니다.' };
}

export async function cancelUnpaidBankTransferOrderAction(
  _state: AdminUnpaidActionState,
  formData: FormData,
): Promise<AdminUnpaidActionState> {
  const denied = await requireStaffAction();
  if (denied) return denied;

  const normalized = normalizeAdminUnpaidReasonForm(
    formData,
    'reason',
    '취소 사유를 5자 이상 200자 이하로 남겨주세요.',
  );
  if (!normalized.ok) return { error: normalized.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_cancel_unpaid_bank_transfer_order', {
    p_order_id: normalized.value.orderId,
    p_reason: normalized.value.reason,
  });
  if (error) return { error: rpcErrorMessage(error.message, CANCEL_FAILED) };

  revalidateUnpaidSurfaces(normalized.value.orderId);
  return { message: '미입금 주문을 취소하고 재고를 복원했습니다.' };
}
