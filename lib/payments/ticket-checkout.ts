import { createHash, randomUUID } from 'node:crypto';
import type {
  ConfirmOutcome,
  PaymentAttempt,
  PaymentGateway,
  PaymentProvider,
  PaymentProviderEvidence,
  PreparedCheckout,
  RefundOutcome,
} from './gateway';

export class TicketPaymentContractError extends Error {
  constructor(readonly code: string) {
    super(`Ticket payment contract failed: ${code}`);
    this.name = 'TicketPaymentContractError';
  }
}

export class TicketPaymentConfirmationInProgressError extends Error {
  constructor() {
    super('Ticket payment confirmation is already in progress');
    this.name = 'TicketPaymentConfirmationInProgressError';
  }
}

export class TicketRefundInProgressError extends Error {
  constructor() {
    super('Ticket refund is already in progress');
    this.name = 'TicketRefundInProgressError';
  }
}

export type TicketPaymentAttemptClaim =
  | {
      readonly status: 'claimed';
      readonly attempt: PaymentAttempt;
      readonly claimToken: string;
    }
  | {
      readonly status: 'in_progress';
      readonly attempt: PaymentAttempt;
    }
  | {
      readonly status: 'terminal';
      readonly attempt: PaymentAttempt;
      readonly outcome: ConfirmOutcome;
    };

export type TicketRefundClaim =
  | {
      readonly status: 'claimed';
      readonly attempt: PaymentAttempt;
      readonly claimToken: string;
    }
  | {
      readonly status: 'in_progress';
      readonly attempt: PaymentAttempt;
    }
  | {
      readonly status: 'terminal';
      readonly attempt: PaymentAttempt;
      readonly outcome: RefundOutcome;
    }
  | { readonly status: 'legacy' };

export interface TicketPaymentFinalization {
  readonly attemptId: string;
  readonly claimToken: string;
  readonly outcome: ConfirmOutcome;
}

export interface TicketRefundFinalization {
  readonly requestId: string;
  readonly attemptId: string;
  readonly claimToken: string;
  readonly outcome: RefundOutcome;
}

export interface TicketPaymentAttemptRepository {
  prepareTicketAttempt(input: {
    readonly userId: string;
    readonly ticketOrderId: string;
    readonly provider: PaymentProvider;
  }): Promise<PaymentAttempt>;
  bindCallbackNonce(input: {
    readonly attemptId: string;
    readonly callbackNonceDigest: string;
  }): Promise<void>;
  claimTicketAttempt(input: {
    readonly provider: PaymentProvider;
    readonly providerOrderId: string;
    readonly callbackNonceDigest: string;
    readonly claimToken: string;
  }): Promise<TicketPaymentAttemptClaim>;
  finalizeTicketAttempt(input: TicketPaymentFinalization): Promise<ConfirmOutcome>;
  claimTicketRefund(input: {
    readonly requestId: string;
    readonly userId: string;
    readonly claimToken: string;
  }): Promise<TicketRefundClaim>;
  finalizeTicketRefund(input: TicketRefundFinalization): Promise<RefundOutcome>;
}

export interface TicketPaymentCheckout {
  prepare(input: {
    readonly userId: string;
    readonly ticketOrderId: string;
  }): Promise<PreparedCheckout>;
  confirm(input: {
    readonly providerOrderId: string;
    readonly callbackNonce: string;
    readonly providerPayload: unknown;
  }): Promise<ConfirmOutcome>;
  refund(input: {
    readonly requestId: string;
    readonly userId: string;
    readonly reason: string;
  }): Promise<RefundOutcome>;
}

interface TicketPaymentCheckoutDependencies {
  readonly provider: PaymentProvider;
  readonly gateway: PaymentGateway;
  readonly repository: TicketPaymentAttemptRepository;
  readonly createClaimToken?: () => string;
}

function callbackNonceDigest(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function assertAttempt(attempt: PaymentAttempt, provider: PaymentProvider) {
  if (
    attempt.provider !== provider
    || attempt.purpose !== 'ticket'
    || attempt.currency !== 'KRW'
    || !Number.isSafeInteger(attempt.amount)
    || attempt.amount <= 0
  ) {
    throw new TicketPaymentContractError('invalid_attempt');
  }
}

function assertOutcome(outcome: ConfirmOutcome, attempt: PaymentAttempt) {
  if (
    outcome.attemptId !== attempt.id
    || outcome.provider !== attempt.provider
    || !(
      outcome.outcome === 'approved'
      || outcome.outcome === 'declined'
      || outcome.outcome === 'canceled'
      || outcome.outcome === 'unknown'
      || outcome.outcome === 'needs_review'
    )
  ) {
    throw new TicketPaymentContractError('invalid_terminal_outcome');
  }
}

function assertRefundOutcome(outcome: RefundOutcome, attempt: PaymentAttempt) {
  assertOutcome(outcome, attempt);
  if (
    outcome.outcome === 'approved'
    && outcome.refundedAmount !== attempt.amount
  ) {
    throw new TicketPaymentContractError('invalid_terminal_refund');
  }
}

function assertPreparedCheckout(
  prepared: PreparedCheckout,
  attempt: PaymentAttempt,
): void {
  const callbackNonce = prepared.callbackNonce;
  if (
    prepared.attemptId !== attempt.id
    || prepared.provider !== attempt.provider
    || prepared.expiresAt !== attempt.expiresAt
    || typeof callbackNonce !== 'string'
    || callbackNonce.length < 16
    || callbackNonce.length > 512
  ) {
    throw new TicketPaymentContractError('invalid_prepared_checkout');
  }
}

function identityMismatchOutcome(
  attempt: PaymentAttempt,
  evidence?: PaymentProviderEvidence,
): ConfirmOutcome {
  return {
    attemptId: attempt.id,
    provider: attempt.provider,
    outcome: 'needs_review',
    reasonCode: 'provider_identity_mismatch',
    ...(evidence ? { evidence } : {}),
  };
}

function refundNeedsReview(
  attempt: PaymentAttempt,
  reasonCode: string,
  evidence?: PaymentProviderEvidence,
): RefundOutcome {
  return {
    attemptId: attempt.id,
    provider: attempt.provider,
    outcome: 'needs_review',
    reasonCode,
    ...(evidence ? { evidence } : {}),
  };
}

/**
 * Deep module for paid ticket checkout and refund. The repository keeps
 * ownership, capacity, cancellation fencing, QR issuance, and idempotency in
 * one database transaction; callers only handle provider-neutral outcomes.
 */
export function createTicketPaymentCheckout({
  provider,
  gateway,
  repository,
  createClaimToken = randomUUID,
}: TicketPaymentCheckoutDependencies): TicketPaymentCheckout {
  return {
    async prepare({ userId, ticketOrderId }) {
      const attempt = await repository.prepareTicketAttempt({
        userId,
        ticketOrderId,
        provider,
      });
      assertAttempt(attempt, provider);

      const prepared = await gateway.prepare(attempt);
      assertPreparedCheckout(prepared, attempt);
      await repository.bindCallbackNonce({
        attemptId: attempt.id,
        callbackNonceDigest: callbackNonceDigest(prepared.callbackNonce),
      });
      return prepared;
    },

    async confirm({ providerOrderId, callbackNonce, providerPayload }) {
      if (
        typeof providerOrderId !== 'string'
        || providerOrderId.length < 1
        || providerOrderId.length > 200
        || typeof callbackNonce !== 'string'
        || callbackNonce.length < 16
        || callbackNonce.length > 512
      ) {
        throw new TicketPaymentContractError('invalid_callback');
      }

      const claim = await repository.claimTicketAttempt({
        provider,
        providerOrderId,
        callbackNonceDigest: callbackNonceDigest(callbackNonce),
        claimToken: createClaimToken(),
      });
      assertAttempt(claim.attempt, provider);

      if (claim.status === 'terminal') {
        assertOutcome(claim.outcome, claim.attempt);
        return claim.outcome;
      }
      if (claim.status === 'in_progress') {
        throw new TicketPaymentConfirmationInProgressError();
      }

      let providerOutcome: ConfirmOutcome;
      try {
        providerOutcome = await gateway.confirm({
          attempt: claim.attempt,
          idempotencyKey: `confirm:${claim.attempt.id}`,
          providerOrderId,
          callbackNonce,
          providerPayload,
        });
      } catch {
        providerOutcome = {
          attemptId: claim.attempt.id,
          provider: claim.attempt.provider,
          outcome: 'unknown',
          reasonCode: 'provider_unavailable',
        };
      }

      const outcome = (
        providerOutcome.attemptId === claim.attempt.id
        && providerOutcome.provider === claim.attempt.provider
      )
        ? providerOutcome
        : identityMismatchOutcome(claim.attempt, providerOutcome.evidence);

      return repository.finalizeTicketAttempt({
        attemptId: claim.attempt.id,
        claimToken: claim.claimToken,
        outcome,
      });
    },

    async refund({ requestId, userId, reason }) {
      if (
        typeof reason !== 'string'
        || reason.length < 1
        || reason.length > 200
        || reason.trim() !== reason
      ) {
        throw new TicketPaymentContractError('invalid_refund_reason');
      }

      const claim = await repository.claimTicketRefund({
        requestId,
        userId,
        claimToken: createClaimToken(),
      });
      if (claim.status === 'legacy') {
        throw new TicketPaymentContractError('legacy_payment');
      }
      assertAttempt(claim.attempt, provider);
      if (claim.status === 'terminal') {
        assertRefundOutcome(claim.outcome, claim.attempt);
        return claim.outcome;
      }
      if (claim.status === 'in_progress') throw new TicketRefundInProgressError();

      let providerOutcome: RefundOutcome;
      try {
        providerOutcome = await gateway.refund({
          attempt: claim.attempt,
          idempotencyKey: `refund:${requestId}:${claim.attempt.id}`,
          amount: claim.attempt.amount,
          reason,
        });
      } catch {
        providerOutcome = refundNeedsReview(claim.attempt, 'provider_unavailable');
      }

      let outcome: RefundOutcome;
      if (
        providerOutcome.attemptId !== claim.attempt.id
        || providerOutcome.provider !== claim.attempt.provider
      ) {
        outcome = refundNeedsReview(
          claim.attempt,
          'provider_identity_mismatch',
          providerOutcome.evidence,
        );
      } else if (
        providerOutcome.outcome === 'approved'
        && providerOutcome.refundedAmount !== claim.attempt.amount
      ) {
        outcome = refundNeedsReview(
          claim.attempt,
          'refund_amount_mismatch',
          providerOutcome.evidence,
        );
      } else if (providerOutcome.outcome !== 'approved') {
        outcome = refundNeedsReview(
          claim.attempt,
          `refund_${providerOutcome.outcome}`,
          providerOutcome.evidence,
        );
      } else {
        outcome = providerOutcome;
      }

      return repository.finalizeTicketRefund({
        requestId,
        attemptId: claim.attempt.id,
        claimToken: claim.claimToken,
        outcome,
      });
    },
  };
}
