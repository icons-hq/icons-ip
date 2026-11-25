import 'server-only';

import { PARTIAL_CANCEL_UNAVAILABLE_REASON, type PaymentAttempt, type PaymentBalanceInspection, type PaymentRefundReceiveAccount, type PaymentRefundRequest, type RefundOutcome } from '../payments/gateway';
import { getPaymentGateway } from '../payments/runtime-gateway';
import { isVirtualAccountRefundAccountReviewCode } from '../payments/virtual-account-refund-account';
import { loadVirtualAccountRefundAccount } from '../payments/virtual-account-refund-account.server';
import { createServiceClient } from '../supabase/service';
import { createRuntimeAttemptPaymentGateway } from '../subscriptions/payment-dispatch.server';
import { parseOrderPartialCancellationServiceRow, type OrderPartialCancellationServiceRow } from './partial-cancellation';

/** 토스 cancelReason(≤200자). */
export const ORDER_PARTIAL_CANCEL_REFUND_REASON = '엑스스퀘어 재고 부족 부분 취소';
/** 부분 반품(ADR-0047)의 토스 cancelReason. 같은 부분 환불 원장·같은 확인 경로를 쓰고 사유 문구만 다르다. */
export const ORDER_PARTIAL_RETURN_REFUND_REASON = '엑스스퀘어 부분 반품 환불';

/**
 * 결제사 취소 결과로 닫지 못한 사유. 게이트웨이 사유 코드(`provider_*`)는 그대로 남기고(운영자가 런북 조치를 고른다),
 * 그 밖은 아래 내부 코드다. 'partial_cancel_rejected'는 결제사가 이 결제의 부분 취소를 받지 않아 품목 부분 취소를 진행하지
 * 않은 결과(돈은 움직이지 않았다 — 전액 환불로 돌리지 않는다).
 */
export type OrderPartialCancellationCode =
  | 'not_found'
  | 'not_ready'
  | 'local_state_unavailable'
  | 'payment_evidence_invalid'
  | 'provider_unavailable'
  | 'provider_mismatch'
  | 'provider_cancel_failed'
  | 'local_finalize_failed'
  | 'partial_cancel_rejected'
  | `provider_${string}`;

export type OrderPartialCancellationResult =
  | { ok: true; status: 'completed' | 'already_completed' }
  | { ok: false; code: OrderPartialCancellationCode };

export interface OrderPartialCancellationDependencies {
  load(id: string): Promise<OrderPartialCancellationServiceRow | null>;
  /** 결제사 부분 취소(잔액 기대값 검증). 멱등키는 부분 취소마다 따로다. */
  refund(input: {
    partialCancellationId: string;
    paymentId: string;
    paymentAmount: number;
    paymentKey: string;
    refundAmount: number;
    expectedBalanceBefore: number;
    /** 부분 반품이면 'return'(결제사 취소 사유 문구만 다르다). */
    reasonCode?: 'out_of_stock' | 'return';
    /** 부분 반품의 반품 요청 id — 입금된 가상계좌 환불이 이 요청에서 구매자가 입력한 환급 계좌를 먼저 쓴다(재고 부족 부분 취소는 없음). */
    claimId?: string | null;
  }): Promise<RefundOutcome>;
  /**
   * 결제확인필요(needs_review) 원장을 다시 확인하기 전에 처리 중으로 옮긴다(2026-11-25 — 부분 반품 계좌 변경과 동시 재시도를 막는다).
   * 'processing'이면 결제사를 부른다. 그 밖은 지금 원장 상태다.
   */
  beginRetry(input: { id: string; actorId: string }): Promise<string>;
  complete(input: { id: string; actorId: string; refundedAmount: number; paymentKey: string; transactionKey: string }): Promise<void>;
  reject(input: { id: string; actorId: string }): Promise<void>;
  markNeedsReview(input: { id: string; actorId: string; code: OrderPartialCancellationCode }): Promise<void>;
  /**
   * 부분 반품 환불이 환급 계좌 때문에 결제확인필요로 멈춘 직후 구매자에게 계좌 입력 요청 메일을 보낸다(2026-11-25 — 앱 알림은 반품 요청의
   * 상태 동기화에서 DB가 남긴다). 보낼지는 DB가 다시 판정하고, 실패해도 결과는 바뀌지 않는다. 재고 부족 부분 취소는 구매자가 계좌를 넣을
   * 요청이 없어 보내지 않는다(운영자가 처리 — 결제확인필요 안내). 없으면(시험) 보내지 않는다.
   */
  notifyRefundAccountNeeded?: (claimId: string) => Promise<void>;
}

const PROVIDER_REVIEW_CODE = /^provider_[a-z0-9_]{1,55}$/;
const TRANSACTION_KEY = /^[\x21-\x7e]{1,64}$/;

function reviewCode(refund: RefundOutcome): OrderPartialCancellationCode {
  if (refund.outcome !== 'approved' && typeof refund.reasonCode === 'string' && PROVIDER_REVIEW_CODE.test(refund.reasonCode)) {
    return refund.reasonCode as `provider_${string}`;
  }
  return refund.outcome === 'unknown' ? 'provider_unavailable' : 'provider_cancel_failed';
}

/** 부분 취소 멱등키. 토스는 같은 키의 첫 응답을 15일간 재생하므로 전액 취소(`refund:{attemptId}`)·반품배송비 차감 키와 섞지 않는다. */
export function orderPartialCancellationIdempotencyKey(attemptId: string, partialCancellationId: string) {
  return `refund:${attemptId}:partial:${partialCancellationId}`;
}

/** 결제사 부분 취소 요청 조립(기본 의존성이 쓰는 순수 함수 — 시험이 같은 조립을 쓴다). */
export function orderPartialCancellationRefundRequest(attempt: PaymentAttempt, input: {
  partialCancellationId: string; paymentKey: string; refundAmount: number; expectedBalanceBefore: number; reasonCode?: 'out_of_stock' | 'return';
  /** 입금된 가상계좌(에스크로 아님) 결제의 환불 계좌(2026-11-25 보강). 어댑터가 부분 취소마다의 키에 계좌 접미를 붙인다. */
  refundReceiveAccount?: PaymentRefundReceiveAccount;
}): PaymentRefundRequest {
  return {
    attempt,
    idempotencyKey: orderPartialCancellationIdempotencyKey(attempt.id, input.partialCancellationId),
    amount: input.refundAmount,
    reason: input.reasonCode === 'return' ? ORDER_PARTIAL_RETURN_REFUND_REASON : ORDER_PARTIAL_CANCEL_REFUND_REASON,
    providerPaymentKey: input.paymentKey,
    partial: { expectedBalanceBefore: input.expectedBalanceBefore },
    ...(input.refundReceiveAccount ? { refundReceiveAccount: input.refundReceiveAccount } : {}),
  };
}

type ServiceClient = ReturnType<typeof createServiceClient>;

async function loadServiceRow(service: ServiceClient, id: string) {
  const { data, error } = await service.rpc('service_order_partial_cancellation', { p_id: id });
  if (error) throw new Error('partial cancellation lookup failed');
  return parseOrderPartialCancellationServiceRow(data);
}

/** 원장 결제의 토스 결제 시도(주문 결제 하나). 금액이 원장 결제와 다르면 쓰지 않는다. */
async function loadTossAttempt(service: ServiceClient, paymentId: string, paymentAmount: number): Promise<PaymentAttempt> {
  const { data, error } = await service
    .from('payment_attempts')
    .select('id,provider,purpose,ref_id,amount,currency,idempotency_key,provider_order_id,provider_product_code,expires_at')
    .eq('payment_id', paymentId)
    .maybeSingle();
  if (error) throw new Error('payment attempt lookup failed');
  if (!data) throw new Error('payment attempt missing');
  const row = data as Record<string, unknown>;
  if (
    row.provider !== 'toss'
    || row.purpose !== 'order'
    || typeof row.id !== 'string'
    || typeof row.ref_id !== 'string'
    || row.amount !== paymentAmount
    || typeof row.currency !== 'string'
    || typeof row.idempotency_key !== 'string'
    || typeof row.provider_order_id !== 'string'
    || typeof row.provider_product_code !== 'string'
    || typeof row.expires_at !== 'string'
  ) {
    throw new Error('invalid payment attempt state');
  }
  return {
    id: row.id,
    provider: 'toss',
    purpose: 'order',
    refId: row.ref_id,
    amount: row.amount as number,
    currency: row.currency,
    idempotencyKey: row.idempotency_key,
    providerOrderId: row.provider_order_id,
    providerProductCode: row.provider_product_code,
    expiresAt: row.expires_at,
  };
}

function createDefaultDependencies(): OrderPartialCancellationDependencies {
  const service = createServiceClient();
  return {
    load: (id) => loadServiceRow(service, id),
    async refund({ partialCancellationId, paymentId, paymentAmount, paymentKey, refundAmount, expectedBalanceBefore, reasonCode, claimId }) {
      const attempt = await loadTossAttempt(service, paymentId, paymentAmount);
      const gateway = createRuntimeAttemptPaymentGateway(service, 'toss', getPaymentGateway('toss'));
      // 입금된 가상계좌(에스크로 아님)는 부분 취소에도 환불 계좌가 필요하다 — 전액 환불과 같은 고르기(반품 요청 계좌 → 결제 UI 계좌).
      // 가상계좌가 아니면 RPC가 null이고 계좌 없이 지금처럼 취소한다. 조회가 실패하면 던져 결제사를 부르지 않는다(결제사 응답 없음).
      const refundReceiveAccount = await loadVirtualAccountRefundAccount(service, attempt.id, paymentKey, claimId);
      return gateway.refund(orderPartialCancellationRefundRequest(attempt, {
        partialCancellationId, paymentKey, refundAmount, expectedBalanceBefore, reasonCode, refundReceiveAccount,
      }));
    },
    async notifyRefundAccountNeeded(claimId) {
      const { sendVirtualAccountRefundAccountEmail } = await import('../email/transactional.server');
      await sendVirtualAccountRefundAccountEmail(claimId);
    },
    async beginRetry({ id, actorId }) {
      const { data, error } = await service.rpc('service_begin_order_partial_cancellation_retry', { p_id: id, p_actor_id: actorId });
      if (error || typeof data !== 'string') throw new Error('partial cancellation retry start failed');
      return data;
    },
    async complete({ id, actorId, refundedAmount, paymentKey, transactionKey }) {
      const { error } = await service.rpc('service_complete_order_partial_cancellation', {
        p_id: id,
        p_refunded_amount: refundedAmount,
        p_provider_payment_key: paymentKey,
        p_provider_transaction_key: transactionKey,
        p_actor_id: actorId,
      });
      if (error) throw new Error('partial cancellation completion failed');
    },
    async reject({ id, actorId }) {
      const { error } = await service.rpc('service_reject_order_partial_cancellation', {
        p_id: id,
        p_reason_code: PARTIAL_CANCEL_UNAVAILABLE_REASON,
        p_actor_id: actorId,
      });
      if (error) throw new Error('partial cancellation rejection failed');
    },
    async markNeedsReview({ id, actorId, code }) {
      const { error } = await service.rpc('service_mark_order_partial_cancellation_needs_review', {
        p_id: id,
        p_code: code,
        p_actor_id: actorId,
      });
      if (error) throw new Error('partial cancellation review transition failed');
    },
  };
}

async function needsReview(
  dependencies: OrderPartialCancellationDependencies,
  input: { id: string; actorId: string; claimId?: string | null },
  code: OrderPartialCancellationCode,
): Promise<OrderPartialCancellationResult> {
  try {
    await dependencies.markNeedsReview({ id: input.id, actorId: input.actorId, code });
  } catch {
    return { ok: false, code: 'local_finalize_failed' };
  }
  if (input.claimId && isVirtualAccountRefundAccountReviewCode(code) && dependencies.notifyRefundAccountNeeded) {
    try {
      await dependencies.notifyRefundAccountNeeded(input.claimId);
    } catch {
      console.error('[orders/partial-cancellation] refund account notice failed');
    }
  }
  return { ok: false, code };
}

/**
 * 토스 결제의 재고 부족 부분 취소를 결제사에서 확정하고 품목 취소를 적용한다(ADR-0032).
 *
 * DB가 시작 때 정한 금액·잔액 기대값만 쓴다(여기서 금액을 계산하지 않는다). 게이트웨이는 원장 결제 키로 조회해 잔액이
 * 기대값일 때만 cancelAmount로 취소하고, 취소 뒤 조회 잔액이 '기대값 − 환불액'일 때만 approved다. 확인한 결과를 DB에
 * 적으면 그 트랜잭션에서 재고 복원·배송 건 조정·카드팩 회수가 함께 일어난다. 결제사가 부분 취소를 받지 않는 결제면
 * 돈이 움직이지 않았으므로 품목 부분 취소를 진행하지 않고 닫는다(전액 환불로 돌리지 않는다). 모호·대조 실패는 확인 필요로
 * 남기고 같은 함수를 다시 부르면 이어서 수렴한다(이미 반영된 취소는 다시 취소하지 않는다).
 */
export async function reconcileOrderPartialCancellation(
  input: { partialCancellationId: string; actorId: string },
  provided?: OrderPartialCancellationDependencies,
): Promise<OrderPartialCancellationResult> {
  let dependencies: OrderPartialCancellationDependencies;
  try {
    dependencies = provided ?? createDefaultDependencies();
  } catch {
    return { ok: false, code: 'local_state_unavailable' };
  }
  let row: OrderPartialCancellationServiceRow | null;
  try {
    row = await dependencies.load(input.partialCancellationId);
  } catch {
    return { ok: false, code: 'local_state_unavailable' };
  }
  if (!row) return { ok: false, code: 'not_found' };
  if (row.state === 'completed') return { ok: true, status: 'already_completed' };
  if (row.state === 'rejected') return { ok: false, code: 'partial_cancel_rejected' };
  if (row.provider !== 'toss' || (row.state !== 'processing' && row.state !== 'needs_review')) return { ok: false, code: 'not_ready' };

  const target = { id: row.id, actorId: input.actorId, claimId: row.claimId };
  if (
    typeof row.paymentKey !== 'string'
    || !row.paymentKey
    || row.paymentStatus !== 'paid'
    || row.paymentLiveAmount !== row.paymentAmount
    || row.balanceBefore > row.paymentAmount
    || row.refundAmount <= 0
    || row.refundAmount > row.balanceBefore
  ) {
    return needsReview(dependencies, target, 'payment_evidence_invalid');
  }

  /*
   * 결제확인필요에서 다시 확인할 때는 결제사를 부르기 전에 원장을 처리 중으로 옮긴다(반품 요청도 처리 중이 된다). 그동안 구매자·운영자가
   * 환급 계좌를 바꾸지 못한다 — 가상계좌 부분 취소의 멱등키는 계좌마다 달라, 계좌가 바뀐 재시도는 결제사 멱등성으로 걸러지지 않는다.
   * 옮기지 못하면 결제사를 부르지 않는다.
   */
  if (row.state === 'needs_review') {
    let begun: string;
    try {
      begun = await dependencies.beginRetry({ id: target.id, actorId: target.actorId });
    } catch {
      return { ok: false, code: 'local_state_unavailable' };
    }
    if (begun === 'completed') return { ok: true, status: 'already_completed' };
    if (begun === 'rejected') return { ok: false, code: 'partial_cancel_rejected' };
    if (begun !== 'processing') return { ok: false, code: 'not_ready' };
  }

  let refund: RefundOutcome;
  try {
    refund = await dependencies.refund({
      partialCancellationId: row.id,
      paymentId: row.paymentId,
      paymentAmount: row.paymentAmount,
      paymentKey: row.paymentKey,
      refundAmount: row.refundAmount,
      expectedBalanceBefore: row.balanceBefore,
      reasonCode: row.reasonCode,
      claimId: row.claimId,
    });
  } catch {
    return needsReview(dependencies, target, 'provider_unavailable');
  }

  if (refund.outcome === 'approved' && refund.refundedAmount === row.refundAmount) {
    // 결제사가 취소했다고 말한 결제가 원장의 그 결제여야 하고, 정산 대사에 쓸 취소 거래 키가 있어야 한다.
    const transactionKey = refund.evidence?.providerTransactionId;
    if (refund.evidence?.providerPaymentKey !== row.paymentKey || typeof transactionKey !== 'string' || !TRANSACTION_KEY.test(transactionKey)) {
      return needsReview(dependencies, target, 'provider_mismatch');
    }
    try {
      await dependencies.complete({ id: row.id, actorId: input.actorId, refundedAmount: row.refundAmount, paymentKey: row.paymentKey, transactionKey });
    } catch {
      // 결제사 부분 취소는 됐고 적용만 실패했다. 다시 부르면 조회가 이미 반영된 취소로 수렴하고 적용을 다시 시도한다.
      return needsReview(dependencies, target, 'local_finalize_failed');
    }
    return { ok: true, status: 'completed' };
  }
  if (refund.outcome === 'declined' && refund.reasonCode === PARTIAL_CANCEL_UNAVAILABLE_REASON) {
    try {
      await dependencies.reject({ id: target.id, actorId: target.actorId });
    } catch {
      return needsReview(dependencies, target, 'local_finalize_failed');
    }
    return { ok: false, code: 'partial_cancel_rejected' };
  }
  return needsReview(dependencies, target, reviewCode(refund));
}

export type OrderPartialCancellationResolutionEvidence =
  | { ok: true; resolution: 'not_moved'; observedBalance: number }
  | { ok: true; resolution: 'already_canceled'; observedBalance: number; transactionKey: string }
  | { ok: false; code: 'not_found' | 'not_needs_review' | 'local_state_unavailable' | 'provider_unavailable' | 'provider_mismatch' | 'balance_unexplained' };

export interface OrderPartialCancellationResolutionDependencies {
  load(id: string): Promise<OrderPartialCancellationServiceRow | null>;
  inspect(input: { paymentId: string; paymentAmount: number; paymentKey: string }): Promise<PaymentBalanceInspection>;
}

function createDefaultResolutionDependencies(): OrderPartialCancellationResolutionDependencies {
  const service = createServiceClient();
  return {
    load: (id) => loadServiceRow(service, id),
    async inspect({ paymentId, paymentAmount, paymentKey }) {
      const attempt = await loadTossAttempt(service, paymentId, paymentAmount);
      const gateway = createRuntimeAttemptPaymentGateway(service, 'toss', getPaymentGateway('toss'));
      if (!gateway.inspectBalance) return { kind: 'not_supported' };
      return gateway.inspectBalance(attempt, paymentKey);
    },
  };
}

/**
 * 결제확인필요 해소의 증거(ADR-0032). 결제사를 조회만 한다(취소를 발행하지 않는다). 잔액이 시작 때 잔액 그대로면 돈이 움직이지
 * 않았고(→ 진행하지 않음), '시작 때 잔액 − 환불액'이고 마지막 취소가 그 금액이면 이미 취소됐다(→ 그 거래 키로 적용). 둘 다
 * 아니면(다른 취소가 끼었거나 결제사 화면과 대조가 필요한 상태) 해소하지 않는다. DB 해소 함수가 같은 값을 다시 대조한다.
 */
export async function inspectOrderPartialCancellationResolution(
  partialCancellationId: string,
  provided?: OrderPartialCancellationResolutionDependencies,
): Promise<OrderPartialCancellationResolutionEvidence> {
  let dependencies: OrderPartialCancellationResolutionDependencies;
  let row: OrderPartialCancellationServiceRow | null;
  try {
    dependencies = provided ?? createDefaultResolutionDependencies();
    row = await dependencies.load(partialCancellationId);
  } catch {
    return { ok: false, code: 'local_state_unavailable' };
  }
  if (!row) return { ok: false, code: 'not_found' };
  if (row.provider !== 'toss' || row.state !== 'needs_review') return { ok: false, code: 'not_needs_review' };
  if (typeof row.paymentKey !== 'string' || !row.paymentKey) return { ok: false, code: 'provider_mismatch' };
  let inspection: PaymentBalanceInspection;
  try {
    inspection = await dependencies.inspect({ paymentId: row.paymentId, paymentAmount: row.paymentAmount, paymentKey: row.paymentKey });
  } catch {
    return { ok: false, code: 'provider_unavailable' };
  }
  if (inspection.kind === 'unavailable') return { ok: false, code: 'provider_unavailable' };
  if (inspection.kind !== 'ok') return { ok: false, code: 'provider_mismatch' };
  if (inspection.balanceAmount === row.balanceBefore) {
    return { ok: true, resolution: 'not_moved', observedBalance: inspection.balanceAmount };
  }
  const last = inspection.lastCancel;
  if (row.refundAmount > 0 && inspection.balanceAmount === row.balanceBefore - row.refundAmount
    && last && last.cancelAmount === row.refundAmount && TRANSACTION_KEY.test(last.transactionKey)) {
    return { ok: true, resolution: 'already_canceled', observedBalance: inspection.balanceAmount, transactionKey: last.transactionKey };
  }
  return { ok: false, code: 'balance_unexplained' };
}
