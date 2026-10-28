'use server';

import { canAccessAdminScreen, hasAdminCapability } from '@/lib/admin/access';

import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import {
  ADMIN_CLAIM_BULK_DB_ITEM_RESERVE_MS,
  ADMIN_CLAIM_BULK_PROVIDER_ITEM_RESERVE_MS,
  adminClaimBulkSummary,
  normalizeAdminClaimBulkForm,
  runAdminClaimBulkSequentially,
  type AdminClaimBulkState,
} from '@/lib/admin/claim-bulk';
import {
  adminClaimBasePath,
  normalizeAdminClaimCollectionForm,
  normalizeAdminClaimOriginCollectionForm,
  normalizeAdminClaimOperationalFeeForm,
  normalizeAdminClaimEvidenceForm,
  normalizeAdminClaimDecisionForm,
  normalizeAdminClaimRefundForm,
  normalizeAdminClaimReshipmentForm,
} from '@/lib/admin/claims';
import { loadAdminClaimDetail } from '@/lib/admin/claims.server';
import { ADMIN_CANCELLATION_RECHECK_LABELS } from '@/lib/admin/orders';
import { withPreservedFormValues, type AdminFormValuesState } from '@/lib/admin/form-state';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import {
  ORDER_CLAIM_TYPE_LABELS,
  isOrderClaimType,
  orderClaimReferenceLabel,
  orderClaimRefundMethodForProvider,
  type OrderClaimRefundMethod,
  type OrderClaimType,
} from '@/lib/orders/claims';
import { reconcileOrderCancellation } from '@/lib/orders/cancellation-orchestrator.server';
import { recoverGoodsPaymentManually } from '@/lib/payments/goods-manual-recovery.server';
import { createClient } from '@/lib/supabase/server';

/* 어드민 클레임 콘솔 액션(#252).
 *
 * 이 파일은 돈을 직접 움직이지 않는다. 재고 복원과 카드팩 회수는
 * finalize_order_cancellation_with_provider_evidence 한 곳에만 있고, 여기서는
 * 이미 있는 정합화 경로 — 취소 요청 오케스트레이터와 Korpay 수동 복구 seam —
 * 를 그대로 호출한 뒤 그 결과를 환불 원장에 적을 뿐이다. 두 번째 원장을 만들면
 * "환불은 완료인데 재고는 그대로"인 주문이 생긴다.
 *
 * 토스 결제의 취소 클레임은 승인하는 순간 오케스트레이터가 토스 전액 취소를 발행하고
 * fresh 조회로 확인한다(2026-10-12 점검 REF-2). '환불 완료 확정'도 같은 경로를 다시
 * 부른다 — 그 버튼이 결제사 취소를 발행하는 지점이지, 운영자가 결제사 원장에서 취소를
 * 먼저 확인하는 버튼이 아니다. */

export interface AdminClaimActionState extends AdminFormValuesState {
  error?: string;
  message?: string;
}

const DECIDE_FAILED = '클레임을 처리하지 못했습니다. 최신 상태를 확인해주세요.';
const COLLECTION_FAILED = '수거 상태를 기록하지 못했습니다. 최신 상태를 확인해주세요.';
const REFUND_FAILED = '환불 원장을 기록하지 못했습니다. 최신 상태를 확인해주세요.';
const RESHIP_FAILED = '재출고를 기록하지 못했습니다. 최신 상태를 확인해주세요.';
const OPERATIONAL_FEE_FAILED = '운영 확인액을 기록하지 못했습니다. 최신 클레임을 다시 확인해주세요.';
const FINALIZE_FAILED = '결제 취소 상태를 확정하지 못했습니다. 주문과 재고는 그대로 유지됩니다. 정합화 오류를 확인한 뒤 다시 시도해주세요.';
/** 정합화 결과 코드가 있는 실패. 코드별 조치를 찾을 수 있게 그대로 싣는다(QA-10). */
function finalizeFailed(code: string) {
  return `결제 취소 상태를 확정하지 못했습니다(${code}). 주문과 재고는 그대로 유지됩니다. 정합화 오류의 코드별 조치를 확인한 뒤 다시 시도해주세요.`;
}
const IN_PROGRESS = '결제 상태 처리가 아직 끝나지 않았습니다. 주문과 재고는 그대로 유지됩니다.';
const REFUND_METHOD_MISMATCH = '이 결제의 환불 수단과 다릅니다. 토스 결제는 결제사 취소(토스 전액 취소)로만 환불합니다. 화면을 새로고침한 뒤 다시 진행해주세요.';

const DECISION_MESSAGES: Record<string, string> = {
  review: '검토중으로 표시했습니다.',
  approve: '클레임을 승인하고 수거를 시작했습니다.',
  reject: '클레임을 거부했습니다.',
  hold: '클레임을 보류했습니다.',
  resume: '보류를 해제했습니다.',
};

/** DB가 던지는 message를 운영자 문구로 옮긴다. 원문을 그대로 노출하지 않는다. */
function rpcErrorMessage(message: string | null | undefined, fallback: string) {
  const value = (message ?? '').toLowerCase();
  if (value.includes('claim_collections_incomplete')) return '모든 출고지의 회수를 확인한 뒤 환불·재출고를 진행해주세요.';
  if (value.includes('origin_collection_required')) return '출고지별 회수 확인에서 각 배송 건의 입고를 기록해주세요.';
  if (value.includes('claim_return_address_required')) return '출고지 설정에 반송 주소를 등록한 뒤 다시 진행해주세요.';
  if (value.includes('claim_collection_conflict')) return '이미 다른 근거로 회수 확인된 배송 건입니다. 이력을 확인해주세요.';
  if (value.includes('claim_collection_not_found')) return '이 클레임에 속한 회수 배송 건을 찾을 수 없습니다.';
  if (value.includes('invalid_collection_evidence')) return '회수 확인 근거를 500자 이내로 입력해주세요.';
  if (value.includes('invalid_reshipment_delivery_evidence')) return '교환품 배송완료 확인 근거를 500자 이내로 입력해주세요.';
  if (value.includes('reshipment_delivery_conflict')) return '이미 기록된 배송완료 확인과 다릅니다. 담당자와 근거를 확인해주세요.';
  if (value.includes('claim_not_reshipped') || value.includes('claim_reshipment_not_dispatched')) return '재출고 운송장이 기록된 교환만 배송완료를 확인할 수 있습니다.';
  if (value.includes('order_not_cancelable') || value.includes('claim_not_cancelable')) return '발주확인 이후 주문은 취소를 승인할 수 없습니다. 배송·회수 상태와 접수 이력을 확인해주세요.';
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
  if (value.includes('claim_type_has_no_collection')) return '이 클레임에는 회수 확인이 필요하지 않습니다. 최신 처리 이력을 확인해주세요.';
  if (value.includes('claim_type_has_no_reshipment')) return '교환 클레임만 재출고를 기록할 수 있습니다.';
  if (value.includes('claim_not_rejectable')) {
    return '처리에 착수한 클레임은 거부할 수 없습니다. 결제 취소를 마치거나, 사람이 판단할 일이면 보류로 남겨주세요.';
  }
  if (value.includes('claim_refund_account_missing')) {
    return '등록된 환불계좌가 없습니다. 무통장 주문은 결제한 분이 주문 상세에서 환불계좌를 등록한 뒤 다시 진행해주세요. 선물 주문은 선물 요청 화면에서 등록합니다.';
  }
  if (value.includes('claim_not_decidable')) return '지금 단계에서는 처리할 수 없습니다. 최신 상태를 확인해주세요.';
  if (value.includes('claim_not_collectable')) return '수거 단계가 아닙니다. 최신 상태를 확인해주세요.';
  if (value.includes('claim_not_refundable')) return '환불을 접수할 수 있는 단계가 아닙니다.';
  if (value.includes('claim_not_reshippable')) return '입고 확인이 끝난 교환만 재출고할 수 있습니다.';
  if (value.includes('goods_group_retry')) return '상품 전환이나 재고 처리가 진행 중입니다. 최신 상태를 확인한 뒤 다시 시도해주세요.';
  if (value.includes('physical_generation_already_restored')) return '이 회수 상품의 재고는 이미 복원됐습니다. 처리 이력을 확인해주세요.';
  if (value.includes('reshipment_variant_unavailable')) return '선택한 재출고 상품을 사용할 수 없습니다. 최신 목록에서 같은 상품의 옵션이나 같은 그룹의 상품을 선택해주세요.';
  if (value.includes('invalid reshipment items')) return '재출고할 주문 품목과 상품을 확인해주세요.';
  if (value.includes('reshipment_conflict')) return '이미 다른 운송장이나 상품으로 재출고한 교환입니다. 처리 이력을 확인해주세요.';
  if (value.includes('insufficient_or_overflowing_stock') || value.includes('stock_aggregate_overflow')) return '재고 수량을 적용할 수 없습니다. 최신 재고와 회수 수량을 확인해주세요.';
  if (value.includes('stock_out_of_range')) return '재출고할 옵션 재고가 부족합니다. 최신 옵션 수량을 확인해주세요.';
  if (value.includes('invalid rejection reason')) return '거부 사유는 앞뒤 공백 없이 10자 이상 200자 이하로 입력해주세요.';
  if (value.includes('invalid hold reason')) return '보류 사유는 앞뒤 공백 없이 10자 이상 200자 이하로 입력해주세요.';
  if (value.includes('claim_not_held')) return '보류 상태가 아닙니다.';
  if (value.includes('claim_not_found')) return '클레임을 찾을 수 없습니다.';
  if (value.includes('claim_operational_fee_conflict')) return '다른 운영자가 금액을 변경했습니다. 최신 클레임을 다시 열어주세요.';
  if (value.includes('invalid_claim_operational_fee')) return '운영 확인액·비용 유형·메모·근거를 확인해주세요.';
  if (value.includes('unknown shipping carrier')) return '등록되지 않은 택배사입니다.';
  return fallback;
}

async function requireStaffAction(): Promise<
  { error?: AdminClaimActionState; userId?: string; canManagePayments?: boolean }
> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) {
    redirect(`/login?next=${encodeURIComponent('/admin/sales/claims/cancels')}`);
  }
  if (!auth.isStaff || !hasAdminCapability(auth, 'sales.manage')) return { error: { error: '관리자 권한이 필요합니다.' } };
  return { userId: auth.user.id, canManagePayments: canAccessAdminScreen(auth, null, { capability: 'sales.manage', adminOnly: true }) };
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

/*
 * 재시도 안내는 그 상황에서 실제로 그려지는 버튼만 가리킨다.
 * - 결제 행이 있는 토스 결제: 승인이 환불 원장을 열어 요청 상세에 [환불 완료 확정]이
 *   그려진다.
 * - 결제 행이 없는 주문(결제창만 열렸거나 결제 결과 미확정): 환불 원장이 없어
 *   [환불 완료 확정]이 그려지지 않는다(ClaimActionPanel refundLedgerMissing). 만료
 *   sweep도 처리중 요청을 건너뛰므로 주문 통합검색 주문 패널의 재확인 버튼만 이 건을
 *   닫는다 — 이름은 요청 단계에 따라 다르다(ADMIN_CANCELLATION_RECHECK_LABELS).
 */
const { processing: RECHECK_PROCESSING, needsReview: RECHECK_NEEDS_REVIEW } = ADMIN_CANCELLATION_RECHECK_LABELS;
const ORDER_PANEL_RECHECK = `주문 통합검색에서 이 주문을 열어 [${RECHECK_NEEDS_REVIEW}](처리중이면 [${RECHECK_PROCESSING}])`;

/**
 * 승인으로 processing이 된 취소 클레임의 결제사 취소를 바로 실행한다.
 *
 * 주문 콘솔의 청약철회 승인(approveAdminOrderCancellationAction)과 같은 동작이다.
 * Korpay는 취소 API가 없어 이메일 접수 → 수동 확인 seam이 정상 경로이고, 무통장은
 * 계좌 송금 절차를 따르므로 여기서 돌리지 않는다(돌리면 곧바로 needs_review가 돼
 * 접수 양식·계좌 송금 접수를 막는다).
 */
async function issueApprovedClaimCancellation(
  claimId: string,
  actorId: string,
): Promise<AdminClaimActionState> {
  let provider: string | null = null;
  try {
    const detail = await loadAdminClaimDetail(claimId);
    provider = detail?.payment?.provider ?? null;
  } catch {
    return { error: `취소를 승인했지만 결제 정보를 다시 읽지 못했습니다. 주문과 재고는 그대로 유지됩니다. 새로고침한 뒤 요청 상세의 [환불 완료 확정]으로 결제 취소를 진행해주세요. 그 버튼이 없으면 ${ORDER_PANEL_RECHECK}으로 진행합니다.` };
  }
  if (provider === 'korpay') {
    return { message: '취소를 승인했습니다. Korpay 결제는 결제사 취소 접수 양식으로 접수한 뒤 환불 완료를 확정해주세요.' };
  }
  if (provider === 'bank_transfer') {
    return { message: '취소를 승인했습니다. 무통장 입금 결제는 결제사 취소가 없어 환불계좌 송금 절차로 진행합니다.' };
  }

  let result: Awaited<ReturnType<typeof reconcileOrderCancellation>>;
  try {
    result = await reconcileOrderCancellation({ requestId: claimId, actorId });
  } catch {
    result = { ok: false, code: 'local_finalize_failed' };
  }
  const hasPayment = provider !== null;
  if (!result.ok) {
    return {
      error: hasPayment
        ? `취소는 승인했지만 결제 취소를 확정하지 못했습니다(${result.code}). 주문과 재고는 그대로 유지됩니다. 정합화 오류를 확인한 뒤 [환불 완료 확정]으로 다시 시도해주세요.`
        : `취소는 승인했지만 주문 취소를 확정하지 못했습니다(${result.code}). 주문과 재고는 그대로 유지됩니다. 결제 내역이 없는 주문이라 [환불 완료 확정]은 보이지 않습니다. 원인을 확인한 뒤 ${ORDER_PANEL_RECHECK}으로 다시 시도해주세요.`,
    };
  }
  if (result.status === 'in_progress') {
    return {
      message: hasPayment
        ? `취소를 승인했습니다. ${IN_PROGRESS} 잠시 뒤 [환불 완료 확정]으로 다시 확인해주세요.`
        : `취소를 승인했습니다. ${IN_PROGRESS} 결제 결과가 정해지기 전이라 환불 원장이 없어 [환불 완료 확정]은 보이지 않습니다. 잠시 뒤 주문 통합검색에서 이 주문을 열어 [${RECHECK_PROCESSING}]으로 다시 확인해주세요. Korpay 결제창 주문은 그 자리의 Korpay 버튼으로 처리합니다.`,
    };
  }
  return {
    message: provider === 'toss'
      ? '취소를 승인하고 토스 전액 취소까지 확인했습니다. 주문 취소·재고 복원·카드팩 회수와 환불 원장 기록이 함께 끝났습니다.'
      : '취소를 승인하고 주문 취소를 마쳤습니다. 결제 전 주문이라 결제사 취소는 없었습니다.',
  };
}

/**
 * 결정 한 건의 단건 경로. 상세 패널과 목록 일괄 처리가 같은 함수를 지난다(R8 · D8).
 *
 * 승인 결과 단계는 폼이 아니라 DB가 돌려준 값으로 읽는다. 취소는 회수할 물건이 없어
 * 곧장 processing이 되고, 그 순간 결제사 취소를 발행한다.
 */
async function decideOneOrderClaim(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actorId: string,
  input: { claimId: string; decision: string; note: string | null },
): Promise<{ decided: boolean; state: AdminClaimActionState }> {
  const { data, error } = await supabase.rpc('admin_decide_order_claim', {
    p_claim_id: input.claimId,
    p_decision: input.decision,
    p_note: input.note,
  });
  if (error) return { decided: false, state: { error: rpcErrorMessage(error.message, DECIDE_FAILED) } };
  if (input.decision === 'approve' && data === 'processing') {
    return { decided: true, state: await issueApprovedClaimCancellation(input.claimId, actorId) };
  }
  return { decided: true, state: { message: DECISION_MESSAGES[input.decision] ?? '클레임을 처리했습니다.' } };
}

export async function decideOrderClaimAction(
  _state: AdminClaimActionState,
  formData: FormData,
): Promise<AdminClaimActionState> {
  const access = await requireStaffAction();
  if (access.error || !access.userId) return access.error ?? { error: DECIDE_FAILED };

  const normalized = normalizeAdminClaimDecisionForm(formData);
  if (!normalized.ok) return { error: normalized.error };
  if (normalized.value.decision === 'hold' || normalized.value.decision === 'resume') {
    return { error: '보류·해제 화면을 다시 열어 최신 요청의 유형과 상태를 확인해주세요.' };
  }

  const supabase = await createClient();
  const { decided, state } = await decideOneOrderClaim(supabase, access.userId, normalized.value);
  if (decided) revalidateClaimSurfaces(normalized.value.claimId, readClaimType(formData));
  return state;
}

interface BulkClaimRow {
  id: string;
  reference: number | string | null;
}

/**
 * 목록 일괄 처리(R8 · D8) — 승인·거부(공통 사유)·검토중.
 *
 * 새 배열 RPC 없이 건마다 단건 경로(decideOneOrderClaim)를 그대로 탄다. 토스 취소 API는
 * 결제 단건이라 앞 건의 결제사 취소가 끝난 뒤에 다음 건을 시작하고(전체 직렬), 시간은 액션
 * 진입부터 잰다. 경과가 예산을 넘었거나 다음 건의 최악 시간(취소 승인 = 결제사 왕복 셋)이 목록
 * maxDuration 안에 끝나지 않으면 남은 건은 시작하지 않고 '미처리'로 돌려준다.
 *
 * 요청번호는 처음에 한 번 읽고, 유형은 건을 시작하기 직전에 다시 읽는다 — 그 사이 다른
 * 운영자가 반품↔교환을 전환한 요청을 이 목록의 결정으로 처리하지 않는다.
 */
export async function bulkDecideOrderClaimsAction(
  _state: AdminClaimBulkState,
  formData: FormData,
): Promise<AdminClaimBulkState> {
  const startedAt = Date.now();
  const access = await requireStaffAction();
  if (access.error || !access.userId) return { error: access.error?.error ?? DECIDE_FAILED };
  const actorId = access.userId;

  const claimType = readClaimType(formData);
  if (!claimType) return { error: '목록을 새로고침한 뒤 다시 실행해주세요.' };

  const normalized = normalizeAdminClaimBulkForm(formData);
  if (!normalized.ok) return { error: normalized.error };
  const { claimIds, decision, note } = normalized.value;

  const supabase = await createClient();
  const { data: rows, error: readError } = await supabase
    .from('order_cancellation_requests')
    .select('id,reference')
    .in('id', claimIds);
  if (readError || !Array.isArray(rows)) {
    return { error: '선택한 요청을 읽지 못했습니다. 새로고침한 뒤 다시 실행해주세요.' };
  }
  const claims = new Map((rows as BulkClaimRow[]).map((row) => [String(row.id).toLowerCase(), row]));
  const referenceOf = (id: string) => {
    const reference = Number(claims.get(id)?.reference);
    return Number.isSafeInteger(reference) && reference > 0 ? orderClaimReferenceLabel(reference) : null;
  };

  /* 취소 승인만 결정 직후 결제사 취소(사전 조회·취소·사후 조회)까지 간다. */
  const reserveMs = claimType === 'cancel' && decision === 'approve'
    ? ADMIN_CLAIM_BULK_PROVIDER_ITEM_RESERVE_MS
    : ADMIN_CLAIM_BULK_DB_ITEM_RESERVE_MS;

  const outcomes = await runAdminClaimBulkSequentially(claimIds, async (claimId) => {
    if (!claims.has(claimId)) return { ok: false, message: '클레임을 찾을 수 없습니다.' };
    const { data: latest, error: latestError } = await supabase
      .from('order_cancellation_requests')
      .select('claim_type')
      .eq('id', claimId)
      .maybeSingle<{ claim_type: string }>();
    if (latestError) return { ok: false, message: '요청을 다시 읽지 못했습니다. 최신 상태를 확인해주세요.' };
    if (!latest) return { ok: false, message: '클레임을 찾을 수 없습니다.' };
    if (latest.claim_type !== claimType) {
      return { ok: false, message: `${ORDER_CLAIM_TYPE_LABELS[claimType]} 요청이 아닙니다. 해당 목록에서 처리해주세요.` };
    }
    const { decided, state } = await decideOneOrderClaim(supabase, actorId, { claimId, decision, note });
    if (decided) revalidateClaimSurfaces(claimId, claimType);
    return state.error
      ? { ok: false, message: state.error }
      : { ok: true, message: state.message ?? DECISION_MESSAGES[decision] ?? '클레임을 처리했습니다.' };
  }, { startedAt, reserveMs, clock: () => Date.now() });

  return {
    summary: adminClaimBulkSummary(outcomes.map((outcome) => outcome.outcome)),
    results: outcomes.map(({ item, outcome, message }) => ({
      claimId: item,
      reference: referenceOf(item),
      outcome,
      message,
    })),
  };
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
      ? adminGoodsCopy('반송 굿즈 입고를 확인했습니다. 실제 반환받은 날을 기준으로 환급 기한을 확인해주세요.')
      : '수거중으로 표시했습니다.',
  };
}

export async function recordOrderClaimOriginCollectionAction(
  previous: AdminClaimActionState,
  formData: FormData,
): Promise<AdminClaimActionState> {
  const fail = (error: string) => withPreservedFormValues({ error }, previous, formData);
  const access = await requireStaffAction();
  if (access.error) return fail(access.error.error ?? COLLECTION_FAILED);
  const normalized = normalizeAdminClaimOriginCollectionForm(formData);
  if (!normalized.ok) return fail(normalized.error);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_record_order_claim_origin_collection', {
    p_claim_id: normalized.value.claimId,
    p_shipment_id: normalized.value.shipmentId,
    p_evidence: normalized.value.evidence,
  });
  if (error) return fail(rpcErrorMessage(error.message, COLLECTION_FAILED));
  if (data !== 'collecting' && data !== 'collected') return fail(COLLECTION_FAILED);
  revalidateClaimSurfaces(normalized.value.claimId, readClaimType(formData));
  return { message: data === 'collected'
    ? '모든 출고지의 회수를 확인했습니다. 다음 처리 단계와 환급 기한을 확인해주세요.'
    : '이 출고지의 회수를 확인했습니다. 남은 출고지를 확인해주세요.' };
}

export async function recordOrderClaimOperationalFeeAction(
  previous: AdminClaimActionState,
  formData: FormData,
): Promise<AdminClaimActionState> {
  const fail = (error: string) => withPreservedFormValues({ error }, previous, formData);
  try {
  const access = await requireStaffAction();
  if (access.error) return fail(access.error.error ?? OPERATIONAL_FEE_FAILED);
  const normalized = normalizeAdminClaimOperationalFeeForm(formData);
  if (!normalized.ok) return fail(normalized.error);
  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_record_order_claim_operational_fee', {
    p_claim_id: normalized.value.claimId,
    p_fee_kind: normalized.value.feeKind,
    p_amount: normalized.value.amount,
    p_note: normalized.value.note,
    p_evidence: normalized.value.evidence,
    p_expected_updated_at: normalized.value.expectedUpdatedAt,
  });
  if (error) return fail(rpcErrorMessage(error.message, OPERATIONAL_FEE_FAILED));
  revalidateClaimSurfaces(normalized.value.claimId, readClaimType(formData));
  return { message: normalized.value.amount === null ? '운영 확인액 기록을 해제했습니다.' : '운영 확인액을 기록했습니다.' };
  } catch (error) {
    unstable_rethrow(error);
    return fail(OPERATIONAL_FEE_FAILED);
  }
}

export async function recordOrderClaimReshipmentDeliveryAction(
  previous: AdminClaimActionState,
  formData: FormData,
): Promise<AdminClaimActionState> {
  const failureMessage = '교환품 배송완료를 기록하지 못했습니다. 최신 상태를 확인해주세요.';
  const fail = (error: string) => withPreservedFormValues({ error }, previous, formData);
  const access = await requireStaffAction();
  if (access.error) return fail(access.error.error ?? failureMessage);
  const normalized = normalizeAdminClaimEvidenceForm(formData);
  if (!normalized.ok) return fail(normalized.error);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_record_order_claim_reshipment_delivery', {
    p_claim_id: normalized.value.claimId, p_evidence: normalized.value.evidence,
  });
  if (error) return fail(rpcErrorMessage(error.message, failureMessage));
  if (data !== 'delivered') return fail(failureMessage);
  revalidateClaimSurfaces(normalized.value.claimId, 'exchange');
  return { message: '교환품의 실제 배송완료를 확인했습니다. 이후 신청은 기존 신청 기한과 조건을 따릅니다.' };
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
  input: { claimId: string; orderId: string; actorId: string; canManagePayments: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc('admin_goods_manual_recovery_attempts', {
    p_order_ids: [input.orderId],
  });

  const attempts = (!error && Array.isArray(data) ? data : []) as ManualRecoveryAttemptRow[];
  const attempt = attempts.find((row) => (
    row.request_id === input.claimId && row.manual_recovery_available
  ));

  if (attempt) {
    /* 현재 결제 관리 권한과 원장 확인을 요구한다. 미전환 환경의 admin 전용 제한도 유지한다. */
    if (!input.canManagePayments) {
      return {
        ok: false,
        error: '코페이 결제 취소 확인 권한이 없습니다. 대표 또는 계정 주매니저에게 요청해주세요. 권한 전환 전에는 기존 관리자에게 요청해주세요.',
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
    if (!result.ok) return { ok: false, error: finalizeFailed(result.code) };
    if (result.status === 'in_progress') return { ok: false, error: IN_PROGRESS };
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

  /* 환불 수단은 폼이 아니라 결제에서 정한다(2026-10-12 점검 REF-8·REF-3).
   *
   * 토스 결제는 '환불 완료 확정'이 토스 전액 취소를 발행한다. 폼에서 계좌 송금을
   * 고르면 취소는 이미 나간 뒤에 원장 기록만 실패하고, 그걸 보고 계좌로 또 보내면
   * 이중 환불이 된다. 그래서 결제와 이미 기록된 수단에서 파생한 값과 폼 값이 다르면
   * 결제사 호출 전에 거절한다. 단계·결제도 폼이 아니라 DB에서 읽는다. */
  let current: Awaited<ReturnType<typeof loadAdminClaimDetail>>;
  try {
    current = await loadAdminClaimDetail(normalized.value.claimId);
  } catch {
    return { error: REFUND_FAILED };
  }
  if (!current) return { error: '클레임을 찾을 수 없습니다.' };

  const derivedMethod: OrderClaimRefundMethod | null = current.refund?.method
    ?? orderClaimRefundMethodForProvider(current.payment?.provider ?? null);
  if (derivedMethod && derivedMethod !== normalized.value.method) {
    return { error: REFUND_METHOD_MISMATCH };
  }
  const tossPayment = current.payment?.provider === 'toss';

  if (normalized.value.stage === 'completed') {
    const orderId = String(formData.get('orderId') ?? '');
    if (!orderId || orderId.toLowerCase() !== current.claim.orderId.toLowerCase()) {
      return { error: REFUND_FAILED };
    }

    /* 이미 종결된 클레임에는 정합화를 다시 걸지 않는다.
     *
     * admin_begin_order_cancellation_reconcile은 completed 요청을
     * cancellation_request_not_reconcilable로 거절한다. 그래서 레거시 경로로
     * 완료된 건(재고 복원·카드팩 회수는 이미 끝났고 refunds.completed_at만 비어
     * 있는 상태)에 이 액션을 걸면 원장 기록에 닿기도 전에 항상 실패했다. 단계는
     * 폼이 아니라 DB에서 읽는다 — 클라이언트가 보낸 값으로 정합화를 건너뛸지
     * 정하면 그 자체가 게이트 우회가 된다. */
    // Derive this gate from the durable payment, never from the submitted method.
    // Bank refunds need cancellation evidence, an awaiting-transfer phase and a
    // separate immutable transfer receipt; the card orchestrator cannot do it.
    if (current.payment?.provider === 'bank_transfer') {
      return { error: '무통장 환불 처리에서 취소 확정과 실제 송금 완료 증빙을 각각 기록해주세요.' };
    }

    if (current.claim.stage !== 'completed') {
      finalizationRan = true;
      const finalized = await finalizeClaimPayment(supabase, {
        claimId: normalized.value.claimId,
        orderId: current.claim.orderId,
        actorId: access.userId,
        canManagePayments: access.canManagePayments === true,
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
    const reason = rpcErrorMessage(error.message, REFUND_FAILED);
    /* 결제사 취소와 주문 정합화가 이미 끝난 뒤의 원장 기록 실패를 "환불 실패"로
       보이면 운영자가 같은 돈을 다른 수단으로 다시 돌려준다. 끝난 일을 먼저 말한다. */
    return {
      error: finalizationRan
        ? `${tossPayment ? '토스 전액 취소와 ' : ''}주문 취소·재고 복원·카드팩 회수는 이미 완료됐습니다. 환불 원장 기록만 실패했습니다 — 다시 환불하지 마세요. ${reason}`
        : reason,
    };
  }

  revalidateClaimSurfaces(normalized.value.claimId, readClaimType(formData));
  if (normalized.value.stage === 'filed') {
    return {
      message: tossPayment
        ? '환불 접수를 기록했습니다. 토스 전액 취소는 [환불 완료 확정]을 누를 때 발행됩니다.'
        : '환불 접수를 기록했습니다.',
    };
  }
  /* 이미 종결된 클레임에는 재고 복원·카드팩 회수가 방금 일어나지 않았다. 문구가
     일어나지 않은 일을 보고하면 운영자가 그 주문을 다시 확인할 근거를 잃는다. */
  if (!finalizationRan) {
    return { message: '환불 완료를 원장에 기록했습니다. 주문 취소와 재고 복원은 이미 확정된 상태였습니다.' };
  }
  return {
    message: tossPayment
      ? '토스 전액 취소를 확인하고 환불 완료를 기록했습니다. 재고 복원과 카드팩 회수가 함께 확정됐습니다.'
      : '환불 완료를 기록했습니다. 재고 복원과 카드팩 회수가 함께 확정됐습니다.',
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
    p_items: normalized.value.items,
  });
  if (error) return { error: rpcErrorMessage(error.message, RESHIP_FAILED) };

  revalidateClaimSurfaces(normalized.value.claimId, 'exchange');
  revalidatePath('/shop', 'layout');
  revalidatePath('/ip', 'layout');
  revalidatePath('/cart');
  revalidatePath('/checkout');
  revalidatePath('/admin/catalog/goods', 'layout');
  return { message: '교환 재출고 운송장을 등록하고 클레임을 종결했습니다.' };
}
