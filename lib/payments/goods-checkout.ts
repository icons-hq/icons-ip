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

/**
 * 결제 콜백 확정 결과. `orderId`는 이 결과가 가리키는 굿즈 주문이다(시도 원장의 ref_id). 콜백
 * 라우트가 승인 뒤 그 주문의 완료 화면으로 보낼 때 쓴다(D12). 쿼리가 아니라 원장에서 나온다.
 */
export type GoodsConfirmOutcome = ConfirmOutcome & { readonly orderId?: string };

export interface GoodsPaymentCheckout {
  prepare(input: { readonly userId: string; readonly orderId: string }): Promise<PreparedCheckout>;
  confirm(input: {
    readonly providerOrderId: string;
    readonly callbackNonce: string;
    readonly providerPayload: unknown;
  }): Promise<GoodsConfirmOutcome>;
  reconcilePayment(input: {
    readonly attemptId: string;
    readonly caseRef: string;
    /** 웹훅 본문의 미검증 paymentKey — 게이트웨이 조회 힌트로만 넘긴다. */
    readonly providerPaymentKeyHint?: string;
    /** 입금 대기 가상계좌를 반납하고 닫으라는 요청(구매자 입금 전 취소, ADR-0049). 입금이 먼저 들어왔으면 승인된다. */
    readonly releaseVirtualAccount?: boolean;
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
  /**
   * 입금 대기 확정 알림 seam(입금 안내 메일, ADR-0049). DB가 awaiting_deposit을 확정했을 때만 불린다. 멱등이어야 하고
   * throw는 삼켜진다(onApproved와 같은 계약).
   */
  readonly onAwaitingDeposit?: (attempt: PaymentAttempt) => Promise<unknown>;
  /**
   * 이 배포의 결제사 키 모드('test' | 'live'). 없거나 null이면 남기지 않는다(로컬·preview — 게이트웨이가 운영 배포에만 있다).
   * 값이 있으면 prepare가 체크아웃을 돌려주기 전에 `recordKeyMode`로 시도에 남긴다. 운영에 테스트 키가 물린 기간에 승인된
   * 결제는 DB가 그 기록으로 출고 보류한다(돈이 실제로 결제되지 않았다). 기록에 실패하면 prepare가 실패한다 — 결제창을 열기
   * 전이라 돈은 움직이지 않고, 기록 없이 승인돼 출고되는 것보다 낫다.
   */
  readonly providerKeyMode?: () => 'test' | 'live' | null;
  readonly recordKeyMode?: (input: { readonly attemptId: string; readonly keyMode: 'test' | 'live' }) => Promise<void>;
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
  onAwaitingDeposit,
  providerKeyMode,
  recordKeyMode,
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

  /**
   * 결제사가 가상계좌를 발급했는데(awaiting_deposit) DB가 입금 대기를 거부했으면(취소 요청·계정 상한·기한 범위 밖 등) 발급된
   * 계좌가 열린 채 남지 않게 같은 요청에서 반납한다(ADR-0049). 시도는 needs_review로 남고, 반납 결과는 뒤따르는 웹훅·재정합이
   * 조회로 닫는다. 입금 대기가 확정됐으면 입금 안내 알림을 보낸다.
   */
  async function afterFinalize(attempt: PaymentAttempt, provided: ConfirmOutcome, finalized: ConfirmOutcome) {
    if (finalized.outcome === 'approved') {
      await notifyApproved(attempt);
      return;
    }
    if (finalized.outcome === 'awaiting_deposit') {
      if (!onAwaitingDeposit) return;
      try {
        await onAwaitingDeposit(attempt);
      } catch {
        console.error('[payments/goods] awaiting deposit notification failed');
      }
      return;
    }
    const paymentKey = provided.evidence?.providerPaymentKey;
    if (provided.outcome === 'awaiting_deposit' && paymentKey && gateway.releaseVirtualAccount) {
      try {
        await gateway.releaseVirtualAccount(attempt, paymentKey);
      } catch {
        console.error('[payments/goods] refused virtual account release failed');
      }
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
      const keyMode = providerKeyMode?.() ?? null;
      if (keyMode) {
        if (!recordKeyMode) throw new GoodsPaymentContractError('key_mode_recorder_missing');
        await recordKeyMode({ attemptId: attempt.id, keyMode });
      }
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
        return { ...claim.outcome, orderId: claim.attempt.refId };
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
      await afterFinalize(claim.attempt, outcome, finalized);
      return { ...finalized, orderId: claim.attempt.refId };
    },

    async reconcilePayment({ attemptId, caseRef, providerPaymentKeyHint, releaseVirtualAccount }) {
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
        // 힌트는 조회 대상을 좁힐 뿐 확정 근거가 아니다 — 판정은 게이트웨이 조회가 한다.
        const hint = {
          ...(typeof providerPaymentKeyHint === 'string' && providerPaymentKeyHint
            ? { providerPaymentKey: providerPaymentKeyHint } : {}),
          ...(releaseVirtualAccount === true ? { releaseVirtualAccount: true } : {}),
        };
        providerOutcome = Object.keys(hint).length > 0
          ? await gateway.reconcile(claim.attempt, hint)
          : await gateway.reconcile(claim.attempt);
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
      await afterFinalize(claim.attempt, outcome, finalized);
      return finalized;
    },
  };
}
