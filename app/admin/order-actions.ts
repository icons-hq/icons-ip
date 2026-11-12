'use server';

import { isUuid } from '@/lib/uuid';
import { canAccessAdminScreen } from '@/lib/admin/access';

import { revalidatePath } from 'next/cache';
import { normalizeAdminDispatchDelayForm } from '@/lib/admin/dispatch';
import {
  ADMIN_CANCELLATION_RECHECK_LABELS,
  normalizeAdminCancellationDecisionForm,
  normalizeAdminGoodsManualRecoveryForm,
  normalizeAdminOrderStatusForm,
  normalizeAdminOrderTrackingForm,
  normalizeAdminStaffCancellationForm,
  type AdminOrderFieldErrors,
  type AdminOrderFormStatus,
} from '@/lib/admin/orders';
import {
  parseTrackingImport,
  TRACKING_IMPORT_ROW_LIMIT,
} from '@/lib/admin/tracking-import';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { parseOrderEmailDedupeKey } from '@/lib/email/dedupe';
import {
  sendOrderConfirmationEmail,
  sendOrderShippedEmail,
} from '@/lib/email/transactional.server';
import { orderReferenceLabel } from '@/lib/orders';
import { commerceReferenceLabel } from '@/lib/commerce-number';
import { reconcileOrderCancellation } from '@/lib/orders/cancellation-orchestrator.server';
import { recoverGoodsPaymentManually } from '@/lib/payments/goods-manual-recovery.server';
import { trackingImportCommand, type SeowonTrackingParseResult } from '@/lib/admin/warehouse-templates.server';
import { matchSeowonReply, type SeowonReplyCandidate } from '@/lib/admin/seowon-exchange';
import { parseTrackingWorkbook, TRACKING_IMPORT_FILE_LIMIT_BYTES, TRACKING_IMPORT_TEXT_LIMIT_BYTES, type TrackingWorkbookParseResult } from '@/lib/admin/tracking-workbook.server';
import { parseSmartStoreReplyText } from '@/lib/admin/smartstore-tracking-workbook.server';
import { decodeSpreadsheetText } from '@/lib/admin/spreadsheet-text';
import { shipmentMutationError } from '@/lib/admin/shipment-dispatch';
import { enqueueOrderShippedEmails } from '@/lib/email/order-shipment-jobs.server';
import { getShippingCarrierRegistry } from '@/lib/orders/shipment.server';
import { createClient } from '@/lib/supabase/server';

export interface AdminOrderActionState {
  errors?: AdminOrderFieldErrors & { form?: string };
  message?: string;
  confirmedOrderIds?: string[];
}

async function requireStaffAction() {
  const auth = await requireAdminActionAccess('/admin/sales/orders', { capability: 'sales.manage' });
  if (!auth) {
    return { auth: null, error: { errors: { form: '관리자 권한이 필요합니다.' } } as AdminOrderActionState };
  }
  return { auth, error: null };
}

/** 운송장 회신 등록은 출고 전용 권한(sales.dispatch, 1014-084)으로 한다. sales.manage도 이 권한을 포함한다. */
async function requireDispatchAction() {
  const auth = await requireAdminActionAccess('/admin/sales/dispatch', { capability: 'sales.dispatch' });
  if (!auth) {
    return { auth: null, error: { errors: { form: '관리자 권한이 필요합니다.' } } as AdminOrderActionState };
  }
  return { auth, error: null };
}

function revalidateOrderSurfaces(orderId?: string) {
  revalidatePath('/admin');
  revalidatePath('/orders');
  /* 상태 전이는 발주·발송과 배송현황 목록을 동시에 움직인다. 한쪽만 갱신하면
     방금 처리한 주문이 다른 화면에 그대로 남아 두 번 처리된다(#251). */
  revalidatePath('/admin/sales/dispatch');
  revalidatePath('/admin/sales/shipping');
  if (orderId) revalidatePath(`/orders/${orderId}`);
  else { revalidatePath('/orders/[orderId]', 'page'); revalidatePath('/admin/sales/orders/[orderId]', 'page'); }
}

async function reconcileApprovedRequest(requestId: string, actorId: string) {
  try {
    return await reconcileOrderCancellation({ requestId, actorId });
  } catch {
    return { ok: false as const, code: 'local_finalize_failed' as const };
  }
}

/**
 * 결제 취소를 확정하지 못한 결과(2026-10-12 브라우저 QA QA-10).
 *
 * 원인 코드를 그대로 싣는다. 런북·가이드의 조치는 코드별이라, 코드 없이 "다시 확인"만
 * 말하면 운영자는 같은 버튼을 반복해 누른다. 같은 코드는 주문 패널의 취소 요청 영역과
 * 취소 관리 요청 상세의 정합화 오류에도 남는다.
 */
function reviewRequiredMessage(code: string) {
  return `결제 취소 상태를 확정하지 못했습니다(${code}). 주문과 재고는 그대로 유지됩니다. 코드별 조치는 어드민 가이드 "클레임 처리"에 있습니다. 원인을 확인한 뒤 이 주문 패널의 [${ADMIN_CANCELLATION_RECHECK_LABELS.needsReview}]으로 다시 시도해주세요.`;
}
const PAYMENT_RECONCILIATION_IN_PROGRESS = '결제 상태 처리가 아직 끝나지 않았습니다. 주문과 재고는 그대로 유지됩니다. 최신 상태를 확인한 뒤 다시 시도하고, 상태가 계속되면 관리자 결제 담당자에게 결제사 원장 확인을 요청해주세요.';

/**
 * 전이별 완료 문구(#250). "완료 처리"는 done이 거래확정으로 재정의되면서
 * 배송완료와 뜻이 갈렸다 — 운영자가 어느 칸을 밀었는지 문구로 알 수 있어야 한다.
 */
const STATUS_TRANSITION_MESSAGES: Record<AdminOrderFormStatus, string> = {
  confirmed: '주문을 발주확인했습니다.',
  shipping: '배송을 시작했습니다.',
  delivered: '배송완료로 변경했습니다.',
};

export async function updateAdminOrderStatusAction(
  _state: AdminOrderActionState,
  formData: FormData,
): Promise<AdminOrderActionState> {
  const access = await requireStaffAction();
  if (access.error) return access.error;

  const carriers = await getShippingCarrierRegistry();
  const normalized = normalizeAdminOrderStatusForm(formData, carriers);
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
    const delivery = await sendOrderShippedEmail({ orderId: normalized.value.orderId });
    // 결과를 버리면 실패가 로그에도 남지 않는다. 재발송 대상은 발송 이력 화면에서 본다.
    if (delivery.status === 'failed') {
      console.error(`[admin] shipped email failed (order:${normalized.value.orderId}): ${delivery.error}`);
    }
  }

  revalidateOrderSurfaces(normalized.value.orderId);
  return { message: STATUS_TRANSITION_MESSAGES[normalized.value.status] };
}

/* 한 번에 미는 상한. 상한이 없으면 전체선택 한 번이 수백 건의 순차 RPC가 된다. */
const BULK_CONFIRM_LIMIT = 100;

/**
 * 신규주문 일괄 발주확인(#250).
 *
 * 건별로 기존 `admin_update_order_status`를 부른다. 일괄 전용 RPC를 만들지 않는
 * 이유는 전이 규칙·활성 클레임 검사·감사 로그가 이미 그 함수 안에 있기 때문이다 —
 * 우회로를 하나 더 만들면 규칙이 두 벌이 된다.
 *
 * 한 건이 실패해도 나머지를 멈추지 않는다. 발주확인이 거절되는 흔한 이유는 그 주문에
 * 취소 클레임이 열려 있어서인데, 그 한 건 때문에 선택한 40건이 통째로 실패하면
 * 운영자는 무엇이 처리됐는지 모른 채 다시 전부 누르게 된다. 대신 성공·실패 건수를
 * 세어 돌려준다. 개별 실패 사유는 화면에 늘어놓지 않는다 — 목록을 새로고침하면
 * 남아 있는 건이 곧 실패한 건이다.
 */
/** 결과 문구의 주문은 16자리 주문번호로 적는다. 번호를 읽지 못하면 UUID 표기로 남긴다. */
async function orderNumberLabels(supabase: Awaited<ReturnType<typeof createClient>>, orderIds: string[]) {
  let numbers = new Map<string, string | null>();
  try {
    const { data } = await supabase.from('orders').select('id,order_number').in('id', orderIds);
    numbers = new Map(((data ?? []) as { id: string; order_number: string | null }[]).map(row => [row.id, row.order_number]));
  } catch { /* 결과 문구가 번호 조회 실패로 사라지지 않게 UUID 표기로 남긴다. */ }
  return orderIds.map(id => orderReferenceLabel(id, numbers.get(id))).join(', ');
}

export async function bulkConfirmAdminOrdersAction(
  _state: AdminOrderActionState,
  formData: FormData,
): Promise<AdminOrderActionState> {
  const access = await requireStaffAction();
  if (access.error) return access.error;

  const orderIds = [...new Set(
    formData.getAll('orderIds')
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => isUuid(value)),
  )];

  if (!orderIds.length) return { errors: { form: '발주확인할 주문을 선택해주세요.' } };
  if (orderIds.length > BULK_CONFIRM_LIMIT) {
    return {
      errors: {
        form: `한 번에 발주확인할 수 있는 주문은 ${BULK_CONFIRM_LIMIT}건까지입니다. 기간을 좁혀 나눠 처리해주세요.`,
      },
    };
  }

  const supabase = await createClient();
  const confirmedOrderIds: string[] = [];
  const failed: string[] = [];

  for (const orderId of orderIds) {
    const { error } = await supabase.rpc('admin_update_order_status', {
      p_carrier: null,
      p_order_id: orderId,
      p_status: 'confirmed',
      p_tracking_number: null,
    });
    if (error) {
      failed.push(orderId);
      continue;
    }
    confirmedOrderIds.push(orderId);
  }

  for (const orderId of orderIds) revalidateOrderSurfaces(orderId);

  const confirmed = confirmedOrderIds.length;
  const failedLabels = failed.length ? await orderNumberLabels(supabase, failed) : '';
  if (!confirmed) {
    return {
      errors: {
        form: `선택한 ${orderIds.length}건을 발주확인하지 못했습니다. 취소 요청이 열려 있거나 이미 상태가 바뀐 주문일 수 있습니다: ${failedLabels}`,
      },
    };
  }
  if (failed.length) {
    /* 실패 건수만 알려주면 운영자가 100건 목록에서 어느 주문이 남았는지 찾지
       못한다. 주문번호를 그대로 실어 보낸다 — 원인은 주문마다 다를 수 있으므로
       (취소 요청·이미 바뀐 상태·일시적 오류) 한 가지로 단정하지 않는다. */
    return {
      confirmedOrderIds,
      message: `${confirmed}건을 발주확인했습니다. 처리하지 못한 ${failed.length}건: ${failedLabels} — 주문 상세에서 취소 요청 여부와 현재 상태를 확인해주세요.`,
    };
  }
  return { confirmedOrderIds, message: `${confirmed}건을 발주확인했습니다.` };
}

export async function updateAdminOrderTrackingAction(
  _state: AdminOrderActionState,
  formData: FormData,
): Promise<AdminOrderActionState> {
  const access = await requireStaffAction();
  if (access.error) return access.error;

  const normalized = normalizeAdminOrderTrackingForm(formData, await getShippingCarrierRegistry());
  if (!normalized.ok) return { errors: normalized.errors };
  const shipmentId = String(formData.get('shipmentId') ?? '').trim();
  if (shipmentId && !isUuid(shipmentId)) return { errors: { form: '배송건번호를 확인해주세요.' } };

  const supabase = await createClient();
  const { error } = await supabase.rpc(shipmentId ? 'admin_update_shipment_tracking' : 'admin_update_order_tracking', {
    p_carrier: normalized.value.carrier,
    ...(shipmentId ? { p_shipment_id: shipmentId } : { p_order_id: normalized.value.orderId }),
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
    ? await sendOrderConfirmationEmail(parsed.orderId, parsed.audience ?? 'payer')
    : await sendOrderShippedEmail({ orderId: parsed.orderId, shipmentId: parsed.shipmentId, audience: parsed.audience ?? 'payer' });

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
  if (!result.ok) return { errors: { form: reviewRequiredMessage(result.code) } };
  if (result.status === 'in_progress') return { message: PAYMENT_RECONCILIATION_IN_PROGRESS };
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
  if (!result.ok) return { errors: { form: reviewRequiredMessage(result.code) } };
  if (result.status === 'in_progress') return { message: PAYMENT_RECONCILIATION_IN_PROGRESS };
  return { message: '결제 취소 상태를 확인했습니다.' };
}

/** DB가 던지는 운영자 전액 취소 거절 코드를 운영자 문구로 옮긴다. 원문은 노출하지 않는다. */
function staffCancellationError(message: string | null | undefined) {
  const value = message ?? '';
  if (value.includes('warehouse_stop_confirmation_required')) {
    return '출고지시 파일이 나간 배송 건이 있습니다. 창고에서 출고 중단을 확인한 뒤 양식의 창고 출고 중단 확인란을 체크하고 다시 실행해주세요. 확인란이 보이지 않으면 새로고침해주세요.';
  }
  if (value.includes('shipment_already_dispatched')) {
    return '이미 발송된 배송 건이 있어 전액 취소할 수 없습니다. 배송 완료 뒤 반품으로 처리하거나 담당자에게 넘겨주세요.';
  }
  if (value.includes('order_not_staff_cancelable')) return '결제완료·발주확인 상태의 발송 전 주문만 전액 취소할 수 있습니다.';
  if (value.includes('order_claim_in_progress')) {
    return '이미 진행 중인 취소·반품·교환 요청이 있습니다. 취소·반품·교환 관리에서 그 요청을 처리해주세요.';
  }
  if (value.includes('payment_reconciliation_required')) return '결제 결과가 아직 확정되지 않았습니다. 결제 상태를 먼저 확인해주세요.';
  if (value.includes('staff_cancellation_toss_only')) {
    return '토스·나이스페이 결제 주문만 이 화면에서 전액 취소할 수 있습니다. Korpay·무통장 주문은 기존 수동 절차를 따릅니다.';
  }
  if (value.includes('invalid_staff_cancellation_note')) return '기타 사유는 메모를 5자 이상 입력해주세요(최대 500자).';
  if (value.includes('invalid_staff_cancellation_reason')) return '취소 사유를 선택해주세요.';
  if (value.includes('staff required')) return '관리자 권한이 필요합니다.';
  if (value.includes('order_not_found')) return '주문을 찾을 수 없습니다.';
  return '전액 취소를 시작하지 못했습니다. 최신 상태를 확인해주세요.';
}

/**
 * 운영자가 시작하는 배송 전 전액 취소(ADR-0018).
 *
 * DB가 사유·운영자·창고 중단 확인과 함께 고객 취소와 같은 원장(요청·claim·환불
 * intent)을 열면, 같은 오케스트레이터로 토스 전액 취소 → fresh 조회 검증 →
 * finalizer까지 바로 실행한다. 고객 직접 신청 정책(ADR-0017)은 바꾸지 않는다 —
 * 발주확인 뒤를 여는 것은 staff 발원 요청이 있는 주문뿐이다.
 */
export async function startAdminOrderCancellationAction(
  _state: AdminOrderActionState,
  formData: FormData,
): Promise<AdminOrderActionState> {
  const access = await requireStaffAction();
  if (access.error || !access.auth?.user) return access.error ?? { errors: { form: '관리자 권한이 필요합니다.' } };

  const normalized = normalizeAdminStaffCancellationForm(formData);
  if (!normalized.ok) return { errors: normalized.errors };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_start_order_cancellation', {
    p_note: normalized.value.note,
    p_order_id: normalized.value.orderId,
    p_reason_code: normalized.value.reasonCode,
    p_warehouse_stop_confirmed: normalized.value.warehouseStopConfirmed,
  });
  if (error) {
    /* 양식을 연 뒤 출고지시·발주확인·다른 요청으로 주문이 바뀌어 DB가 거절했다. 주문 패널을
       최신 상태로 다시 그려야 거절 문구가 가리키는 확인란·버튼이 화면에 있다 — 열 때의
       패널에는 창고 출고 중단 확인란이 없었다(2026-10-12 브라우저 QA R2-2). */
    revalidateOrderSurfaces(normalized.value.orderId);
    revalidatePath('/admin/sales/orders');
    return { errors: { form: staffCancellationError(error.message) } };
  }
  if (typeof data !== 'string' || !isUuid(data)) {
    revalidateOrderSurfaces(normalized.value.orderId);
    return { errors: { form: '전액 취소 요청을 확인하지 못했습니다. 취소 관리에서 최신 상태를 확인해주세요.' } };
  }

  const result = await reconcileApprovedRequest(data, access.auth.user.id);
  revalidateOrderSurfaces(normalized.value.orderId);
  revalidatePath('/admin/sales/claims/cancels');
  if (!result.ok) {
    return {
      errors: {
        form: `전액 취소를 시작했지만 결제 취소를 확정하지 못했습니다(${result.code}). 주문과 재고는 그대로 유지됩니다. 원인을 확인한 뒤 이 주문 패널의 [${ADMIN_CANCELLATION_RECHECK_LABELS.needsReview}](처리중이면 [${ADMIN_CANCELLATION_RECHECK_LABELS.processing}]) 또는 취소 관리 요청 상세의 [환불 완료 확정]으로 다시 시도해주세요.`,
      },
    };
  }
  if (result.status === 'in_progress') {
    /* 요청은 처리중으로 남고 주문 패널에 재확인 버튼이 그려진다. 결과 문구는 그 버튼을 가리킨다. */
    return {
      message: `전액 취소를 시작했지만 결제 상태 처리가 아직 끝나지 않았습니다. 주문과 재고는 그대로 유지됩니다. 잠시 뒤 이 주문 패널의 [${ADMIN_CANCELLATION_RECHECK_LABELS.processing}](결제확인필요면 [${ADMIN_CANCELLATION_RECHECK_LABELS.needsReview}])으로 결과를 확인해주세요.`,
    };
  }
  return { message: '토스 전액 취소를 확인하고 주문 취소를 마쳤습니다. 재고·쿠폰·적립금 복원과 카드팩 회수가 함께 확정됐고 구매자에게 알렸습니다.' };
}

export async function recoverAdminGoodsPaymentAction(
  _state: AdminOrderActionState,
  formData: FormData,
): Promise<AdminOrderActionState> {
  const access = await requireStaffAction();
  if (access.error || !access.auth?.user) {
    return access.error ?? { errors: { form: '관리자 권한이 필요합니다.' } };
  }
  if (!canAccessAdminScreen(access.auth, null, { capability: 'sales.manage', adminOnly: true })) {
    return { errors: { form: 'Korpay 수동 복구는 관리자 계정만 수행할 수 있습니다.' } };
  }

  const normalized = normalizeAdminGoodsManualRecoveryForm(formData);
  if (!normalized.ok) return { errors: normalized.errors };

  try {
    const result = await recoverGoodsPaymentManually({
      ...normalized.value,
      actorId: access.auth.user.id,
    });
    revalidateOrderSurfaces();
    if (result.outcome === 'in_progress') {
      return { errors: { form: '다른 운영 확인이 진행 중입니다. 잠시 뒤 최신 상태를 확인해주세요.' } };
    }
    return { message: 'Korpay 전액 취소 확인을 주문에 반영했습니다.' };
  } catch {
    return { errors: { form: 'Korpay 수동 취소 상태를 반영하지 못했습니다. 최신 상태를 확인해주세요.' } };
  }
}

/* ---------------------------------------------------------------------------
 * 엑셀 일괄 운송장 등록 (#251)
 * ------------------------------------------------------------------------- */

/**
 * 일괄 등록 결과.
 *
 * 건수만 돌려주지 않는다. 100건짜리 파일에서 3건이 실패했을 때 "3건 실패"만 보면
 * 운영자는 어느 주문이 남았는지 목록에서 찾지 못한다 — 주문번호와 사유를 그대로
 * 싣는다(#250에서 같은 지적을 받았다).
 */
export interface AdminTrackingImportFailure {
  line: number;
  reference: string;
  reason: string;
}

export interface AdminTrackingImportState {
  errors?: { form?: string };
  message?: string;
  queueWarning?: boolean;
  report?: {
    succeeded: string[];
    failed: AdminTrackingImportFailure[];
    /** 같은 운송장으로 이미 발송된 배송 건 수(같은 회신을 다시 올린 경우). 아무것도 바꾸지 않았다. */
    unchanged?: number;
    /** 운송장 칸을 비워 건너뛴 줄 수(김포 회신, 아직 출고하지 않은 주문). 실패가 아니다(QA 라운드 1 m8). */
    skipped?: number;
    /** 서원 회신에서 대표 운송장과 함께 저장한 분리배송 추가 운송장 수(QNA-019). 없으면 키가 없다. */
    extraTrackings?: number;
  };
}

/** 등록 전 확인(QA 라운드 1 m2): 파일·붙여넣기를 읽기만 하고 아무것도 바꾸지 않은 결과. */
export interface AdminTrackingImportPreview {
  /** 알아본 회신 양식 이름. */
  format: string;
  /** 등록을 시도할 줄 수. 실제 등록 여부는 등록할 때 배송 건 상태로 다시 정한다. */
  ready: number;
  /** 운송장 칸을 비워 건너뛸 줄 수. */
  skipped: number;
  /** 읽는 단계에서 이미 등록할 수 없는 줄(앞에서 최대 20줄). */
  issues: AdminTrackingImportFailure[];
  issueCount: number;
  /** 등록할 줄의 앞부분(최대 5줄): 줄 번호·대상·운송장. */
  sample: { line: number; reference: string; trackingNumber: string }[];
}

const isSmartStoreReply = (parsed: TrackingWorkbookParseResult): parsed is Extract<TrackingWorkbookParseResult, { kind: 'smartstore' }> => 'kind' in parsed && parsed.kind === 'smartstore';
const isSeowonReply = (parsed: TrackingWorkbookParseResult): parsed is SeowonTrackingParseResult => 'kind' in parsed && parsed.kind === 'seowon';
type TrackingBatchRow = {line:number;reference:string;ok:boolean;error?:string;shipmentId?:string;orderId?:string;dispatched?:boolean;duplicate?:boolean;packedShipments?:{orderId:string;shipmentId:string}[];extraTrackingNumbers?:string[];extraTrackingsAdded?:number};
type ReplyTemplate = 'wms_csv' | 'seowon_xlsx';
const REPLY_TEMPLATE_LABEL: Record<ReplyTemplate, string> = { wms_csv: '김포 WMS 21열', seowon_xlsx: '남양주(서원) 송장양식' };

/**
 * 창고 회신을 보낸 출고지. 목록에서 고른 출고지가 그 양식이면 그것을, 아니면 그 양식을 쓰는
 * 사용 중 출고지가 하나뿐일 때 그것을 쓴다 — 회신은 어느 탭·필터에서 올려도 된다.
 */
async function resolveReplyOrigin(supabase: Awaited<ReturnType<typeof createClient>>, template: ReplyTemplate, requested: string) {
  const { data, error } = await supabase.from('fulfillment_origins').select('id,name').eq('export_template', template).eq('is_active', true);
  if (error || !data) throw new Error('출고지 설정을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
  const origin = data.find(row => row.id === requested.toLowerCase()) ?? (data.length === 1 ? data[0] : null);
  if (origin) return origin as { id: string; name: string };
  throw new Error(data.length
    ? `${REPLY_TEMPLATE_LABEL[template]} 양식을 쓰는 출고지가 여러 곳입니다. 목록 위에서 회신을 보낸 출고지를 선택한 뒤 올려주세요.`
    : `${REPLY_TEMPLATE_LABEL[template]} 양식을 쓰는 사용 중인 출고지가 없습니다. 출고지 설정을 확인해주세요.`);
}

function trackingImportResult(succeeded: string[], failed: AdminTrackingImportFailure[], unchanged: number, queueWarning: boolean, counts: { blankLines?: number; extraTrackings?: number } = {}): AdminTrackingImportState {
  const blankLines=counts.blankLines??0, extraTrackings=counts.extraTrackings??0;
  failed.sort((a,b)=>a.line-b.line);
  const report={failed,succeeded,...(unchanged?{unchanged}:{}),...(blankLines?{skipped:blankLines}:{}),...(extraTrackings?{extraTrackings}:{})};
  const extras=extraTrackings?` 분리배송 추가 운송장 ${extraTrackings}개를 함께 저장했습니다.`:'';
  const skipped=`${unchanged?` 같은 운송장으로 이미 발송된 ${unchanged}건은 그대로 두었습니다.`:''}${blankLines?` 운송장 칸을 비운 ${blankLines}줄은 아직 출고하지 않은 것으로 보고 건너뛰었습니다.`:''}`;
  if(!succeeded.length){
    if((unchanged||blankLines)&&!failed.length)return {message:`새로 등록할 운송장이 없습니다.${skipped}`,report};
    return {errors:{form:`${failed.length}건을 등록하지 못했습니다. 행별 사유를 확인해주세요.${skipped}`},report};
  }
  return {message:`${succeeded.length}건의 운송장을 등록했습니다.${extras}${skipped}${failed.length?` 실패 ${failed.length}건은 행별 사유를 확인해주세요.`:''}${queueWarning?' 배송 메일 대기열 확인이 필요합니다. 발송 이력에서 확인해주세요.':''}`,report,...(queueWarning?{queueWarning:true}:{})};
}

/**
 * 붙여넣기 또는 올린 파일을 회신 양식으로 읽는다(쓰기 없음). 등록과 등록 전 확인이 같은 규칙으로 읽도록 한 곳에 둔다.
 * 파일이 있으면 붙여넣기보다 파일을 읽는다.
 */
async function readTrackingImport(formData: FormData): Promise<{ parsed: TrackingWorkbookParseResult } | { error: string }> {
  const carriers = await getShippingCarrierRegistry();
  try {
    const file = formData.get('file');
    if (file instanceof File && file.size > 0) {
      const workbook=/\.xlsx$/i.test(file.name);
      if (file.size > TRACKING_IMPORT_FILE_LIMIT_BYTES) return {error:`${workbook?'XLSX':'CSV·TSV·텍스트'} 파일은 1MB 이하로 올려주세요. 운송장은 1,000줄까지 등록할 수 있습니다.`};
      const password=formData.get('filePassword');
      if (workbook) return {parsed:await parseTrackingWorkbook(Buffer.from(await file.arrayBuffer()),carriers,typeof password==='string'?password:'')};
      if (/\.(csv|tsv|txt)$/i.test(file.name)) {
        const text=decodeSpreadsheetText(new Uint8Array(await file.arrayBuffer()));
        if(/^\uFEFF?"?받는분전화번호/.test(text))return {error:'남양주(서원) 송장양식 회신은 XLSX로 올려주세요.'};
        // 표준 양식 CSV는 열이 많아 XLSX와 같은 1MB까지 받는다. 일반 세 칸 회신은 종전대로 256KB다.
        const standard=parseSmartStoreReplyText(text,carriers);
        if(!standard&&file.size>TRACKING_IMPORT_TEXT_LIMIT_BYTES)return {error:'CSV·TSV·텍스트 파일은 256KB 이하로 올려주세요. 운송장은 1,000줄까지 등록할 수 있습니다.'};
        return {parsed:standard??parseTrackingImport(text,carriers)};
      }
      return {error:'XLSX 또는 CSV·TSV 파일을 올려주세요.'};
    }
    const text=String(formData.get('pasted')??'');
    if(Buffer.byteLength(text,'utf8')>TRACKING_IMPORT_TEXT_LIMIT_BYTES)return {error:'붙여넣기 내용은 256KB 이하로 나누어주세요.'};
    return {parsed:parseSmartStoreReplyText(text,carriers)??parseTrackingImport(text,carriers)};
  } catch(error) { return {error:error instanceof Error?error.message:'운송장 파일을 읽지 못했습니다.'}; }
}

const blankReplyLines = (parsed: TrackingWorkbookParseResult) => 'kind' in parsed && (parsed.kind === 'gimpo' || parsed.kind === 'smartstore') ? parsed.skipped.length : 0;

/**
 * 등록 전 확인(QA 라운드 1 m2): 잘못 고른 파일이 바로 등록되지 않도록, 올린 회신을 읽기만 해서 알아본 양식·등록할 줄·건너뛸 줄·
 * 읽는 단계의 오류를 먼저 보여 준다. DB는 읽지도 바꾸지도 않는다. 권한은 등록과 같다(출고 권한).
 */
export async function previewAdminOrderTrackingImportAction(formData: FormData): Promise<{ preview?: AdminTrackingImportPreview; error?: string }> {
  const access = await requireDispatchAction();
  if (access.error) return { error: access.error.errors?.form ?? '관리자 권한이 필요합니다.' };
  const read = await readTrackingImport(formData);
  if ('error' in read) return { error: read.error };
  const parsed = read.parsed;
  const kind = 'kind' in parsed ? parsed.kind : 'generic';
  const format = kind === 'gimpo' ? '김포 WMS 21열' : kind === 'seowon' ? '남양주(서원) 송장양식' : kind === 'smartstore' ? 'ICONS 표준 양식' : '배송건번호 · 택배사코드 · 운송장번호';
  const rows: { line: number; reference: string; trackingNumber: string }[] = isSeowonReply(parsed)
    ? parsed.rows.filter(row => !row.error).map(row => ({ line: row.line, reference: row.shipmentNumber ?? row.items, trackingNumber: row.trackingNumber }))
    : parsed.rows.map(row => ({ line: row.line, reference: row.reference, trackingNumber: row.trackingNumber }));
  const issues: AdminTrackingImportFailure[] = isSeowonReply(parsed)
    ? parsed.rows.filter(row => row.error).map(row => ({ line: row.line, reference: row.shipmentNumber ?? row.items, reason: row.error! }))
    : [...parsed.issues];
  issues.sort((a, b) => a.line - b.line);
  const skipped = blankReplyLines(parsed);
  if (!rows.length && !issues.length && !skipped) return { error: '등록할 운송장을 붙여넣거나 파일을 선택해주세요.' };
  if (rows.length + issues.length > TRACKING_IMPORT_ROW_LIMIT) return { error: '운송장은 한 번에 1,000줄까지 등록할 수 있습니다.' };
  return { preview: { format, ready: rows.length, skipped, issues: issues.slice(0, 20), issueCount: issues.length, sample: rows.slice(0, 5) } };
}

async function enqueueDispatched(deliveries: { orderId: string; shipmentId: string }[]) {
  if (!deliveries.length) return false;
  try { await enqueueOrderShippedEmails(deliveries); return false; } catch { return true; }
}

/**
 * 남양주(서원) 회신: 내려받은 송장양식 줄에 송장번호만 채운 파일. 서원은 주문번호를 돌려주지 않아
 * 출고지의 대조 후보와 줄 내용으로 배송 건을 찾은 뒤, 배송 건마다 한 번 기존 일괄 등록 RPC로 보낸다.
 */
async function registerSeowonReply(parsed: SeowonTrackingParseResult, requestedOrigin: string): Promise<AdminTrackingImportState> {
  if(!parsed.rows.length)return {errors:{form:'등록할 운송장을 붙여넣거나 파일을 선택해주세요.'}};
  if(parsed.rows.length>TRACKING_IMPORT_ROW_LIMIT)return {errors:{form:'운송장은 한 번에 1,000줄까지 등록할 수 있습니다.'}};
  const supabase=await createClient();
  let origin: { id: string; name: string };
  try { origin = await resolveReplyOrigin(supabase, 'seowon_xlsx', requestedOrigin); }
  catch (error) { return { errors: { form: error instanceof Error ? error.message : '출고지를 확인해주세요.' } }; }
  // 후보는 회신에 나온 전화번호의 배송 건으로 좁힌다. 오류 줄의 배송 건도 함께 막아야 하므로 모든 줄의 번호를 쓴다.
  const waybills=[...new Set(parsed.rows.filter(row=>!row.error).map(row=>row.trackingNumber))];
  const phones=[...new Set(parsed.rows.map(row=>row.phone.replace(/\D/g,'')).filter(Boolean))];
  const loaded=await supabase.rpc('admin_origin_tracking_candidates',{target_origin_id:origin.id,target_tracking_numbers:waybills,target_phones:phones});
  const candidates=loaded.data as {defaultCarrier?:string|null;truncated?:boolean;shipments?:SeowonReplyCandidate[];usedTracking?:{trackingNumber:string;shipmentId:string}[]}|null;
  if(loaded.error||!candidates||!Array.isArray(candidates.shipments)||!Array.isArray(candidates.usedTracking))return {errors:{form:'남양주 배송 건을 불러오지 못했습니다. 잠시 후 같은 파일로 다시 시도해주세요.'}};
  if(!candidates.defaultCarrier)return {errors:{form:shipmentMutationError('warehouse_carrier_required')}};
  // 일부 후보만으로 대조하면 빠진 같은 내용의 배송 건 대신 남은 건이 발송될 수 있다. 잘렸으면 아무것도 바꾸지 않는다.
  if(candidates.truncated)return {errors:{form:'대조할 배송 건이 너무 많아 등록하지 않았습니다. 회신 파일을 나눠 올려주세요.'}};
  const match=matchSeowonReply(parsed.rows,candidates.shipments,candidates.usedTracking);
  const failed:AdminTrackingImportFailure[]=[...match.issues];const succeeded:string[]=[];
  let queueWarning=false;let unchanged=match.unchanged.length;let extraTrackings=0;
  if(match.commands.length){
    // 분리배송 연결 송장(QNA-019)은 대표 운송장과 같은 행에 추가 운송장으로 실어 DB가 같은 트랜잭션에서 붙인다.
    const result=await supabase.rpc('admin_import_seowon_tracking_batch',{target_origin_id:origin.id,target_rows:match.commands.map(command=>({
      line:command.line,reference:command.shipmentId,carrier:candidates.defaultCarrier,trackingNumber:command.trackingNumber,
      ...(command.extraTrackingNumbers?.length?{extraTrackingNumbers:command.extraTrackingNumbers}:{}),
    }))});
    if(result.error?.message&&/^(warehouse_|shipment_pack_|production_|inactive_shipping_carrier$|invalid_tracking_|tracking_number_in_use$|shipment_tracking_conflict$)/.test(result.error.message))
      return {errors:{form:shipmentMutationError(result.error.message)}};
    if(result.error||!Array.isArray(result.data)||result.data.length!==match.commands.length)return {errors:{form:'등록 결과를 확인하지 못했습니다. 최신 배송 상태를 확인하고 같은 파일로 다시 시도해주세요.'}};
    // 합배송한 배송 건들은 같은 첫 줄을 공유하므로 결과는 줄이 아니라 배송 건으로 찾는다.
    const outcomes=new Map((result.data as TrackingBatchRow[]).map(row=>[row.reference,row]));
    const deliveries:{orderId:string;shipmentId:string}[]=[];
    for(const command of match.commands){
      const outcome=outcomes.get(command.shipmentId),reference=commerceReferenceLabel(command.shipmentId,command.shipmentNumber);
      // 실제로 새로 붙은 추가 운송장 수(합포장 구성원이 묶음으로 먼저 발송돼 '그대로'로 끝난 행도 이번 회신의 번호를 붙인다).
      if(outcome?.ok&&Number.isSafeInteger(outcome.extraTrackingsAdded))extraTrackings+=outcome.extraTrackingsAdded!;
      if(outcome?.ok&&outcome.dispatched!==false){succeeded.push(reference);deliveries.push(...(outcome.packedShipments??[{orderId:command.orderId,shipmentId:command.shipmentId}]));}
      else if(outcome?.ok)unchanged++; // 다른 운영자가 같은 회신을 먼저 등록했다.
      else for(const line of command.lines)failed.push({line,reference,reason:shipmentMutationError(outcome?.error??'')});
    }
    queueWarning=await enqueueDispatched([...new Map(deliveries.map(row=>[row.shipmentId,row])).values()]);
    revalidateOrderSurfaces();
  }
  return trackingImportResult(succeeded,failed,unchanged,queueWarning,{extraTrackings});
}

/** The DB batch keeps per-row failures and commits each valid shipment once. */
export async function bulkRegisterAdminOrderTrackingAction(
  _state: AdminTrackingImportState, formData: FormData,
): Promise<AdminTrackingImportState> {
  const access = await requireDispatchAction();
  if (access.error) return { errors: { form: access.error.errors?.form } };
  const read = await readTrackingImport(formData);
  if ('error' in read) return { errors: { form: read.error } };
  const parsed = read.parsed;
  const requestedOrigin=String(formData.get('originId')??'');
  if(isSeowonReply(parsed))return registerSeowonReply(parsed,requestedOrigin);
  const count=parsed.rows.length+parsed.issues.length;
  const blankLines=blankReplyLines(parsed);
  if(!count)return {errors:{form:blankLines?`운송장번호를 채운 줄이 없습니다. 운송장 칸을 비운 ${blankLines}줄은 아직 출고하지 않은 것으로 보고 건너뛰었습니다.`:'등록할 운송장을 붙여넣거나 파일을 선택해주세요.'}};
  if(count>TRACKING_IMPORT_ROW_LIMIT)return {errors:{form:'운송장은 한 번에 1,000줄까지 등록할 수 있습니다.'}};
  const supabase=await createClient();
  let command: ReturnType<typeof trackingImportCommand>;
  try {
    const originId='kind' in parsed&&parsed.kind==='gimpo'?(await resolveReplyOrigin(supabase,'wms_csv',requestedOrigin)).id:requestedOrigin;
    command = trackingImportCommand(parsed, originId);
  }
  catch (error) { return { errors: { form: error instanceof Error ? error.message : '출고지를 확인해주세요.' } }; }
  const failed:AdminTrackingImportFailure[]=[...parsed.issues];
  const succeeded:string[]=[];
  let queueWarning=false;let unchanged=0;
  if(parsed.rows.length){
    const result=await supabase.rpc(command.name,command.args);
    if(result.error?.message&&/^(warehouse_|shipment_pack_|inactive_shipping_carrier$|invalid_tracking_)/.test(result.error.message))
      return {errors:{form:shipmentMutationError(result.error.message)}};
    if(result.error||!Array.isArray(result.data)||result.data.length!==command.args.target_rows.length)return {errors:{form:'등록 결과를 확인하지 못했습니다. 최신 배송 상태를 확인하고 같은 파일로 다시 시도해주세요.'}};
    const rows=result.data as TrackingBatchRow[];
    for(const row of rows){
      // 표준 양식에서 운송장 칸만 비워 건너뛴 줄은 배송 건 가드용으로만 보냈다. 그 줄 자체의 거절은 실패가 아니다.
      if(!row.ok){if(!parsed.issues.some(issue=>issue.line===row.line)&&!(isSmartStoreReply(parsed)&&parsed.skipped.some(blank=>blank.line===row.line)))failed.push({line:row.line,reference:row.reference,reason:shipmentMutationError(row.error??'')});}
      else if(row.duplicate)continue;
      else if(row.dispatched===false)unchanged++;
      else succeeded.push(row.reference);
    }
    const deliveryRows=rows.filter(row=>row.ok&&!row.duplicate&&row.dispatched!==false&&row.shipmentId&&row.orderId).flatMap(row=>row.packedShipments??[{orderId:row.orderId!,shipmentId:row.shipmentId!}]);
    queueWarning=await enqueueDispatched([...new Map(deliveryRows.map(row=>[row.shipmentId,row])).values()]);
    revalidateOrderSurfaces();
  }
  return trackingImportResult(succeeded,failed,unchanged,queueWarning,{blankLines});
}

/**
 * 발송지연 메모 저장·해제 (#251).
 *
 * 지연은 상태가 아니라 메모다. 자사몰이라 지연에 붙는 페널티가 없고, 사다리에
 * 칸을 만들면 발송처리 때 되돌려야 하는 전이가 생긴다. 사유를 비워 저장하면
 * 메모가 지워진다.
 */
export async function saveAdminOrderDispatchDelayAction(
  _state: AdminOrderActionState,
  formData: FormData,
): Promise<AdminOrderActionState> {
  const access = await requireStaffAction();
  if (access.error) return access.error;

  const normalized = normalizeAdminDispatchDelayForm(formData);
  if (!normalized.ok) return { errors: normalized.errors };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_upsert_order_dispatch_delay', {
    p_expected_ship_date: normalized.value.expectedShipDate,
    p_order_id: normalized.value.orderId,
    p_reason: normalized.value.reason,
  });
  if (error) {
    return { errors: { form: '지연 메모를 저장하지 못했습니다. 최신 상태를 확인해주세요.' } };
  }

  revalidateOrderSurfaces(normalized.value.orderId);
  return {
    message: normalized.value.reason ? '지연 메모를 저장했습니다.' : '지연 메모를 지웠습니다.',
  };
}
