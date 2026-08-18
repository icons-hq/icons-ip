'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { normalizeAdminDispatchDelayForm } from '@/lib/admin/dispatch';
import {
  ADMIN_ORDER_STATUS_LABELS,
  normalizeAdminCancellationDecisionForm,
  normalizeAdminGoodsManualRecoveryForm,
  normalizeAdminOrderStatusForm,
  normalizeAdminOrderTrackingForm,
  type AdminOrderFieldErrors,
  type AdminOrderFormStatus,
  type AdminOrderStatus,
} from '@/lib/admin/orders';
import {
  parseTrackingImport,
  TRACKING_IMPORT_ROW_LIMIT,
  type TrackingImportRow,
} from '@/lib/admin/tracking-import';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { parseOrderEmailDedupeKey } from '@/lib/email/dedupe';
import {
  sendOrderConfirmationEmail,
  sendOrderShippedEmail,
} from '@/lib/email/transactional.server';
import { orderReferenceLabel } from '@/lib/orders';
import { reconcileOrderCancellation } from '@/lib/orders/cancellation-orchestrator.server';
import { recoverGoodsPaymentManually } from '@/lib/payments/goods-manual-recovery.server';
import { orderShipment } from '@/lib/orders/shipment';
import { getShippingCarrierRegistry } from '@/lib/orders/shipment.server';
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
  /* 상태 전이는 발주·발송과 배송현황 목록을 동시에 움직인다. 한쪽만 갱신하면
     방금 처리한 주문이 다른 화면에 그대로 남아 두 번 처리된다(#251). */
  revalidatePath('/admin/sales/dispatch');
  revalidatePath('/admin/sales/shipping');
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
    const shipment = orderShipment(
      carriers,
      normalized.value.carrier,
      normalized.value.trackingNumber,
    );
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
  return { message: STATUS_TRANSITION_MESSAGES[normalized.value.status] };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
      .filter((value) => UUID_PATTERN.test(value)),
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
  let confirmed = 0;
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
    confirmed += 1;
  }

  for (const orderId of orderIds) revalidateOrderSurfaces(orderId);

  if (!confirmed) {
    return {
      errors: {
        form: `선택한 ${orderIds.length}건을 발주확인하지 못했습니다. 취소 요청이 열려 있거나 이미 상태가 바뀐 주문일 수 있습니다: ${
          failed.map(orderReferenceLabel).join(', ')
        }`,
      },
    };
  }
  if (failed.length) {
    /* 실패 건수만 알려주면 운영자가 100건 목록에서 어느 주문이 남았는지 찾지
       못한다. 주문번호를 그대로 실어 보낸다 — 원인은 주문마다 다를 수 있으므로
       (취소 요청·이미 바뀐 상태·일시적 오류) 한 가지로 단정하지 않는다. */
    return {
      message: `${confirmed}건을 발주확인했습니다. 처리하지 못한 ${failed.length}건: ${
        failed.map(orderReferenceLabel).join(', ')
      } — 주문 상세에서 취소 요청 여부와 현재 상태를 확인해주세요.`,
    };
  }
  return { message: `${confirmed}건을 발주확인했습니다.` };
}

export async function updateAdminOrderTrackingAction(
  _state: AdminOrderActionState,
  formData: FormData,
): Promise<AdminOrderActionState> {
  const access = await requireStaffAction();
  if (access.error) return access.error;

  const normalized = normalizeAdminOrderTrackingForm(formData, await getShippingCarrierRegistry());
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
  if (!result.ok) return { errors: { form: REVIEW_REQUIRED } };
  if (result.status === 'in_progress') return { message: PAYMENT_RECONCILIATION_IN_PROGRESS };
  return { message: '결제 취소 상태를 정합화했습니다.' };
}

export async function recoverAdminGoodsPaymentAction(
  _state: AdminOrderActionState,
  formData: FormData,
): Promise<AdminOrderActionState> {
  const access = await requireStaffAction();
  if (access.error || !access.auth?.user) {
    return access.error ?? { errors: { form: '관리자 권한이 필요합니다.' } };
  }
  if (access.auth.role !== 'admin') {
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
    return { message: 'Korpay 전액 취소 확인을 주문 정합화에 반영했습니다.' };
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
  report?: {
    succeeded: string[];
    failed: AdminTrackingImportFailure[];
  };
}

/** 업로드 파일 상한. 100줄짜리 CSV는 몇 KB다. */
const TRACKING_IMPORT_FILE_LIMIT_BYTES = 256 * 1024;

interface SearchOrderRow {
  id: string;
  status: string;
}

async function readTrackingImportSource(formData: FormData) {
  const file = formData.get('file');
  if (file instanceof File && file.size > 0) {
    if (file.size > TRACKING_IMPORT_FILE_LIMIT_BYTES) {
      return { error: '파일이 너무 큽니다. 100건 이하로 나눠 올려주세요.' };
    }
    return { text: await file.text() };
  }
  return { text: String(formData.get('pasted') ?? '') };
}

/**
 * 파일에 적힌 주문번호를 실제 주문으로 푼다.
 *
 * `admin_search_orders`를 그대로 쓴다 — staff 권한 검사가 그 안에 있고, orders를
 * 직접 읽으면 같은 검사를 한 벌 더 만들게 된다. 상태 필터를 걸지 않는 이유는
 * "주문이 없다"와 "발주확인 상태가 아니다"를 구분해 돌려주기 위해서다.
 */
async function resolveTrackingImportOrder(
  supabase: Awaited<ReturnType<typeof createClient>>,
  row: TrackingImportRow,
): Promise<{ id: string } | { reason: string }> {
  const { data, error } = await supabase.rpc('admin_search_orders', {
    p_from: null,
    p_limit: 100,
    p_offset: 0,
    p_query: row.orderId ?? row.reference,
    p_status: null,
    p_to: null,
  });
  if (error) return { reason: '주문을 조회하지 못했습니다. 잠시 뒤 다시 시도해주세요.' };

  /* 검색은 부분 일치라 닉네임·이메일에 같은 문자열이 든 주문까지 걸린다.
     주문번호가 정확히 같은 것만 남긴다. */
  const matches = ((data ?? []) as SearchOrderRow[]).filter((candidate) => (
    row.orderId
      ? candidate.id === row.orderId
      : orderReferenceLabel(candidate.id) === row.reference
  ));

  if (!matches.length) return { reason: '주문을 찾을 수 없습니다.' };
  if (matches.length > 1) {
    return { reason: '주문번호가 여러 주문과 일치합니다. 전체 주문 UUID로 다시 올려주세요.' };
  }

  const [match] = matches;
  if (match.status !== 'confirmed') {
    const label = ADMIN_ORDER_STATUS_LABELS[match.status as AdminOrderStatus] ?? match.status;
    return { reason: `발주확인 상태가 아닙니다(현재: ${label}).` };
  }
  return { id: match.id };
}

/**
 * 엑셀(CSV/TSV) 일괄 운송장 등록.
 *
 * 건별로 기존 `admin_update_order_status`를 부른다. 일괄 전용 RPC를 만들지 않는
 * 이유는 전이 규칙·활성 클레임 검사·운송장 필수 게이트·감사 로그가 이미 그 함수
 * 안에 있기 때문이다 — 우회로를 만들면 규칙이 두 벌이 된다(#250과 같은 판단).
 *
 * 한 줄이 실패해도 나머지를 멈추지 않는다. 창고에서 이미 나간 물건의 운송장을
 * 한 줄 때문에 통째로 되돌리면 운영자는 무엇이 등록됐는지 모른 채 다시 올린다.
 *
 * **어드민이 운송장의 진실원이 아니다.** 김포 창고는 WMS로 운송장을 발행하고,
 * 이 경로는 그 결과를 옮겨 적는 운영 기록이다(#177). 포맷을 파일로 유지하는 것이
 * WMS와의 접점이다.
 */
export async function bulkRegisterAdminOrderTrackingAction(
  _state: AdminTrackingImportState,
  formData: FormData,
): Promise<AdminTrackingImportState> {
  const access = await requireStaffAction();
  if (access.error) return { errors: { form: access.error.errors?.form } };

  const source = await readTrackingImportSource(formData);
  if ('error' in source) return { errors: { form: source.error } };
  if (!source.text.trim()) {
    return { errors: { form: '등록할 내용을 붙여넣거나 파일을 선택해주세요.' } };
  }

  const carriers = await getShippingCarrierRegistry();
  const parsed = parseTrackingImport(source.text, carriers);

  if (parsed.rows.length + parsed.issues.length === 0) {
    return { errors: { form: '읽을 수 있는 줄이 없습니다. 주문번호·택배사코드·운송장번호 세 칸을 확인해주세요.' } };
  }
  if (parsed.rows.length > TRACKING_IMPORT_ROW_LIMIT) {
    return {
      errors: {
        form: `한 번에 등록할 수 있는 운송장은 ${TRACKING_IMPORT_ROW_LIMIT}건까지입니다. 파일을 나눠 올려주세요.`,
      },
    };
  }

  const supabase = await createClient();
  const succeeded: string[] = [];
  const failed: AdminTrackingImportFailure[] = parsed.issues.map((issue) => ({
    line: issue.line,
    reference: issue.reference,
    reason: issue.reason,
  }));

  for (const row of parsed.rows) {
    const resolved = await resolveTrackingImportOrder(supabase, row);
    if ('reason' in resolved) {
      failed.push({ line: row.line, reference: row.reference, reason: resolved.reason });
      continue;
    }

    const { error } = await supabase.rpc('admin_update_order_status', {
      p_carrier: row.carrier,
      p_order_id: resolved.id,
      p_status: 'shipping',
      p_tracking_number: row.trackingNumber,
    });
    if (error) {
      failed.push({
        line: row.line,
        reference: row.reference,
        reason: '발송처리에 실패했습니다. 취소 요청이 열려 있는지 주문 상세에서 확인해주세요.',
      });
      continue;
    }

    succeeded.push(row.reference);
    revalidateOrderSurfaces(resolved.id);

    // 배송 시작 메일. 발송 결과는 상태 전이에 영향을 주지 않는다(#180).
    const shipment = orderShipment(carriers, row.carrier, row.trackingNumber);
    const delivery = await sendOrderShippedEmail({
      orderId: resolved.id,
      carrierName: shipment?.carrierLabel ?? null,
      trackingNumber: shipment?.trackingNumber ?? null,
      trackingUrl: shipment?.trackingUrl ?? null,
    });
    if (delivery.status === 'failed') {
      console.error(`[admin] shipped email failed (order:${resolved.id}): ${delivery.error}`);
    }
  }

  /* 실패한 줄만 있어도 리포트를 돌려준다 — 사유가 줄마다 다르므로 한 문장으로
     접으면 운영자가 무엇을 고쳐 다시 올릴지 알 수 없다. */
  const report = { failed, succeeded };
  if (!succeeded.length) {
    return {
      errors: { form: `${failed.length}건을 등록하지 못했습니다. 아래 사유를 확인해주세요.` },
      report,
    };
  }
  return {
    message: failed.length
      ? `${succeeded.length}건을 발송처리했습니다. 처리하지 못한 ${failed.length}건은 아래에 있습니다.`
      : `${succeeded.length}건을 발송처리했습니다.`,
    report,
  };
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
