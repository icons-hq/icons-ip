import 'server-only';

import {
  cancelTossPayment,
  fetchTossPayment,
  type TossApiResult,
} from '../payments/toss-api';
import {
  buildTossOrderId,
  isIndeterminateTossFailure,
  verifyTossCancellationState,
} from '../payments/toss';
import { createServiceClient } from '../supabase/service';

const PROVIDER_CANCEL_REASON = '관리자 승인 주문 취소';

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
  | { ok: true; status: 'completed' | 'already_completed' }
  | { ok: false; code: CancellationReconciliationCode };

export interface CancellationReconciliationDependencies {
  loadContext(requestId: string): Promise<CancellationReconciliationContext | null>;
  fetchPayment(paymentKey: string): Promise<TossApiResult>;
  cancelPayment(input: {
    paymentKey: string;
    cancelReason: string;
    idempotencyKey: string;
  }): Promise<TossApiResult>;
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
    fetchPayment: fetchTossPayment,
    cancelPayment: ({ paymentKey, cancelReason }) => (
      cancelTossPayment(paymentKey, cancelReason)
    ),
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

function verificationFailureCode(
  reason: 'provider_response_mismatch' | 'unsupported_payment_contract' | 'incomplete_cancellation',
): CancellationReconciliationCode {
  return reason === 'incomplete_cancellation'
    ? 'provider_cancellation_incomplete'
    : 'provider_mismatch';
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
 * 승인된 주문 취소 요청을 provider의 fresh GET 증거와 로컬 원자 RPC로 정합화한다.
 * 호출자는 인증된 actor/request id만 전달하며 결제 키·금액은 service DB에서만 읽는다.
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
  if (context.status !== 'processing') return { ok: false, code: 'request_not_ready' };

  const verifiedPaymentKeys: string[] = [];
  const payments = [...context.payments].sort((left, right) => left.id.localeCompare(right.id));

  for (const payment of payments) {
    if (payment.status === 'failed') continue;
    if (
      typeof payment.paymentKey !== 'string'
      || !payment.paymentKey
      || !Number.isSafeInteger(payment.amount)
      || payment.amount <= 0
    ) {
      return markNeedsReview(dependencies, input, 'payment_evidence_invalid');
    }

    const paymentKey = payment.paymentKey;
    const expected = {
      paymentKey,
      orderId: buildTossOrderId('order', context.orderId),
      amount: payment.amount,
    };

    let beforeCancel: TossApiResult;
    try {
      beforeCancel = await dependencies.fetchPayment(paymentKey);
    } catch {
      return markNeedsReview(dependencies, input, 'provider_unavailable');
    }
    if (!beforeCancel.ok) {
      return markNeedsReview(dependencies, input, 'provider_unavailable');
    }

    const beforeVerification = verifyTossCancellationState(beforeCancel.body, expected);
    if (!beforeVerification.ok) {
      return markNeedsReview(
        dependencies,
        input,
        verificationFailureCode(beforeVerification.reason),
      );
    }
    if (beforeVerification.state === 'fully_canceled') {
      verifiedPaymentKeys.push(paymentKey);
      continue;
    }

    let cancelResult: TossApiResult;
    try {
      cancelResult = await dependencies.cancelPayment({
        paymentKey,
        cancelReason: PROVIDER_CANCEL_REASON,
        idempotencyKey: `cancel-${paymentKey}`,
      });
    } catch {
      cancelResult = {
        ok: false,
        status: 0,
        code: 'NETWORK_ERROR',
        message: 'provider request failed',
      };
    }

    let afterCancel: TossApiResult;
    try {
      afterCancel = await dependencies.fetchPayment(paymentKey);
    } catch {
      return markNeedsReview(dependencies, input, 'provider_unavailable');
    }
    if (!afterCancel.ok) {
      return markNeedsReview(dependencies, input, 'provider_unavailable');
    }

    const afterVerification = verifyTossCancellationState(afterCancel.body, expected);
    if (!afterVerification.ok) {
      return markNeedsReview(
        dependencies,
        input,
        verificationFailureCode(afterVerification.reason),
      );
    }
    if (afterVerification.state !== 'fully_canceled') {
      const code = !cancelResult.ok && isIndeterminateTossFailure(cancelResult)
        ? 'provider_unavailable'
        : 'provider_cancel_failed';
      return markNeedsReview(dependencies, input, code);
    }

    verifiedPaymentKeys.push(paymentKey);
  }

  try {
    await dependencies.completeRequest({
      requestId: input.requestId,
      actorId: input.actorId,
      verifiedPaymentKeys: [...new Set(verifiedPaymentKeys)],
    });
  } catch {
    return markNeedsReview(dependencies, input, 'local_finalize_failed');
  }

  return { ok: true, status: 'completed' };
}
