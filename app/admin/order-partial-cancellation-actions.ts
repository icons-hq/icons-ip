'use server';

import { revalidatePath } from 'next/cache';
import { hasAdminCapability } from '@/lib/admin/access';
import {
  orderPartialCancellationErrorMessage,
  orderPartialCancellationReconcileMessage,
  orderPartialCancellationResolutionMessage,
} from '@/lib/admin/order-partial-cancellation';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import {
  normalizeOrderPartialCancellationSelection,
  parseOrderPartialCancellationContext,
  parseOrderPartialCancellationPlan,
  type OrderPartialCancellationContext,
  type OrderPartialCancellationPlan,
  type OrderPartialCancellationState,
} from '@/lib/orders/partial-cancellation';
import {
  inspectOrderPartialCancellationResolution,
  reconcileOrderPartialCancellation,
} from '@/lib/orders/partial-cancellation-orchestrator.server';
import { createClient } from '@/lib/supabase/server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type PartialCancellationActionResult<T> = { ok: true; value: T } | { ok: false; error: string };

async function staff(capability: 'sales.manage' | 'sales.read' = 'sales.manage') {
  const auth = await getCurrentAdminAuthState();
  return auth.isConfigured && auth.user && auth.isStaff && hasAdminCapability(auth, capability) ? auth : null;
}

function uuid(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null;
}

function refresh(orderId: string) {
  revalidatePath('/admin/sales/orders');
  revalidatePath(`/admin/sales/orders/${orderId}`);
  revalidatePath('/admin/sales/dispatch');
  revalidatePath('/admin/sales/shipping');
  revalidatePath(`/orders/${orderId}`);
  revalidatePath('/orders');
}

/**
 * 주문 상세 패널의 문맥. 스위치가 꺼져 있고 기록이 없으면 enabled false · 빈 기록이다(화면은 아무것도 그리지 않는다).
 * 주문 조회 권한(sales.read)이면 기록을 읽는다 — 처리 권한(sales.manage)은 DB가 canManage로 알려준다.
 */
export async function loadOrderPartialCancellationAction(orderId: unknown): Promise<PartialCancellationActionResult<OrderPartialCancellationContext>> {
  if (!await staff('sales.read')) return { ok: false, error: '관리자 권한이 필요합니다.' };
  const id = uuid(orderId);
  if (!id) return { ok: false, error: '주문을 확인해주세요.' };
  const { data, error } = await (await createClient()).rpc('admin_order_partial_cancellation_context', { p_order_id: id });
  if (error) return { ok: false, error: orderPartialCancellationErrorMessage(error.message) };
  try {
    return { ok: true, value: parseOrderPartialCancellationContext(data) };
  } catch {
    return { ok: false, error: '부분 취소 정보를 읽지 못했습니다. 새로고침해주세요.' };
  }
}

/** 확인창 미리보기 — DB가 시작과 같은 계산으로 환불액·닫히는 배송 건·창고 확인 필요 여부를 돌려준다. */
export async function previewOrderPartialCancellationAction(input: { orderId: unknown; items: unknown }): Promise<PartialCancellationActionResult<OrderPartialCancellationPlan>> {
  if (!await staff()) return { ok: false, error: '관리자 권한이 필요합니다.' };
  const id = uuid(input.orderId);
  const items = normalizeOrderPartialCancellationSelection(input.items);
  if (!id || !items) return { ok: false, error: '취소할 상품과 수량을 확인해주세요.' };
  const { data, error } = await (await createClient()).rpc('admin_preview_order_partial_cancellation', { p_order_id: id, p_items: items });
  if (error) return { ok: false, error: orderPartialCancellationErrorMessage(error.message) };
  try {
    return { ok: true, value: parseOrderPartialCancellationPlan(data) };
  } catch {
    return { ok: false, error: '부분 취소 금액을 읽지 못했습니다. 새로고침해주세요.' };
  }
}

export interface StartOrderPartialCancellationInput {
  orderId: unknown;
  items: unknown;
  customerDecision: unknown;
  note: unknown;
  warehouseStopConfirmed: unknown;
  expectedRefundAmount: unknown;
  operationId: unknown;
  refundAccount?: unknown;
}

export interface StartOrderPartialCancellationResult {
  state: OrderPartialCancellationState | 'unknown';
  message: string;
}

function refundAccount(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { bankName, accountNumber, accountHolder } = value as Record<string, unknown>;
  if (typeof bankName !== 'string' || typeof accountNumber !== 'string' || typeof accountHolder !== 'string') return undefined;
  return { bankName: bankName.trim(), accountNumber: accountNumber.replace(/\s+/g, ''), accountHolder: accountHolder.trim() };
}

/**
 * 부분 취소 시작. 토스는 DB가 연 요청을 바로 결제사 부분 취소 → 조회 검증 → 적용까지 실행하고, 무통장은 DB가 바로 적용해
 * 송금 대기로 둔다. 같은 operationId 재전송은 같은 결과다(이미 끝났으면 결제사를 다시 부르지 않는다).
 */
export async function startOrderPartialCancellationAction(input: StartOrderPartialCancellationInput): Promise<PartialCancellationActionResult<StartOrderPartialCancellationResult>> {
  const auth = await staff();
  if (!auth?.user) return { ok: false, error: '관리자 권한이 필요합니다.' };
  const orderId = uuid(input.orderId);
  const operationId = uuid(input.operationId);
  const items = normalizeOrderPartialCancellationSelection(input.items);
  const account = refundAccount(input.refundAccount);
  if (!orderId || !operationId || !items || account === undefined
    || typeof input.customerDecision !== 'string' || (input.note !== null && input.note !== undefined && typeof input.note !== 'string')
    || typeof input.expectedRefundAmount !== 'number' || !Number.isSafeInteger(input.expectedRefundAmount) || input.expectedRefundAmount < 0) {
    return { ok: false, error: '부분 취소 입력을 확인해주세요.' };
  }
  const { data, error } = await (await createClient()).rpc('admin_start_order_partial_cancellation', {
    p_order_id: orderId,
    p_items: items,
    p_customer_decision: input.customerDecision,
    p_note: typeof input.note === 'string' ? input.note : null,
    p_warehouse_stop_confirmed: input.warehouseStopConfirmed === true,
    p_expected_refund_amount: input.expectedRefundAmount,
    p_operation_id: operationId,
    p_refund_account: account,
  });
  if (error) {
    refresh(orderId);
    return { ok: false, error: orderPartialCancellationErrorMessage(error.message) };
  }
  const started = data as { id?: unknown; state?: unknown; provider?: unknown } | null;
  const partialCancellationId = uuid(started?.id);
  if (!partialCancellationId) {
    refresh(orderId);
    return { ok: false, error: '부분 취소 요청을 확인하지 못했습니다. 새로고침해 기록을 확인해주세요.' };
  }
  if (started?.state === 'completed') {
    // 환불 0원(전액 할인 상품만 고름) — 결제사·송금 없이 DB가 바로 적용했다.
    refresh(orderId);
    return { ok: true, value: { state: 'completed', message: '부분 취소를 적용했습니다. 환불할 금액이 0원이라 결제사를 부르지 않았습니다. 재고를 되돌리고 배송 건에서 그 상품을 뺐으며 구매자에게 알렸습니다.' } };
  }
  if (started?.provider === 'bank_transfer') {
    refresh(orderId);
    return { ok: true, value: { state: 'awaiting_transfer', message: '부분 취소를 적용했습니다. 재고를 되돌리고 배송 건에서 그 상품을 뺐습니다. 환불은 송금 대기로 남았으니 계좌로 송금한 뒤 송금 완료를 기록해주세요.' } };
  }
  return reconcile(orderId, partialCancellationId, auth.user.id);
}

async function reconcile(orderId: string, partialCancellationId: string, actorId: string): Promise<PartialCancellationActionResult<StartOrderPartialCancellationResult>> {
  let result: Awaited<ReturnType<typeof reconcileOrderPartialCancellation>>;
  try {
    result = await reconcileOrderPartialCancellation({ partialCancellationId, actorId });
  } catch {
    result = { ok: false, code: 'local_finalize_failed' };
  }
  refresh(orderId);
  if (result.ok) {
    return { ok: true, value: { state: 'completed', message: '토스 부분 취소를 확인하고 적용했습니다. 재고를 되돌리고 배송 건에서 그 상품을 뺐으며 구매자에게 알렸습니다.' } };
  }
  if (result.code === 'partial_cancel_rejected') {
    return { ok: true, value: { state: 'rejected', message: orderPartialCancellationReconcileMessage(result.code) } };
  }
  return { ok: true, value: { state: 'needs_review', message: orderPartialCancellationReconcileMessage(result.code) } };
}

/** 결제확인필요·처리 중인 부분 취소를 같은 경로로 다시 확인한다(이미 반영된 결제사 취소는 다시 취소하지 않는다). */
export async function retryOrderPartialCancellationAction(input: { orderId: unknown; partialCancellationId: unknown }): Promise<PartialCancellationActionResult<StartOrderPartialCancellationResult>> {
  const auth = await staff();
  if (!auth?.user) return { ok: false, error: '관리자 권한이 필요합니다.' };
  const orderId = uuid(input.orderId);
  const id = uuid(input.partialCancellationId);
  if (!orderId || !id) return { ok: false, error: '부분 취소 기록을 확인해주세요.' };
  return reconcile(orderId, id, auth.user.id);
}

/**
 * 결제확인필요 해소(결제 담당 = sales.manage + 레거시 관리자, 로그인 세션 — DB가 다시 판정한다). 서버가 결제사 잔액을 조회만 해
 * 돈이 움직이지 않았으면 진행하지 않음으로, 이미 취소됐으면 그 거래 키로 적용한다. 운영자는 해소 방법을 고르지 않는다(사유만 적는다).
 */
export async function resolveOrderPartialCancellationAction(input: { orderId: unknown; partialCancellationId: unknown; reason: unknown }): Promise<PartialCancellationActionResult<string>> {
  if (!await staff()) return { ok: false, error: '관리자 권한이 필요합니다.' };
  const orderId = uuid(input.orderId);
  const id = uuid(input.partialCancellationId);
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (!orderId || !id) return { ok: false, error: '부분 취소 기록을 확인해주세요.' };
  if (reason.length < 5 || reason.length > 500) return { ok: false, error: orderPartialCancellationErrorMessage('partial_cancel_resolution_reason_required') };
  let evidence: Awaited<ReturnType<typeof inspectOrderPartialCancellationResolution>>;
  try {
    evidence = await inspectOrderPartialCancellationResolution(id);
  } catch {
    evidence = { ok: false, code: 'local_state_unavailable' };
  }
  if (!evidence.ok) return { ok: false, error: orderPartialCancellationResolutionMessage(evidence.code) };
  const { error } = await (await createClient()).rpc('admin_resolve_order_partial_cancellation', {
    p_id: id,
    p_resolution: evidence.resolution,
    p_reason: reason,
    p_provider_transaction_key: evidence.resolution === 'already_canceled' ? evidence.transactionKey : null,
    p_observed_balance: evidence.observedBalance,
  });
  refresh(orderId);
  if (error) return { ok: false, error: orderPartialCancellationErrorMessage(error.message) };
  return { ok: true, value: evidence.resolution === 'not_moved'
    ? '결제사 잔액이 시작 때 그대로라 돈이 움직이지 않았습니다. 이 부분 취소를 진행하지 않음으로 닫았습니다. 주문·재고는 그대로입니다.'
    : '결제사에서 이미 취소된 것을 확인하고 그 거래로 부분 취소를 적용했습니다. 재고를 되돌리고 배송 건에서 그 상품을 뺐으며 구매자에게 알렸습니다.' };
}

/** 무통장 부분 취소의 송금 완료(불변 송금 증빙). */
export async function recordOrderPartialCancellationTransferAction(input: { orderId: unknown; partialCancellationId: unknown; evidence: unknown; note: unknown; operationId: unknown }): Promise<PartialCancellationActionResult<string>> {
  if (!await staff()) return { ok: false, error: '관리자 권한이 필요합니다.' };
  const orderId = uuid(input.orderId);
  const id = uuid(input.partialCancellationId);
  const operationId = uuid(input.operationId);
  if (!orderId || !id || !operationId || typeof input.evidence !== 'string' || typeof input.note !== 'string') {
    return { ok: false, error: '송금 근거와 확인 메모를 입력해주세요.' };
  }
  const { error } = await (await createClient()).rpc('admin_record_order_partial_cancellation_transfer', {
    p_id: id, p_evidence: input.evidence, p_note: input.note, p_operation_id: operationId,
  });
  refresh(orderId);
  if (error) return { ok: false, error: orderPartialCancellationErrorMessage(error.message) };
  return { ok: true, value: '송금 완료를 기록했습니다. 구매자에게 알렸고 계좌 원문은 30일 뒤 지웁니다.' };
}

/** 송금할 계좌 원문(감사 기록). */
export async function viewOrderPartialCancellationRefundAccountAction(partialCancellationId: unknown): Promise<PartialCancellationActionResult<{ bankName: string; accountNumber: string; accountHolder: string; amount: number }>> {
  if (!await staff()) return { ok: false, error: '관리자 권한이 필요합니다.' };
  const id = uuid(partialCancellationId);
  if (!id) return { ok: false, error: '부분 취소 기록을 확인해주세요.' };
  const { data, error } = await (await createClient()).rpc('admin_view_order_partial_cancellation_refund_account', { p_id: id });
  if (error) return { ok: false, error: orderPartialCancellationErrorMessage(error.message) };
  const row = data as Record<string, unknown> | null;
  if (!row || typeof row.bankName !== 'string' || typeof row.accountNumber !== 'string' || typeof row.accountHolder !== 'string'
    || typeof row.amount !== 'number') {
    return { ok: false, error: '계좌 원문을 읽지 못했습니다.' };
  }
  return { ok: true, value: { bankName: row.bankName, accountNumber: row.accountNumber, accountHolder: row.accountHolder, amount: row.amount } };
}
