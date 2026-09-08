import 'server-only';
import type {
  ConfirmOutcome,
  PaymentAttempt,
  PaymentOutcome,
  PaymentProvider,
  PaymentProviderEvidence,
} from './gateway';
import { PAYMENT_OUTCOMES } from './gateway';
import type {
  GoodsPaymentAttemptClaim,
  GoodsPaymentAttemptRepository,
  GoodsPaymentFinalization,
} from './goods-checkout';

interface RpcResult {
  readonly data: unknown;
  readonly error: { readonly message: string } | null;
}

interface RpcClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<RpcResult>;
}

interface AttemptRow {
  readonly id: string;
  readonly provider: PaymentProvider;
  readonly purpose: 'order';
  readonly ref_id: string;
  readonly amount: number;
  readonly currency: string;
  readonly idempotency_key: string;
  readonly provider_order_id: string;
  readonly provider_product_code: string;
  readonly expires_at: string;
}

interface ClaimRow {
  readonly claim_status: 'claimed' | 'in_progress' | 'terminal';
  readonly attempt: AttemptRow;
  readonly outcome?: PaymentOutcome;
}

const paymentOutcomeSet = new Set<PaymentOutcome>(PAYMENT_OUTCOMES);

export class GoodsPaymentRepositoryError extends Error {
  constructor() {
    super('goods_payment_repository_failed');
    this.name = 'GoodsPaymentRepositoryError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseAttempt(value: unknown): PaymentAttempt {
  if (!isRecord(value)) throw new GoodsPaymentRepositoryError();
  const row = value as unknown as AttemptRow;
  if (
    typeof row.id !== 'string'
    || (row.provider !== 'toss' && row.provider !== 'korpay')
    || row.purpose !== 'order'
    || typeof row.ref_id !== 'string'
    || !Number.isSafeInteger(row.amount)
    || row.amount <= 0
    || typeof row.currency !== 'string'
    || typeof row.idempotency_key !== 'string'
    || typeof row.provider_order_id !== 'string'
    || typeof row.provider_product_code !== 'string'
    || typeof row.expires_at !== 'string'
  ) throw new GoodsPaymentRepositoryError();

  return {
    id: row.id,
    provider: row.provider,
    purpose: row.purpose,
    refId: row.ref_id,
    amount: row.amount,
    currency: row.currency,
    idempotencyKey: row.idempotency_key,
    providerOrderId: row.provider_order_id,
    providerProductCode: row.provider_product_code,
    expiresAt: row.expires_at,
  };
}

function parseClaim(value: unknown): GoodsPaymentAttemptClaim {
  if (!isRecord(value)) throw new GoodsPaymentRepositoryError();
  const row = value as unknown as ClaimRow;
  const attempt = parseAttempt(row.attempt);
  if (row.claim_status === 'claimed') {
    return { status: 'claimed', attempt, claimToken: '' };
  }
  if (row.claim_status === 'in_progress') return { status: 'in_progress', attempt };
  if (
    row.claim_status === 'terminal'
    && typeof row.outcome === 'string'
    && paymentOutcomeSet.has(row.outcome)
  ) {
    return {
      status: 'terminal',
      attempt,
      outcome: {
        attemptId: attempt.id,
        provider: attempt.provider,
        outcome: row.outcome,
      },
    };
  }
  throw new GoodsPaymentRepositoryError();
}

async function rpc(client: RpcClient, name: string, args: Record<string, unknown>) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw new GoodsPaymentRepositoryError();
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

export function createGoodsPaymentAttemptRepository(client: RpcClient): GoodsPaymentAttemptRepository {
  return {
    async prepareOrderAttempt({ userId, orderId, provider }) {
      return parseAttempt(await rpc(client, 'prepare_goods_payment_attempt', {
        p_user_id: userId,
        p_order_id: orderId,
        p_provider: provider,
      }));
    },

    async bindCallbackNonce({ attemptId, callbackNonceDigest }) {
      await rpc(client, 'bind_goods_payment_callback_nonce', {
        p_attempt_id: attemptId,
        p_callback_nonce_digest: callbackNonceDigest,
      });
    },

    async claimOrderAttempt({
      provider,
      providerOrderId,
      callbackNonceDigest,
      claimToken,
    }) {
      const claim = parseClaim(await rpc(client, 'claim_goods_payment_attempt', {
        p_provider: provider,
        p_provider_order_id: providerOrderId,
        p_callback_nonce_digest: callbackNonceDigest,
        p_claim_token: claimToken,
      }));
      return claim.status === 'claimed'
        ? { ...claim, claimToken }
        : claim;
    },

    async finalizeOrderAttempt(input: GoodsPaymentFinalization): Promise<ConfirmOutcome> {
      const finalized = await rpc(client, 'finalize_goods_payment_attempt', {
        p_attempt_id: input.attemptId,
        p_claim_token: input.claimToken,
        p_outcome: input.outcome.outcome,
        ...evidenceArgs(input.outcome.evidence),
      });
      if (typeof finalized !== 'string' || !paymentOutcomeSet.has(finalized as PaymentOutcome)) {
        throw new GoodsPaymentRepositoryError();
      }
      if (finalized === input.outcome.outcome) return input.outcome;
      return {
        ...input.outcome,
        outcome: finalized as PaymentOutcome,
        reasonCode: 'database_finalization_guard',
      };
    },

    async claimOrderReconciliation({ attemptId, claimToken, caseRef }) {
      const claim = parseClaim(await rpc(client, 'claim_goods_payment_reconciliation', {
        p_attempt_id: attemptId,
        p_claim_token: claimToken,
        p_case_ref: caseRef,
      }));
      return claim.status === 'claimed'
        ? { ...claim, claimToken }
        : claim;
    },

    async finalizeOrderReconciliation(input: GoodsPaymentFinalization): Promise<ConfirmOutcome> {
      const finalized = await rpc(client, 'finalize_goods_payment_reconciliation', {
        p_attempt_id: input.attemptId,
        p_claim_token: input.claimToken,
        p_outcome: input.outcome.outcome,
        ...evidenceArgs(input.outcome.evidence),
      });
      if (typeof finalized !== 'string' || !paymentOutcomeSet.has(finalized as PaymentOutcome)) {
        throw new GoodsPaymentRepositoryError();
      }
      if (finalized === input.outcome.outcome) return input.outcome;
      return {
        ...input.outcome,
        outcome: finalized as PaymentOutcome,
        reasonCode: 'database_finalization_guard',
      };
    },
  };
}
