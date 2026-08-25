'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  normalizeAdminUnpaidReason,
  normalizeAdminUnpaidReasonForm,
} from '@/lib/admin/unpaid';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { sendOrderConfirmationEmail } from '@/lib/email/transactional.server';
import { createClient } from '@/lib/supabase/server';

/*
 * 미입금 확인 콘솔 액션(#256).
 *
 * 이 파일은 주문을 결제완료로 바꾸지 않는다. 확정은 DB
 * admin_confirm_bank_transfer_deposit → finalize_goods_payment_attempt 경로가
 * 하고, 여기서는 폼 검증·운영자 문구와 확정 뒤 확인 메일 훅만 맡는다. 앱이
 * orders.status를 직접 건드리기 시작하면 재고·원장·뽑기권 부수효과가 두 곳으로
 * 갈라진다.
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

/**
 * finalizer는 `approved` 말고도 `needs_review`를 돌려줄 수 있다 — 확정 직전에
 * 계정이 정지됐거나 주문 스냅샷이 어긋난 경우다. 그때 "결제완료로 확정했습니다"를
 * 띄우면 운영자가 발주 큐에서 찾다가 없어서야 알게 된다. 결과를 그대로 말한다.
 *
 * `approved`면 주문 확인 메일까지 이어서 보낸다(전자상거래법 서면 교부, #239·D8).
 * 카드 결제는 Korpay confirm 경로가 같은 메일을 보내므로, 무통장도 이 깔때기를
 * 지나는 두 확정 액션(직접 확정·입금 내역 연결)이 같은 훅을 부른다. 훅은 절대
 * throw하지 않고 email_deliveries 클레임으로 멱등이라 결과 반환을 막지 않는다.
 */
async function finalizationResult(
  outcome: unknown,
  orderId: string,
  successMessage: string,
): Promise<AdminUnpaidActionState> {
  if (outcome === 'approved') {
    await sendOrderConfirmationEmail(orderId);
    return { message: successMessage };
  }
  return {
    error: `입금 기록은 남았지만 주문이 결제완료로 확정되지 않았습니다(결과: ${
      typeof outcome === 'string' ? outcome : 'unknown'
    }). 결제 원장을 확인한 뒤 수동 정합화가 필요합니다.`,
  };
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
  const { data, error } = await supabase.rpc('admin_confirm_bank_transfer_deposit', {
    p_order_id: normalized.value.orderId,
    p_memo: normalized.value.reason,
  });
  if (error) return { error: rpcErrorMessage(error.message, CONFIRM_FAILED) };

  revalidateUnpaidSurfaces(normalized.value.orderId);
  return finalizationResult(
    data,
    normalized.value.orderId,
    '입금을 확인해 주문을 결제완료로 확정했습니다.',
  );
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

/*
 * 계좌수집 입금 내역 처리(#257).
 *
 * 확정은 admin_confirm_bank_deposit → admin_confirm_bank_transfer_deposit →
 * finalize_goods_payment_attempt로 이어진다. 자동 확정은 없다 — 매칭은 제안이고,
 * 마지막 클릭은 사람이 한다(ADR-0007).
 */
const DEPOSIT_CONFIRM_FAILED = '입금 내역을 확정하지 못했습니다. 최신 상태를 확인해주세요.';
const DEPOSIT_IGNORE_FAILED = '입금 내역을 보류하지 못했습니다. 최신 상태를 확인해주세요.';

function depositErrorMessage(message: string | null | undefined, fallback: string) {
  const value = (message ?? '').toLowerCase();
  if (value.includes('deposit_already_decided')) {
    return '이미 처리된 입금입니다. 목록을 새로고침해주세요.';
  }
  if (value.includes('deposit_not_ignorable')) {
    return '이미 처리된 입금이라 보류할 수 없습니다.';
  }
  if (value.includes('deposit_not_found')) return '입금 내역을 찾을 수 없습니다.';
  return rpcErrorMessage(message, fallback);
}

export async function confirmBankDepositAction(
  _state: AdminUnpaidActionState,
  formData: FormData,
): Promise<AdminUnpaidActionState> {
  const denied = await requireStaffAction();
  if (denied) return denied;

  const depositId = String(formData.get('depositId') ?? '').trim();
  const orderId = String(formData.get('orderId') ?? '').trim();
  if (!depositId || !orderId) return { error: '입금과 주문을 함께 선택해주세요.' };

  const memo = normalizeAdminUnpaidReason(
    formData.get('memo'),
    '입금 근거를 5자 이상 200자 이하로 남겨주세요. 제안을 그대로 받아들이는 경우에도 무엇을 보고 확정했는지 남겨야 합니다.',
  );
  if (!memo.ok) return { error: memo.error };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_confirm_bank_deposit', {
    p_deposit_id: depositId,
    p_order_id: orderId,
    p_memo: memo.value,
  });
  if (error) return { error: depositErrorMessage(error.message, DEPOSIT_CONFIRM_FAILED) };

  revalidateUnpaidSurfaces(orderId);
  return finalizationResult(data, orderId, '입금 내역을 주문에 연결하고 결제완료로 확정했습니다.');
}

export async function ignoreBankDepositAction(
  _state: AdminUnpaidActionState,
  formData: FormData,
): Promise<AdminUnpaidActionState> {
  const denied = await requireStaffAction();
  if (denied) return denied;

  const depositId = String(formData.get('depositId') ?? '').trim();
  if (!depositId) return { error: '입금 내역을 찾을 수 없습니다.' };

  const reason = normalizeAdminUnpaidReason(
    formData.get('reason'),
    '보류 사유를 5자 이상 200자 이하로 남겨주세요. 반환 절차의 근거가 됩니다.',
  );
  if (!reason.ok) return { error: reason.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_ignore_bank_deposit', {
    p_deposit_id: depositId,
    p_reason: reason.value,
  });
  if (error) return { error: depositErrorMessage(error.message, DEPOSIT_IGNORE_FAILED) };

  revalidatePath('/admin/sales/unpaid');
  return { message: '입금 내역을 큐에서 내렸습니다. 기록은 남습니다.' };
}
