import { createHash, randomUUID } from 'node:crypto';
import type {
  ConfirmOutcome,
  PaymentAttempt,
  PaymentGateway,
  PaymentProvider,
  PaymentProviderEvidence,
  PreparedCheckout,
} from './gateway';

export class GoodsPaymentContractError extends Error {
  constructor(readonly code: string) {
    super(`Goods payment contract failed: ${code}`);
    this.name = 'GoodsPaymentContractError';
  }
}

export class GoodsPaymentConfirmationInProgressError extends Error {
  constructor() {
    super('Goods payment confirmation is already in progress');
    this.name = 'GoodsPaymentConfirmationInProgressError';
  }
}

export type GoodsPaymentAttemptClaim =
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

export interface GoodsPaymentFinalization {
  readonly attemptId: string;
  readonly claimToken: string;
  readonly outcome: ConfirmOutcome;
}

export interface GoodsPaymentAttemptRepository {
  prepareOrderAttempt(input: {
    readonly userId: string;
    readonly orderId: string;
    readonly provider: PaymentProvider;
  }): Promise<PaymentAttempt>;
  bindCallbackNonce(input: {
    readonly attemptId: string;
    readonly callbackNonceDigest: string;
  }): Promise<void>;
  claimOrderAttempt(input: {
    readonly provider: PaymentProvider;
    readonly providerOrderId: string;
    readonly callbackNonceDigest: string;
    readonly claimToken: string;
  }): Promise<GoodsPaymentAttemptClaim>;
  finalizeOrderAttempt(input: GoodsPaymentFinalization): Promise<ConfirmOutcome>;
}

export interface GoodsPaymentCheckout {
  prepare(input: { readonly userId: string; readonly orderId: string }): Promise<PreparedCheckout>;
  confirm(input: {
    readonly providerOrderId: string;
    readonly callbackNonce: string;
    readonly providerPayload: unknown;
  }): Promise<ConfirmOutcome>;
}

interface GoodsPaymentCheckoutDependencies {
  readonly provider: PaymentProvider;
  readonly gateway: PaymentGateway;
  readonly repository: GoodsPaymentAttemptRepository;
  readonly createClaimToken?: () => string;
}

function callbackNonceDigest(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function assertAttempt(attempt: PaymentAttempt, provider: PaymentProvider) {
  if (
    attempt.provider !== provider
    || attempt.purpose !== 'order'
    || attempt.currency !== 'KRW'
    || !Number.isSafeInteger(attempt.amount)
    || attempt.amount <= 0
  ) {
    throw new GoodsPaymentContractError('invalid_attempt');
  }
}

function assertPreparedCheckout(
  prepared: PreparedCheckout,
  attempt: PaymentAttempt,
): void {
  if (
    prepared.attemptId !== attempt.id
    || prepared.provider !== attempt.provider
    || prepared.expiresAt !== attempt.expiresAt
    || typeof prepared.callbackNonce !== 'string'
    || prepared.callbackNonce.length < 16
    || prepared.callbackNonce.length > 512
  ) {
    throw new GoodsPaymentContractError('invalid_prepared_checkout');
  }
}

function providerIdentityMismatchOutcome(
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

/**
 * Deep module for the goods payment lifecycle. Callers only prepare an order or
 * confirm an opaque provider return; ownership, amount, inventory reservation,
 * callback replay, and ledger transitions stay behind the repository adapter.
 */
export function createGoodsPaymentCheckout({
  provider,
  gateway,
  repository,
  createClaimToken = randomUUID,
}: GoodsPaymentCheckoutDependencies): GoodsPaymentCheckout {
  return {
    async prepare({ userId, orderId }) {
      const attempt = await repository.prepareOrderAttempt({ userId, orderId, provider });
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
        throw new GoodsPaymentContractError('invalid_callback');
      }

      const claim = await repository.claimOrderAttempt({
        provider,
        providerOrderId,
        callbackNonceDigest: callbackNonceDigest(callbackNonce),
        claimToken: createClaimToken(),
      });
      assertAttempt(claim.attempt, provider);

      if (claim.status === 'terminal') return claim.outcome;
      if (claim.status === 'in_progress') {
        throw new GoodsPaymentConfirmationInProgressError();
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
          reasonCode: 'provider_confirm_error',
        };
      }
      const outcome = (
        providerOutcome.attemptId === claim.attempt.id
        && providerOutcome.provider === claim.attempt.provider
      )
        ? providerOutcome
        : providerIdentityMismatchOutcome(claim.attempt, providerOutcome.evidence);

      return repository.finalizeOrderAttempt({
        attemptId: claim.attempt.id,
        claimToken: claim.claimToken,
        outcome,
      });
    },
  };
}
