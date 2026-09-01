'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  adminClaimBasePath,
  normalizeAdminClaimCollectionForm,
  normalizeAdminClaimDecisionForm,
  normalizeAdminClaimRefundForm,
  normalizeAdminClaimReshipmentForm,
} from '@/lib/admin/claims';
import { loadAdminClaimDetail } from '@/lib/admin/claims.server';
import { getCurrentAdminAuthState, type AdminRole } from '@/lib/auth/admin';
import { isOrderClaimType, type OrderClaimType } from '@/lib/orders/claims';
import { reconcileOrderCancellation } from '@/lib/orders/cancellation-orchestrator.server';
import { recoverGoodsPaymentManually } from '@/lib/payments/goods-manual-recovery.server';
import { createClient } from '@/lib/supabase/server';

/* 어드민 클레임 콘솔 액션(#252).
 *
 * 이 파일은 돈을 직접 움직이지 않는다. 재고 복원과 카드팩 회수는
 * finalize_order_cancellation_with_provider_evidence 한 곳에만 있고, 여기서는
 * 이미 있는 정합화 경로 — 취소 요청 오케스트레이터와 Korpay 수동 복구 seam —
 * 를 그대로 호출한 뒤 그 결과를 환불 원장에 적을 뿐이다. 두 번째 원장을 만들면
 * "환불은 완료인데 재고는 그대로"인 주문이 생긴다. */

export interface AdminClaimActionState {
  error?: string;
  message?: string;
}

const DECIDE_FAILED = '클레임을 처리하지 못했습니다. 최신 상태를 확인해주세요.';
const COLLECTION_FAILED = '수거 상태를 기록하지 못했습니다. 최신 상태를 확인해주세요.';
const REFUND_FAILED = '환불 원장을 기록하지 못했습니다. 최신 상태를 확인해주세요.';
const RESHIP_FAILED = '재출고를 기록하지 못했습니다. 최신 상태를 확인해주세요.';
const FINALIZE_FAILED = '결제 취소 상태를 확정하지 못했습니다. 주문과 재고는 그대로 유지됩니다. 결제사 원장을 확인한 뒤 다시 시도해주세요.';

const DECISION_MESSAGES: Record<string, string> = {
  review: '검토중으로 표시했습니다.',
  approve: '클레임을 승인했습니다.',
  reject: '클레임을 거부했습니다.',
  hold: '클레임을 보류했습니다.',
  resume: '보류를 해제했습니다.',
};

/** DB가 던지는 message를 운영자 문구로 옮긴다. 원문을 그대로 노출하지 않는다. */
function rpcErrorMessage(message: string | null | undefined, fallback: string) {
  const value = (message ?? '').toLowerCase();
  if (value.includes('withdrawal_deadline_expired')) {
    return '청약철회 기한이 지난 요청입니다. 승인 대신 사유를 남겨 거부해주세요.';
  }
  if (value.includes('claim_refund_finalization_required')) {
    return '결제 취소 정합화가 끝나지 않았습니다. 재고 복원과 카드팩 회수가 확인된 뒤에만 환불 완료를 기록할 수 있습니다.';
  }
  if (value.includes('claim_refund_ledger_missing')) {
    return '이 주문에는 환불 원장이 없습니다. 결제 내역을 먼저 확인해주세요.';
  }
  if (value.includes('exchange_has_no_refund')) return '교환 클레임에는 환불이 없습니다.';
  if (value.includes('claim_type_has_no_collection')) return '취소 클레임에는 수거 단계가 없습니다.';
  if (value.includes('claim_type_has_no_reshipment')) return '교환 클레임만 재출고를 기록할 수 있습니다.';
  if (value.includes('claim_not_rejectable')) {
    return '처리에 착수한 클레임은 거부할 수 없습니다. 결제 취소를 마치거나, 사람이 판단할 일이면 보류로 남겨주세요.';
  }
  if (value.includes('claim_refund_account_missing')) {
    return '이 클레임에는 등록된 환불계좌가 없습니다. 계좌 송금 대신 결제사 취소로 접수하거나, 구매자에게 계좌를 먼저 받아주세요.';
  }
  if (value.includes('claim_not_decidable')) return '지금 단계에서는 처리할 수 없습니다. 최신 상태를 확인해주세요.';
  if (value.includes('claim_not_collectable')) return '수거 단계가 아닙니다. 최신 상태를 확인해주세요.';
  if (value.includes('claim_not_refundable')) return '환불을 접수할 수 있는 단계가 아닙니다.';
  if (value.includes('claim_not_reshippable')) return '입고 확인이 끝난 교환만 재출고할 수 있습니다.';
  if (value.includes('claim_not_held')) return '보류 상태가 아닙니다.';
  if (value.includes('claim_not_found')) return '클레임을 찾을 수 없습니다.';
  if (value.includes('unknown shipping carrier')) return '등록되지 않은 택배사입니다.';
  return fallback;
}

async function requireStaffAction(): Promise<
  { error?: AdminClaimActionState; userId?: string; role?: AdminRole | null }
> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) {
    redirect(`/login?next=${encodeURIComponent('/admin/sales/claims/cancels')}`);
  }
  if (!auth.isStaff) return { error: { error: '관리자 권한이 필요합니다.' } };
  return { userId: auth.user.id, role: auth.role };
}

function revalidateClaimSurfaces(claimId: string, claimType?: OrderClaimType) {
  for (const type of ['cancel', 'return', 'exchange'] as const) {
    if (claimType && type !== claimType) continue;
    revalidatePath(adminClaimBasePath(type));
    revalidatePath(`${adminClaimBasePath(type)}/${claimId}`);
  }
  /* 클레임은 주문 사다리와 발송 큐를 동시에 움직인다. 한쪽만 갱신하면 방금
     처리한 주문이 다른 화면에 그대로 남아 두 번 처리된다. */
  revalidatePath('/admin/sales/orders');
  revalidatePath('/admin/sales/dispatch');
  revalidatePath('/orders');
}

function readClaimType(formData: FormData): OrderClaimType | undefined {
  const value = formData.get('claimType');
  return isOrderClaimType(value) ? value : undefined;
}

export async function decideOrderClaimAction(
  _state: AdminClaimActionState,
  formData: FormData,
): Promise<AdminClaimActionState> {
  const access = await requireStaffAction();
  if (access.error) return access.error;

  const normalized = normalizeAdminClaimDecisionForm(formData);
  if (!normalized.ok) return { error: normalized.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_decide_order_claim', {
    p_claim_id: normalized.value.claimId,
    p_decision: normalized.value.decision,
    p_note: normalized.value.note,
  });
  if (error) return { error: rpcErrorMessage(error.message, DECIDE_FAILED) };

  revalidateClaimSurfaces(normalized.value.claimId, readClaimType(formData));
  return { message: DECISION_MESSAGES[normalized.value.decision] ?? '클레임을 처리했습니다.' };
}

export async function recordOrderClaimCollectionAction(
  _state: AdminClaimActionState,
  formData: FormData,
): Promise<AdminClaimActionState> {
  const access = await requireStaffAction();
  if (access.error) return access.error;

  const normalized = normalizeAdminClaimCollectionForm(formData);
  if (!normalized.ok) return { error: normalized.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_record_order_claim_collection', {
    p_claim_id: normalized.value.claimId,
    p_stage: normalized.value.stage,
  });
  if (error) return { error: rpcErrorMessage(error.message, COLLECTION_FAILED) };

  revalidateClaimSurfaces(normalized.value.claimId, readClaimType(formData));
  return {
    message: normalized.value.stage === 'collected'
      ? '반송 굿즈 입고를 확인했습니다. 환급 SLA 타이머가 시작됩니다.'
      : '수거중으로 표시했습니다.',
  };
}

interface ManualRecoveryAttemptRow {
  order_id: string;
  request_id: string;
  attempt_id: string;
  manual_recovery_available: boolean;
}

/**
 * 클레임을 종결 가능한 상태로 만든다.
 *
 * Korpay는 `refund()`가 API를 부르지 않고 전건 needs_review로 떨어지므로 수동
 * 확인 seam이 정상 경로다(#208). toss 유상 캡처는 오케스트레이터가 게이트웨이
 * refund(취소 API + fresh 조회 검증)로 자동 취소한다(#389) — 클레임 승인이
 * 건별 메일 요청 없이 한 동작으로 종결되는 지점이 여기다.
 * 어느 쪽이든 마지막에 finalize_order_cancellation_with_provider_evidence를 지나며,
 * 그 함수만이 재고를 복원하고 미개봉 카드팩을 회수한다.
 */
async function finalizeClaimPayment(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: { claimId: string; orderId: string; actorId: string; isAdmin: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('admin_goods_manual_recovery_attempts', {
    p_order_ids: [input.orderId],
  });

  const attempts = (!error && Array.isArray(data) ? data : []) as ManualRecoveryAttemptRow[];
  const attempt = attempts.find((row) => (
    row.request_id === input.claimId && row.manual_recovery_available
  ));

  if (attempt) {
    /* 수동 확인은 결제사 원장을 직접 본 admin만 할 수 있다(#208의 계약). */
    if (!input.isAdmin) {
      return {
        ok: false,
        error: 'Korpay 결제 취소 확인은 관리자 계정만 수행할 수 있습니다. 관리자에게 정합화를 요청해주세요.',
      };
    }
    try {
      const result = await recoverGoodsPaymentManually({
        operation: 'provider_cancel_confirmed',
        attemptId: attempt.attempt_id,
        actorId: input.actorId,
        requestId: input.claimId,
        operatorAttested: true,
      });
      if (result.outcome === 'in_progress') {
        return { ok: false, error: '다른 운영 확인이 진행 중입니다. 잠시 뒤 다시 시도해주세요.' };
      }
      return { ok: true };
    } catch {
      return { ok: false, error: FINALIZE_FAILED };
    }
  }

  const { error: beginError } = await supabase.rpc('admin_begin_order_cancellation_reconcile', {
    p_request_id: input.claimId,
  });
  if (beginError) return { ok: false, error: FINALIZE_FAILED };

  try {
    const result = await reconcileOrderCancellation({
      requestId: input.claimId,
      actorId: input.actorId,
    });
    if (!result.ok) return { ok: false, error: FINALIZE_FAILED };
    if (result.status === 'in_progress') {
      return { ok: false, error: '결제 상태 처리가 아직 끝나지 않았습니다. 주문과 재고는 그대로 유지됩니다.' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: FINALIZE_FAILED };
  }
}

export async function recordOrderClaimRefundAction(
  _state: AdminClaimActionState,
  formData: FormData,
): Promise<AdminClaimActionState> {
  const access = await requireStaffAction();
  if (access.error || !access.userId) return access.error ?? { error: REFUND_FAILED };

  const normalized = normalizeAdminClaimRefundForm(formData);
  if (!normalized.ok) return { error: normalized.error };

  const supabase = await createClient();
  let finalizationRan = false;

  if (normalized.value.stage === 'completed') {
    const orderId = String(formData.get('orderId') ?? '');
    if (!orderId) return { error: REFUND_FAILED };

    /* 이미 종결된 클레임에는 정합화를 다시 걸지 않는다.
     *
     * admin_begin_order_cancellation_reconcile은 completed 요청을
     * cancellation_request_not_reconcilable로 거절한다. 그래서 레거시 경로로
     * 완료된 건(재고 복원·카드팩 회수는 이미 끝났고 refunds.completed_at만 비어
     * 있는 상태)에 이 액션을 걸면 원장 기록에 닿기도 전에 항상 실패했다. 단계는
     * 폼이 아니라 DB에서 읽는다 — 클라이언트가 보낸 값으로 정합화를 건너뛸지
     * 정하면 그 자체가 게이트 우회가 된다. */
    const current = await loadAdminClaimDetail(normalized.value.claimId);
    if (!current) return { error: '클레임을 찾을 수 없습니다.' };

    if (current.claim.stage !== 'completed') {
      finalizationRan = true;
      const finalized = await finalizeClaimPayment(supabase, {
        claimId: normalized.value.claimId,
        orderId,
        actorId: access.userId,
        isAdmin: access.role === 'admin',
      });
      if (!finalized.ok) {
        revalidateClaimSurfaces(normalized.value.claimId, readClaimType(formData));
        return { error: finalized.error };
      }
    }
  }

  const { error } = await supabase.rpc('admin_record_order_claim_refund', {
    p_claim_id: normalized.value.claimId,
    p_method: normalized.value.method,
    p_note: normalized.value.note,
    p_stage: normalized.value.stage,
  });
  if (error) {
    revalidateClaimSurfaces(normalized.value.claimId, readClaimType(formData));
    return { error: rpcErrorMessage(error.message, REFUND_FAILED) };
  }

  revalidateClaimSurfaces(normalized.value.claimId, readClaimType(formData));
  if (normalized.value.stage === 'filed') return { message: '환불 접수를 기록했습니다.' };
  /* 이미 종결된 클레임에는 재고 복원·카드팩 회수가 방금 일어나지 않았다. 문구가
     일어나지 않은 일을 보고하면 운영자가 그 주문을 다시 확인할 근거를 잃는다. */
  return {
    message: finalizationRan
      ? '환불 완료를 기록했습니다. 재고 복원과 카드팩 회수가 함께 확정됐습니다.'
      : '환불 완료를 원장에 기록했습니다. 주문 취소와 재고 복원은 이미 확정된 상태였습니다.',
  };
}

export async function recordOrderClaimReshipmentAction(
  _state: AdminClaimActionState,
  formData: FormData,
): Promise<AdminClaimActionState> {
  const access = await requireStaffAction();
  if (access.error) return access.error;

  const normalized = normalizeAdminClaimReshipmentForm(formData);
  if (!normalized.ok) return { error: normalized.error };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_record_order_claim_reshipment', {
    p_carrier: normalized.value.carrier,
    p_claim_id: normalized.value.claimId,
    p_tracking_number: normalized.value.trackingNumber,
  });
  if (error) return { error: rpcErrorMessage(error.message, RESHIP_FAILED) };

  revalidateClaimSurfaces(normalized.value.claimId, 'exchange');
  return { message: '교환 재출고 운송장을 등록하고 클레임을 종결했습니다.' };
}
