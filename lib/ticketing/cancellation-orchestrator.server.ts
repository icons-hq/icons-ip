import 'server-only';

import {
  cancelTossPayment,
  fetchTossPayment,
  type TossApiResult,
} from '../payments/toss-api';
import {
  buildTossOrderId,
  normalizeTossPayment,
  verifyTossCancellationState,
} from '../payments/toss';
import { createLegacyTossPaymentRepository } from '../payments/legacy-toss-ledger.server';
import { createServiceClient } from '../supabase/service';
import { normalizeTicketReference } from '../ticketing';

const PROVIDER_CANCEL_REASON = '사용자 티켓 예매 취소';

export type TicketCancellationRequestStatus =
  | 'requested'
  | 'processing'
  | 'needs_review'
  | 'completed';

export type TicketCancellationPaymentStatus =
  | 'pending'
  | 'paid'
  | 'canceled'
  | 'failed'
  | 'refunded';

export interface TicketCancellationContext {
  requestId: string;
  ticketOrderId: string;
  requestedBy: string;
  requestStatus: TicketCancellationRequestStatus;
  orderStatus: 'pending' | 'paid' | 'canceled';
  payments: Array<{
    id: string;
    status: TicketCancellationPaymentStatus;
    amount: number;
    paymentKey: string | null;
  }>;
}

export type TicketCancellationCode =
  | 'request_not_found'
  | 'request_not_ready'
  | 'request_state_invalid'
  | 'local_state_unavailable'
  | 'payment_evidence_invalid'
  | 'provider_unavailable'
  | 'provider_mismatch'
  | 'provider_cancel_failed'
  | 'provider_cancellation_incomplete'
  | 'unsupported_payment_method'
  | 'local_evidence_failed'
  | 'local_finalize_failed';

export type TicketCancellationResult =
  | { ok: true; status: 'completed' | 'already_completed' }
  | { ok: false; code: TicketCancellationCode };

export interface TicketCancellationDependencies {
  loadContext(requestId: string, userId: string): Promise<TicketCancellationContext | null>;
  fetchPayment(paymentKey: string): Promise<TossApiResult>;
  cancelPayment(input: {
    paymentKey: string;
    cancelReason: string;
    idempotencyKey: string;
  }): Promise<TossApiResult>;
  recordEvidence(input: {
    ticketOrderId: string;
    reason: string;
    paymentKey: string;
    providerRaw: unknown;
    refundConfirmed: boolean;
  }): Promise<void>;
  completeRequest(input: {
    requestId: string;
    attemptToken: string;
    verifiedPaymentKeys: string[];
  }): Promise<void>;
  markNeedsReview(input: {
    requestId: string;
    attemptToken: string;
    code: TicketCancellationCode;
  }): Promise<void>;
}

const REQUEST_STATUSES = new Set<TicketCancellationRequestStatus>([
  'requested',
  'processing',
  'needs_review',
  'completed',
]);
const ORDER_STATUSES = new Set<TicketCancellationContext['orderStatus']>([
  'pending',
  'paid',
  'canceled',
]);
const PAYMENT_STATUSES = new Set<TicketCancellationPaymentStatus>([
  'pending',
  'paid',
  'canceled',
  'failed',
  'refunded',
]);

function createDefaultDependencies(): TicketCancellationDependencies {
  const service = createServiceClient();
  const tossPayments = createLegacyTossPaymentRepository(service);

  return {
    async loadContext(requestId, userId) {
      const { data: requestData, error: requestError } = await service
        .from('ticket_cancellation_requests')
        .select('id,ticket_order_id,requested_by,status')
        .eq('id', requestId)
        .eq('requested_by', userId)
        .maybeSingle();

      if (requestError) throw new Error('ticket cancellation request lookup failed');
      if (!requestData) return null;
      const request = requestData as Record<string, unknown>;

      const { data: orderData, error: orderError } = await service
        .from('ticket_orders')
        .select('id,user_id,status')
        .eq('id', request.ticket_order_id)
        .eq('user_id', userId)
        .maybeSingle();

      if (orderError || !orderData) throw new Error('ticket order lookup failed');
      const order = orderData as Record<string, unknown>;

      const { data: paymentData, error: paymentError } = await tossPayments
        .select('id,status,amount,payment_key')
        .eq('purpose', 'ticket')
        .eq('ref_id', request.ticket_order_id)
        .order('id', { ascending: true });

      if (paymentError) throw new Error('ticket cancellation payment lookup failed');

      return {
        requestId: request.id as string,
        ticketOrderId: request.ticket_order_id as string,
        requestedBy: request.requested_by as string,
        requestStatus: request.status as TicketCancellationRequestStatus,
        orderStatus: order.status as TicketCancellationContext['orderStatus'],
        payments: (paymentData ?? []).map((row) => {
          const payment = row as Record<string, unknown>;
          return {
            id: payment.id as string,
            status: payment.status as TicketCancellationPaymentStatus,
            amount: payment.amount as number,
            paymentKey: payment.payment_key as string | null,
          };
        }),
      };
    },
    fetchPayment: fetchTossPayment,
    cancelPayment: ({ paymentKey, cancelReason, idempotencyKey }) => (
      cancelTossPayment(paymentKey, cancelReason, idempotencyKey)
    ),
    async recordEvidence({ ticketOrderId, reason, paymentKey, providerRaw, refundConfirmed }) {
      const { error } = await service.rpc('record_ticket_provider_cancellation_evidence', {
        p_ticket_order_id: ticketOrderId,
        p_reason: reason,
        p_provider_payment_key: paymentKey,
        p_provider_raw: providerRaw,
        p_refund_confirmed: refundConfirmed,
      });
      if (error) throw new Error('ticket cancellation evidence recording failed');
    },
    async completeRequest({ requestId, attemptToken, verifiedPaymentKeys }) {
      const { error } = await service.rpc('complete_ticket_cancellation_request', {
        p_request_id: requestId,
        p_attempt_token: attemptToken,
        p_provider_payment_keys: verifiedPaymentKeys,
      });
      if (error) throw new Error('ticket cancellation completion failed');
    },
    async markNeedsReview({ requestId, attemptToken, code }) {
      const { error } = await service.rpc('mark_ticket_cancellation_needs_review', {
        p_request_id: requestId,
        p_attempt_token: attemptToken,
        p_error_code: code,
      });
      if (error) throw new Error('ticket cancellation review transition failed');
    },
  };
}

function isCanonicalReference(value: unknown): value is string {
  return typeof value === 'string' && normalizeTicketReference(value) === value;
}

function verificationFailureCode(
  reason: 'provider_response_mismatch' | 'unsupported_payment_contract' | 'incomplete_cancellation',
): TicketCancellationCode {
  return reason === 'incomplete_cancellation'
    ? 'provider_cancellation_incomplete'
    : 'provider_mismatch';
}

async function markNeedsReview(
  dependencies: TicketCancellationDependencies,
  input: { requestId: string; attemptToken: string },
  code: TicketCancellationCode,
): Promise<TicketCancellationResult> {
  try {
    await dependencies.markNeedsReview({
      requestId: input.requestId,
      attemptToken: input.attemptToken,
      code,
    });
    return { ok: false, code };
  } catch {
    return { ok: false, code: 'local_finalize_failed' };
  }
}

function isValidContext(
  context: TicketCancellationContext,
  input: { requestId: string; userId: string },
) {
  return isCanonicalReference(context.requestId)
    && context.requestId === input.requestId
    && isCanonicalReference(context.ticketOrderId)
    && isCanonicalReference(context.requestedBy)
    && context.requestedBy === input.userId
    && REQUEST_STATUSES.has(context.requestStatus)
    && ORDER_STATUSES.has(context.orderStatus)
    && Array.isArray(context.payments);
}

/**
 * 처리권을 획득한 티켓 취소 요청을 fresh provider 증거와 원자 RPC로 정합화한다.
 * 결제 키·금액은 service DB에서만 읽고 반환값에는 provider 식별자를 포함하지 않는다.
 */
export async function reconcileTicketCancellation(
  input: { requestId: string; userId: string; attemptToken: string },
  providedDependencies?: TicketCancellationDependencies,
): Promise<TicketCancellationResult> {
  if (
    !isCanonicalReference(input.requestId)
    || !isCanonicalReference(input.userId)
    || !isCanonicalReference(input.attemptToken)
  ) {
    return { ok: false, code: 'request_state_invalid' };
  }

  let dependencies: TicketCancellationDependencies;
  try {
    dependencies = providedDependencies ?? createDefaultDependencies();
  } catch {
    return { ok: false, code: 'local_state_unavailable' };
  }

  let context: TicketCancellationContext | null;
  try {
    context = await dependencies.loadContext(input.requestId, input.userId);
  } catch {
    return { ok: false, code: 'local_state_unavailable' };
  }

  if (!context) return { ok: false, code: 'request_not_found' };
  if (!isValidContext(context, input)) return { ok: false, code: 'request_state_invalid' };
  if (context.requestStatus === 'completed') {
    return { ok: true, status: 'already_completed' };
  }
  if (context.requestStatus !== 'processing') {
    return { ok: false, code: 'request_not_ready' };
  }

  const activePayments = context.payments.filter((payment) => payment.status !== 'failed');
  const paymentIds = new Set<string>();
  const paymentKeys = new Set<string>();
  for (const payment of context.payments) {
    if (!isCanonicalReference(payment.id) || !PAYMENT_STATUSES.has(payment.status)) {
      return markNeedsReview(dependencies, input, 'payment_evidence_invalid');
    }
    if (payment.status === 'failed') continue;
    if (
      !Number.isSafeInteger(payment.amount)
      || payment.amount <= 0
      || typeof payment.paymentKey !== 'string'
      || !payment.paymentKey
      || payment.paymentKey.trim() !== payment.paymentKey
      || paymentIds.has(payment.id)
      || paymentKeys.has(payment.paymentKey)
    ) {
      return markNeedsReview(dependencies, input, 'payment_evidence_invalid');
    }
    paymentIds.add(payment.id);
    paymentKeys.add(payment.paymentKey);
  }
  if (activePayments.length === 0 && context.orderStatus !== 'pending') {
    return markNeedsReview(dependencies, input, 'payment_evidence_invalid');
  }

  const verifiedPaymentKeys: string[] = [];
  const payments = [...activePayments].sort((left, right) => left.id.localeCompare(right.id));
  for (const payment of payments) {
    const paymentKey = payment.paymentKey as string;
    const expected = {
      paymentKey,
      orderId: buildTossOrderId('ticket', context.ticketOrderId),
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
    const beforePayment = normalizeTossPayment(beforeCancel.body);
    if (!beforePayment?.method || beforePayment.method === '가상계좌') {
      return markNeedsReview(dependencies, input, 'unsupported_payment_method');
    }

    let providerRaw = beforeCancel.body;

    if (beforeVerification.state === 'uncanceled') {
      try {
        await dependencies.cancelPayment({
          paymentKey,
          cancelReason: PROVIDER_CANCEL_REASON,
          idempotencyKey: `ticket-cancel-${input.requestId}-${payment.id}`,
        });
      } catch {
        // POST 성공 여부와 무관하게 바로 이어지는 fresh GET만 최종 증거로 사용한다.
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
        return markNeedsReview(dependencies, input, 'provider_cancel_failed');
      }
      const afterPayment = normalizeTossPayment(afterCancel.body);
      if (!afterPayment?.method || afterPayment.method === '가상계좌') {
        return markNeedsReview(dependencies, input, 'unsupported_payment_method');
      }
      providerRaw = afterCancel.body;
    }

    try {
      await dependencies.recordEvidence({
        ticketOrderId: context.ticketOrderId,
        reason: PROVIDER_CANCEL_REASON,
        paymentKey,
        providerRaw,
        refundConfirmed: true,
      });
    } catch {
      return markNeedsReview(dependencies, input, 'local_evidence_failed');
    }
    verifiedPaymentKeys.push(paymentKey);
  }

  try {
    await dependencies.completeRequest({
      requestId: input.requestId,
      attemptToken: input.attemptToken,
      verifiedPaymentKeys,
    });
  } catch {
    return markNeedsReview(dependencies, input, 'local_finalize_failed');
  }

  return { ok: true, status: 'completed' };
}
