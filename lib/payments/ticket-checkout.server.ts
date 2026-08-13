import 'server-only';

import type {
  ConfirmOutcome,
  PaymentAttempt,
  PaymentOutcome,
  PaymentProviderEvidence,
  RefundOutcome,
} from './gateway';
import type {
  TicketPaymentAttemptClaim,
  TicketPaymentAttemptRepository,
  TicketPaymentFinalization,
  TicketRefundClaim,
  TicketRefundFinalization,
} from './ticket-checkout';

interface RpcResult {
  readonly data: unknown;
  readonly error: { readonly message: string } | null;
}

interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
}

const PAYMENT_OUTCOMES = new Set<PaymentOutcome>([
  'approved',
  'declined',
  'canceled',
  'unknown',
  'needs_review',
]);

export class TicketPaymentRepositoryError extends Error {
  constructor() {
    super('ticket_payment_repository_failed');
    this.name = 'TicketPaymentRepositoryError';
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TicketPaymentRepositoryError();
  }
  return value as Record<string, unknown>;
}

function parseAttempt(value: unknown): PaymentAttempt {
  const row = record(value);
  if (
    typeof row.id !== 'string'
    || (row.provider !== 'toss' && row.provider !== 'korpay')
    || row.purpose !== 'ticket'
    || typeof row.ref_id !== 'string'
    || !Number.isSafeInteger(row.amount)
    || (row.amount as number) <= 0
    || typeof row.currency !== 'string'
    || typeof row.idempotency_key !== 'string'
    || typeof row.provider_order_id !== 'string'
    || typeof row.provider_product_code !== 'string'
    || typeof row.expires_at !== 'string'
  ) throw new TicketPaymentRepositoryError();

  return {
    id: row.id,
    provider: row.provider,
    purpose: row.purpose,
    refId: row.ref_id,
    amount: row.amount as number,
    currency: row.currency,
    idempotencyKey: row.idempotency_key,
    providerOrderId: row.provider_order_id,
    providerProductCode: row.provider_product_code,
    expiresAt: row.expires_at,
  };
}

function parseOutcome(value: unknown): PaymentOutcome {
  if (typeof value !== 'string' || !PAYMENT_OUTCOMES.has(value as PaymentOutcome)) {
    throw new TicketPaymentRepositoryError();
  }
  return value as PaymentOutcome;
}

function baseOutcome(attempt: PaymentAttempt, outcome: PaymentOutcome): ConfirmOutcome {
  return { attemptId: attempt.id, provider: attempt.provider, outcome };
}

function parseAttemptClaim(value: unknown): TicketPaymentAttemptClaim {
  const row = record(value);
  const attempt = parseAttempt(row.attempt);
  if (row.claim_status === 'claimed') return { status: 'claimed', attempt, claimToken: '' };
  if (row.claim_status === 'in_progress') return { status: 'in_progress', attempt };
  if (row.claim_status === 'terminal') {
    return { status: 'terminal', attempt, outcome: baseOutcome(attempt, parseOutcome(row.outcome)) };
  }
  throw new TicketPaymentRepositoryError();
}

function parseRefundClaim(value: unknown): TicketRefundClaim {
  const row = record(value);
  if (row.claim_status === 'legacy') return { status: 'legacy' };
  const claim = parseAttemptClaim(value);
  if (claim.status !== 'terminal') return claim;
  return {
    ...claim,
    outcome: {
      ...claim.outcome,
      ...(claim.outcome.outcome === 'approved' ? { refundedAmount: claim.attempt.amount } : {}),
    },
  };
}

async function rpc(client: RpcClient, name: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new TicketPaymentRepositoryError();
  return data;
}

function evidenceArgs(evidence: PaymentProviderEvidence | undefined) {
  return {
    p_provider_payment_key: evidence?.providerPaymentKey ?? null,
    p_provider_transaction_id: evidence?.providerTransactionId ?? null,
    p_provider_approval_reference: evidence?.providerApprovalReference ?? null,
    p_result_code: evidence?.resultCode ?? null,
    p_payment_method: evidence?.paymentMethod ?? null,
    p_masked_payment_method: evidence?.maskedPaymentMethod ?? null,
    p_approved_at: evidence?.approvedAt ?? null,
  };
}

function guardedConfirmOutcome(
  input: ConfirmOutcome,
  finalized: PaymentOutcome,
): ConfirmOutcome {
  return finalized === input.outcome
    ? input
    : { ...input, outcome: finalized, reasonCode: 'database_finalization_guard' };
}

function guardedRefundOutcome(
  input: RefundOutcome,
  finalized: PaymentOutcome,
): RefundOutcome {
  return finalized === input.outcome
    ? input
    : {
        ...input,
        outcome: finalized,
        reasonCode: 'database_finalization_guard',
        refundedAmount: finalized === 'approved' ? input.refundedAmount : undefined,
      };
}

export function createTicketPaymentAttemptRepository(
  client: RpcClient,
): TicketPaymentAttemptRepository {
  return {
    async prepareTicketAttempt({ userId, ticketOrderId, provider }) {
      return parseAttempt(await rpc(client, 'prepare_ticket_payment_attempt', {
        p_user_id: userId,
        p_ticket_order_id: ticketOrderId,
        p_provider: provider,
      }));
    },

    async bindCallbackNonce({ attemptId, callbackNonceDigest }) {
      await rpc(client, 'bind_ticket_payment_callback_nonce', {
        p_attempt_id: attemptId,
        p_callback_nonce_digest: callbackNonceDigest,
      });
    },

    async claimTicketAttempt({
      provider,
      providerOrderId,
      callbackNonceDigest,
      claimToken,
    }) {
      const claim = parseAttemptClaim(await rpc(client, 'claim_ticket_payment_attempt', {
        p_provider: provider,
        p_provider_order_id: providerOrderId,
        p_callback_nonce_digest: callbackNonceDigest,
        p_claim_token: claimToken,
      }));
      return claim.status === 'claimed' ? { ...claim, claimToken } : claim;
    },

    async finalizeTicketAttempt(input: TicketPaymentFinalization) {
      const finalized = parseOutcome(await rpc(client, 'finalize_ticket_payment_attempt', {
        p_attempt_id: input.attemptId,
        p_claim_token: input.claimToken,
        p_outcome: input.outcome.outcome,
        ...evidenceArgs(input.outcome.evidence),
      }));
      return guardedConfirmOutcome(input.outcome, finalized);
    },

    async claimTicketReconciliation({ attemptId, claimToken, caseRef }) {
      const claim = parseAttemptClaim(await rpc(client, 'claim_ticket_payment_reconciliation', {
        p_attempt_id: attemptId,
        p_claim_token: claimToken,
        p_case_ref: caseRef,
      }));
      return claim.status === 'claimed' ? { ...claim, claimToken } : claim;
    },

    async finalizeTicketReconciliation(input: TicketPaymentFinalization) {
      const finalized = parseOutcome(await rpc(client, 'finalize_ticket_payment_reconciliation', {
        p_attempt_id: input.attemptId,
        p_claim_token: input.claimToken,
        p_outcome: input.outcome.outcome,
        ...evidenceArgs(input.outcome.evidence),
      }));
      return guardedConfirmOutcome(input.outcome, finalized);
    },

    async claimTicketRefund({ requestId, userId, claimToken }) {
      const claim = parseRefundClaim(await rpc(client, 'claim_ticket_payment_refund', {
        p_request_id: requestId,
        p_user_id: userId,
        p_claim_token: claimToken,
      }));
      return claim.status === 'claimed' ? { ...claim, claimToken } : claim;
    },

    async finalizeTicketRefund(input: TicketRefundFinalization) {
      const finalized = parseOutcome(await rpc(client, 'finalize_ticket_payment_refund', {
        p_request_id: input.requestId,
        p_attempt_id: input.attemptId,
        p_claim_token: input.claimToken,
        p_outcome: input.outcome.outcome,
        p_refunded_amount: input.outcome.refundedAmount ?? null,
        ...evidenceArgs(input.outcome.evidence),
      }));
      return guardedRefundOutcome(input.outcome, finalized);
    },

    async claimTicketRefundReconciliation({ requestId, claimToken, caseRef }) {
      const claim = parseRefundClaim(await rpc(client, 'claim_ticket_refund_reconciliation', {
        p_request_id: requestId,
        p_claim_token: claimToken,
        p_case_ref: caseRef,
      }));
      if (claim.status === 'legacy') throw new TicketPaymentRepositoryError();
      return claim.status === 'claimed' ? { ...claim, claimToken } : claim;
    },

    async finalizeTicketRefundReconciliation(input: TicketRefundFinalization) {
      const finalized = parseOutcome(await rpc(client, 'finalize_ticket_refund_reconciliation', {
        p_request_id: input.requestId,
        p_attempt_id: input.attemptId,
        p_claim_token: input.claimToken,
        p_outcome: input.outcome.outcome,
        p_refunded_amount: input.outcome.refundedAmount ?? null,
        ...evidenceArgs(input.outcome.evidence),
      }));
      return guardedRefundOutcome(input.outcome, finalized);
    },
  };
}
