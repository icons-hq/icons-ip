import 'server-only';

import { createServiceClient } from '../supabase/service';
import { normalizeTicketReference } from '../ticketing';

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

/* provider_* 코드 일부는 더 이상 새로 기록되지 않지만, 과거 요청 행이 이미
 * 이 코드들을 담고 있어 DB 계약과 읽기 표면을 위해 유지한다. */
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

      // 이 조회는 해지된 legacy Toss 계약의 원장 행만 본다. 신규 provider의
      // 티켓 환불은 PaymentGateway.refund seam이 정합화 경로다.
      const { data: paymentData, error: paymentError } = await service
        .from('payments')
        .select('id,status,amount,payment_key')
        .eq('provider', 'toss')
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
 * 처리권을 획득한 티켓 취소 요청을 로컬 원자 RPC로 정합화한다.
 * 결제 키·금액은 service DB에서만 읽고 반환값에는 provider 식별자를 포함하지 않는다.
 *
 * provider 원격 왕복은 없다. 유상 캡처가 남아 있다면 그것은 해지된 legacy
 * Toss 계약의 결제뿐이라 원격 취소·재검증이 불가능하므로(#384), 자동 완료
 * 대신 수동 검토로 승격한다.
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

  if (activePayments.length > 0) {
    return markNeedsReview(dependencies, input, 'provider_unavailable');
  }

  try {
    await dependencies.completeRequest({
      requestId: input.requestId,
      attemptToken: input.attemptToken,
      verifiedPaymentKeys: [],
    });
  } catch {
    return markNeedsReview(dependencies, input, 'local_finalize_failed');
  }

  return { ok: true, status: 'completed' };
}
