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

export class GoodsPaymentReconciliationInProgressError extends Error {
  constructor() {
    super('Goods payment reconciliation is already in progress');
    this.name = 'GoodsPaymentReconciliationInProgressError';
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
  /** 콜백 nonce 없이 모호 attempt를 재정합화하는 service 전용 seam(#390). */
  claimOrderReconciliation(input: {
    readonly attemptId: string;
    readonly claimToken: string;
    readonly caseRef: string;
  }): Promise<GoodsPaymentAttemptClaim>;
  finalizeOrderReconciliation(input: GoodsPaymentFinalization): Promise<ConfirmOutcome>;
}

export interface GoodsPaymentCheckout {
  prepare(input: { readonly userId: string; readonly orderId: string }): Promise<PreparedCheckout>;
  confirm(input: {
    readonly providerOrderId: string;
    readonly callbackNonce: string;
    readonly providerPayload: unknown;
  }): Promise<ConfirmOutcome>;
  reconcilePayment(input: {
    readonly attemptId: string;
    readonly caseRef: string;
  }): Promise<ConfirmOutcome>;
}

interface GoodsPaymentCheckoutDependencies {
  readonly provider: PaymentProvider;
  readonly gateway: PaymentGateway;
  readonly repository: GoodsPaymentAttemptRepository;
  readonly createClaimToken?: () => string;
  /**
   * 승인 종결 알림 seam(주문 확인 메일 등). DB finalizer가 approved를 확정했을 때와
   * approved terminal replay가 돌아왔을 때 불린다 — replay에도 부르는 이유는 최초
   * callback이 확정 후·알림 전에 죽었을 때 중복 callback이 유일한 재시도 경로라서다.
   * 그래서 hook은 멱등해야 하고(중복 호출에도 효과 1회), 실패해도 확정 결과를 바꾸면
   * 안 되므로 throw는 삼켜진다 — 실패 관측은 hook 구현의 책임이다.
   */
  readonly onApproved?: (attempt: PaymentAttempt) => Promise<unknown>;
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
  onApproved,
}: GoodsPaymentCheckoutDependencies): GoodsPaymentCheckout {
  async function notifyApproved(attempt: PaymentAttempt) {
    if (!onApproved) return;
    try {
      await onApproved(attempt);
    } catch {
      // 알림 실패가 이미 확정된 결제 결과를 checking/failed로 둔갑시키면 안 된다.
      console.error('[payments/goods] approved notification failed');
    }
  }

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

      if (claim.status === 'terminal') {
        if (claim.outcome.outcome === 'approved') await notifyApproved(claim.attempt);
        return claim.outcome;
      }
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

      // gateway가 아니라 DB finalizer의 판정을 알림 기준으로 삼는다 — finalization
      // guard가 approved를 needs_review로 뒤집으면 확정되지 않은 주문에 알리면 안 된다.
      const finalized = await repository.finalizeOrderAttempt({
        attemptId: claim.attempt.id,
        claimToken: claim.claimToken,
        outcome,
      });
      if (finalized.outcome === 'approved') await notifyApproved(claim.attempt);
      return finalized;
    },

    async reconcilePayment({ attemptId, caseRef }) {
      if (
        typeof attemptId !== 'string'
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptId)
        || typeof caseRef !== 'string'
        || !/^[A-Za-z0-9_-]{16,128}$/.test(caseRef)
      ) {
        throw new GoodsPaymentContractError('invalid_reconciliation');
      }

      const claim = await repository.claimOrderReconciliation({
        attemptId,
        claimToken: createClaimToken(),
        caseRef,
      });
      assertAttempt(claim.attempt, provider);

      if (claim.status === 'terminal') {
        // 재정합이 approved 종결을 재생할 때도 알림 훅을 태운다 — 최초 확정이
        // 알림 전에 죽었을 수 있고 훅은 멱등 계약이다(confirm replay와 동일).
        if (claim.outcome.outcome === 'approved') await notifyApproved(claim.attempt);
        return claim.outcome;
      }
      if (claim.status === 'in_progress') {
        throw new GoodsPaymentReconciliationInProgressError();
      }

      let providerOutcome: ConfirmOutcome;
      try {
        providerOutcome = await gateway.reconcile(claim.attempt);
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
        : providerIdentityMismatchOutcome(claim.attempt, providerOutcome.evidence);

      const finalized = await repository.finalizeOrderReconciliation({
        attemptId: claim.attempt.id,
        claimToken: claim.claimToken,
        outcome,
      });
      if (finalized.outcome === 'approved') await notifyApproved(claim.attempt);
      return finalized;
    },
  };
}
