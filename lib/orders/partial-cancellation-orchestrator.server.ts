import 'server-only';

import { PARTIAL_CANCEL_UNAVAILABLE_REASON, type PaymentAttempt, type RefundOutcome } from '../payments/gateway';
import { getPaymentGateway } from '../payments/runtime-gateway';
import { createServiceClient } from '../supabase/service';
import { createRuntimeAttemptPaymentGateway } from '../subscriptions/payment-dispatch.server';
import { parseOrderPartialCancellationServiceRow, type OrderPartialCancellationServiceRow } from './partial-cancellation';

/** 토스 cancelReason(≤200자). */
export const ORDER_PARTIAL_CANCEL_REFUND_REASON = 'ICONS 재고 부족 부분 취소';

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
  }): Promise<RefundOutcome>;
  complete(input: { id: string; actorId: string; refundedAmount: number; paymentKey: string; transactionKey: string }): Promise<void>;
  reject(input: { id: string; actorId: string }): Promise<void>;
  markNeedsReview(input: { id: string; actorId: string; code: OrderPartialCancellationCode }): Promise<void>;
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

function createDefaultDependencies(): OrderPartialCancellationDependencies {
  const service = createServiceClient();
  return {
    async load(id) {
      const { data, error } = await service.rpc('service_order_partial_cancellation', { p_id: id });
      if (error) throw new Error('partial cancellation lookup failed');
      return parseOrderPartialCancellationServiceRow(data);
    },
    async refund({ partialCancellationId, paymentId, paymentAmount, paymentKey, refundAmount, expectedBalanceBefore }) {
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
      const attempt: PaymentAttempt = {
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
      const gateway = createRuntimeAttemptPaymentGateway(service, 'toss', getPaymentGateway('toss'));
      return gateway.refund({
        attempt,
        idempotencyKey: orderPartialCancellationIdempotencyKey(attempt.id, partialCancellationId),
        amount: refundAmount,
        reason: ORDER_PARTIAL_CANCEL_REFUND_REASON,
        providerPaymentKey: paymentKey,
        partial: { expectedBalanceBefore },
      });
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
  input: { id: string; actorId: string },
  code: OrderPartialCancellationCode,
): Promise<OrderPartialCancellationResult> {
  try {
    await dependencies.markNeedsReview({ ...input, code });
    return { ok: false, code };
  } catch {
    return { ok: false, code: 'local_finalize_failed' };
  }
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

  const target = { id: row.id, actorId: input.actorId };
  if (
    typeof row.paymentKey !== 'string'
    || !row.paymentKey
    || row.paymentStatus !== 'paid'
    || row.paymentLiveAmount !== row.paymentAmount
    || row.balanceBefore > row.paymentAmount
    || row.refundAmount <= 0
    || row.refundAmount >= row.balanceBefore
  ) {
    return needsReview(dependencies, target, 'payment_evidence_invalid');
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
      await dependencies.reject(target);
    } catch {
      return needsReview(dependencies, target, 'local_finalize_failed');
    }
    return { ok: false, code: 'partial_cancel_rejected' };
  }
  return needsReview(dependencies, target, reviewCode(refund));
}
