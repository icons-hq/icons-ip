import 'server-only';

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

export interface CancellationReconciliationContext {
  requestId: string;
  orderId: string;
  status: CancellationRequestStatus;
  payments: Array<{
    id: string;
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

      // 이 조회는 해지된 legacy Toss 계약의 원장 행만 본다. Korpay 결제는 여기가
      // 아니라 수동 복구 seam(goods-manual-recovery)이 정합화 경로다.
      const { data: paymentData, error: paymentError } = await service
        .from('payments')
        .select('id,status,amount,payment_key')
        .eq('provider', 'toss')
        .eq('purpose', 'order')
        .eq('ref_id', request.order_id)
        .order('id', { ascending: true });

      if (paymentError) throw new Error('cancellation payment lookup failed');

      const payments = (paymentData ?? []).map((paymentDataRow) => {
        const payment = paymentDataRow as Record<string, unknown>;
        if (
          typeof payment.id !== 'string'
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
 * 승인된 주문 취소 요청을 로컬 원자 RPC로 정합화한다. 호출자는 인증된
 * actor/request id만 전달하며 결제 키·금액은 service DB에서만 읽는다.
 *
 * provider 원격 왕복은 없다. 유상 캡처가 남아 있다면 그것은 해지된 legacy
 * Toss 계약의 결제뿐이라 원격 취소·재검증이 불가능하므로(#384), 자동 완료
 * 대신 수동 검토로 승격하는 것이 이 함수가 내릴 수 있는 가장 강한 판정이다.
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
    return markNeedsReview(dependencies, input, 'provider_unavailable');
  }

  try {
    await dependencies.completeRequest({
      requestId: input.requestId,
      actorId: input.actorId,
      verifiedPaymentKeys: [],
    });
  } catch {
    return markNeedsReview(dependencies, input, 'local_finalize_failed');
  }

  return { ok: true, status: 'completed' };
}
