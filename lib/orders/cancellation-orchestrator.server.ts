import 'server-only';

import type { PaymentAttempt, RefundOutcome } from '../payments/gateway';
import { getPaymentGateway } from '../payments/runtime-gateway';
import { createServiceClient } from '../supabase/service';

export type CancellationRequestStatus =
  | 'requested'
  | 'processing'
  | 'needs_review'
  | 'completed'
  | 'rejected';

export type CancellationPaymentStatus =
  | 'pending'
  | 'paid'
  | 'canceled'
  | 'failed'
  | 'refunded';

export type CancellationPaymentProvider = 'toss' | 'korpay';

export interface CancellationReconciliationContext {
  requestId: string;
  orderId: string;
  status: CancellationRequestStatus;
  payments: Array<{
    id: string;
    provider: CancellationPaymentProvider;
    status: CancellationPaymentStatus;
    amount: number;
    paymentKey: string | null;
  }>;
}

/* provider_* 코드 일부는 더 이상 새로 기록되지 않지만, 과거 요청 행이 이미
 * 이 코드들을 담고 있어 DB 계약과 읽기 표면을 위해 유지한다. */
export type CancellationReconciliationCode =
  | 'request_not_found'
  | 'request_not_ready'
  | 'local_state_unavailable'
  | 'payment_evidence_invalid'
  | 'provider_unavailable'
  | 'provider_mismatch'
  | 'provider_cancel_failed'
  | 'provider_cancellation_incomplete'
  | 'local_finalize_failed';

export type CancellationReconciliationResult =
  | { ok: true; status: 'completed' | 'already_completed' | 'in_progress' }
  | { ok: false; code: CancellationReconciliationCode };

export type ExpiredPreparedGoodsReconciliation =
  | 'completed'
  | 'in_progress'
  | 'not_applicable';

export interface CancellationReconciliationDependencies {
  loadContext(requestId: string): Promise<CancellationReconciliationContext | null>;
  reconcileExpiredPreparedGoods(input: {
    requestId: string;
    actorId: string;
  }): Promise<ExpiredPreparedGoodsReconciliation>;
  /**
   * toss 유상 캡처의 전액 취소. 게이트웨이가 취소 API 발행 후 fresh 조회로
   * 전액 취소를 검증한 결과(5-outcome)를 그대로 돌려준다(#389).
   */
  refundTossPayment(input: {
    paymentId: string;
    amount: number;
    reason: string;
  }): Promise<RefundOutcome>;
  completeRequest(input: {
    requestId: string;
    actorId: string;
    verifiedPaymentKeys: string[];
  }): Promise<void>;
  markNeedsReview(input: {
    requestId: string;
    actorId: string;
    code: CancellationReconciliationCode;
  }): Promise<void>;
}

const REQUEST_STATUSES = new Set<CancellationRequestStatus>([
  'requested',
  'processing',
  'needs_review',
  'completed',
  'rejected',
]);
const PAYMENT_STATUSES = new Set<CancellationPaymentStatus>([
  'pending',
  'paid',
  'canceled',
  'failed',
  'refunded',
]);
function createDefaultDependencies(): CancellationReconciliationDependencies {
  const service = createServiceClient();

  return {
    async loadContext(requestId) {
      const { data: requestData, error: requestError } = await service
        .from('order_cancellation_requests')
        .select('id,order_id,status')
        .eq('id', requestId)
        .maybeSingle();

      if (requestError) throw new Error('cancellation request lookup failed');
      if (!requestData) return null;

      const request = requestData as Record<string, unknown>;
      if (
        typeof request.id !== 'string'
        || typeof request.order_id !== 'string'
        || typeof request.status !== 'string'
        || !REQUEST_STATUSES.has(request.status as CancellationRequestStatus)
      ) {
        throw new Error('invalid cancellation request state');
      }

      // 카드 provider 원장만 본다(무통장 환불은 별도 계좌 환불 경로 — ADR-0010).
      // toss는 취소 API 자동화 경로(#389), korpay는 수동 복구 seam이 정합화 경로다.
      const { data: paymentData, error: paymentError } = await service
        .from('payments')
        .select('id,provider,status,amount,payment_key')
        .in('provider', ['toss', 'korpay'])
        .eq('purpose', 'order')
        .eq('ref_id', request.order_id)
        .order('id', { ascending: true });

      if (paymentError) throw new Error('cancellation payment lookup failed');

      const payments = (paymentData ?? []).map((paymentDataRow) => {
        const payment = paymentDataRow as Record<string, unknown>;
        if (
          typeof payment.id !== 'string'
          || (payment.provider !== 'toss' && payment.provider !== 'korpay')
          || typeof payment.status !== 'string'
          || !PAYMENT_STATUSES.has(payment.status as CancellationPaymentStatus)
          || typeof payment.amount !== 'number'
          || !Number.isSafeInteger(payment.amount)
          || (payment.payment_key !== null && typeof payment.payment_key !== 'string')
        ) {
          throw new Error('invalid cancellation payment state');
        }
        return {
          id: payment.id,
          provider: payment.provider as CancellationPaymentProvider,
          status: payment.status as CancellationPaymentStatus,
          amount: payment.amount,
          paymentKey: payment.payment_key as string | null,
        };
      });

      return {
        requestId: request.id,
        orderId: request.order_id,
        status: request.status as CancellationRequestStatus,
        payments,
      };
    },
    async refundTossPayment({ paymentId, amount, reason }) {
      const { data, error } = await service
        .from('payment_attempts')
        .select('id,provider,purpose,ref_id,amount,currency,idempotency_key,provider_order_id,provider_product_code,expires_at')
        .eq('payment_id', paymentId)
        .maybeSingle();
      if (error) throw new Error('payment attempt lookup failed');
      // provider-neutral 원장 이전(라이브 첫날) 결제는 attempt 행이 없을 수 있다
      // — 자동 취소 근거가 없으므로 수동 검토로 승격시킨다.
      if (!data) throw new Error('payment attempt missing');
      const row = data as Record<string, unknown>;
      if (
        row.provider !== 'toss'
        || row.purpose !== 'order'
        || typeof row.id !== 'string'
        || typeof row.ref_id !== 'string'
        || typeof row.amount !== 'number'
        || row.amount !== amount
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
        amount: row.amount,
        currency: row.currency,
        idempotencyKey: row.idempotency_key,
        providerOrderId: row.provider_order_id,
        providerProductCode: row.provider_product_code,
        expiresAt: row.expires_at,
      };
      return getPaymentGateway('toss').refund({
        attempt,
        idempotencyKey: `refund:${attempt.id}`,
        amount,
        reason,
      });
    },
    async reconcileExpiredPreparedGoods({ requestId, actorId }) {
      const { data, error } = await service.rpc(
        'reconcile_expired_prepared_goods_cancellation',
        {
          p_actor_id: actorId,
          p_request_id: requestId,
        },
      );
      if (error
        || (data !== 'completed'
          && data !== 'in_progress'
          && data !== 'not_applicable')
      ) {
        throw new Error('prepared goods cancellation reconciliation failed');
      }
      return data;
    },
    async completeRequest({ requestId, actorId, verifiedPaymentKeys }) {
      const { error } = await service.rpc('complete_order_cancellation_request', {
        p_request_id: requestId,
        p_provider_payment_keys: verifiedPaymentKeys,
        p_actor_id: actorId,
      });
      if (error) throw new Error('cancellation completion failed');
    },
    async markNeedsReview({ requestId, actorId, code }) {
      const { error } = await service.rpc('mark_order_cancellation_needs_review', {
        p_request_id: requestId,
        p_actor_id: actorId,
        p_error_code: code,
      });
      if (error) throw new Error('cancellation review transition failed');
    },
  };
}

async function markNeedsReview(
  dependencies: CancellationReconciliationDependencies,
  input: { requestId: string; actorId: string },
  code: CancellationReconciliationCode,
): Promise<CancellationReconciliationResult> {
  try {
    await dependencies.markNeedsReview({ ...input, code });
    return { ok: false, code };
  } catch {
    return { ok: false, code: 'local_finalize_failed' };
  }
}

/**
 * 승인된 주문 취소 요청을 정합화한다. 호출자는 인증된 actor/request id만
 * 전달하며 결제 키·금액은 service DB에서만 읽는다.
 *
 * toss 유상 캡처는 게이트웨이 refund(취소 API 발행 + fresh 조회 검증)로 자동
 * 취소하고, 검증된 키만 완료 RPC에 넘긴다(#389). korpay 유상 캡처는 취소 API가
 * 없어 수동 복구 seam(goods-manual-recovery)이 정상 경로이므로 여기서는 수동
 * 검토로 승격한다. 실패·모호는 자동 종결하지 않는다.
 */
export async function reconcileOrderCancellation(
  input: { requestId: string; actorId: string },
  providedDependencies?: CancellationReconciliationDependencies,
): Promise<CancellationReconciliationResult> {
  let dependencies: CancellationReconciliationDependencies;
  try {
    dependencies = providedDependencies ?? createDefaultDependencies();
  } catch {
    return { ok: false, code: 'local_state_unavailable' };
  }

  let context: CancellationReconciliationContext | null;
  try {
    context = await dependencies.loadContext(input.requestId);
  } catch {
    return { ok: false, code: 'local_state_unavailable' };
  }

  if (!context) return { ok: false, code: 'request_not_found' };
  if (context.status === 'completed') return { ok: true, status: 'already_completed' };
  if (context.status !== 'processing' && context.status !== 'needs_review') {
    return { ok: false, code: 'request_not_ready' };
  }

  // A Korpay prepared session has no provider capture to cancel. Its durable
  // action TTL decides when stock can be released, and the service-only RPC
  // owns that exact expiry check under the money locks.
  let preparedGoods: ExpiredPreparedGoodsReconciliation;
  try {
    preparedGoods = await dependencies.reconcileExpiredPreparedGoods(input);
  } catch {
    return { ok: false, code: 'local_state_unavailable' };
  }
  if (preparedGoods === 'completed') return { ok: true, status: 'completed' };
  if (preparedGoods === 'in_progress') return { ok: true, status: 'in_progress' };
  // needs_review is admitted only for the dedicated no-capture decision above.
  // Anything else still requires admin_begin... to have restored the request
  // to processing before completion.
  if (context.status !== 'processing') return { ok: false, code: 'request_not_ready' };

  const verifiedPaymentKeys: string[] = [];
  for (const payment of context.payments) {
    if (payment.status === 'failed') continue;
    if (
      typeof payment.paymentKey !== 'string'
      || !payment.paymentKey
      || !Number.isSafeInteger(payment.amount)
      || payment.amount <= 0
    ) {
      return markNeedsReview(dependencies, input, 'payment_evidence_invalid');
    }
    if (payment.provider !== 'toss') {
      // korpay는 취소 API가 없다 — 수동 복구 seam(운영자 확인)이 정상 경로다.
      return markNeedsReview(dependencies, input, 'provider_unavailable');
    }

    let refund: RefundOutcome;
    try {
      refund = await dependencies.refundTossPayment({
        paymentId: payment.id,
        amount: payment.amount,
        reason: 'ICONS 주문 취소',
      });
    } catch {
      return markNeedsReview(dependencies, input, 'provider_unavailable');
    }
    if (refund.outcome === 'approved' && refund.refundedAmount === payment.amount) {
      verifiedPaymentKeys.push(payment.paymentKey);
      continue;
    }
    // 명시 거절(needs_review·declined)은 취소 실패로, 모호(unknown)는 provider
    // 불가로 남긴다 — 어느 쪽도 돈이 걸린 판단을 추측으로 종결하지 않는다.
    return markNeedsReview(
      dependencies,
      input,
      refund.outcome === 'unknown' ? 'provider_unavailable' : 'provider_cancel_failed',
    );
  }

  try {
    await dependencies.completeRequest({
      requestId: input.requestId,
      actorId: input.actorId,
      verifiedPaymentKeys,
    });
  } catch {
    return markNeedsReview(dependencies, input, 'local_finalize_failed');
  }

  return { ok: true, status: 'completed' };
}
