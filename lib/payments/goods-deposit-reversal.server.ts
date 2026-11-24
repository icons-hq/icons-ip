import 'server-only';

import { PARTIAL_CANCEL_UNAVAILABLE_REASON, type PaymentAttempt, type PaymentBalanceInspection, type RefundOutcome } from './gateway';

/*
 * 가상계좌 입금 오류 되돌림 자동 처리(ADR-0049 결정 4).
 *
 * 일부 은행은 입금 통보(DONE) 뒤 취소 통보를 보내 결제가 WAITING_FOR_DEPOSIT으로 돌아간다(가상계좌 총정리 "입금 통보(웹훅)",
 * 웹훅 이벤트 DEPOSIT_CALLBACK "구매자에게 다시 입금하도록 안내해야 합니다"). 원장은 그 사이 승인(approved)으로 닫혔다. 원장은 되돌리지
 * 않는다 — 출고 보류로 물건을 막고, 해결은 시스템이 끝까지 한다:
 *  1. 감지(checkDepositReversal): 웹훅이 원장 결제 키로 조회해 WAITING_FOR_DEPOSIT을 확인하면 DB가 보류·되돌림 기록·고객 앱 알림을
 *     남기고, 여기서 재입금 안내 메일을 보낸다. 결제사 직접 취소 감지(잔액 대조)는 되돌림을 잔액 그대로라 '이상 없음'으로 읽으므로 그보다
 *     먼저 이 판정을 한다.
 *  2. 처리(settleDepositReversal): 열린 되돌림을 원장 결제 키로 조회해 정한다 —
 *     - DONE(잔액 = 총액) → 재입금. 보류를 풀고 주문이 그대로 진행된다.
 *     - WAITING_FOR_DEPOSIT, 기한 + 30분 전 → 기다린다(다음 조회는 DB가 정한다). 취소 요청 경로(mode cancel)면 기다리지 않고 반납한다.
 *     - WAITING_FOR_DEPOSIT, 만료(expired) → 반납 없이 닫는다. 기한 + 30분이 지났으면 계좌를 반납(입금 전 취소, 멱등키
 *       release-va:{attemptId})하고 다시 조회해 CANCELED·만료일 때만 닫는다. 닫기는 DB가 '입금 없음' 증거를 남기고 기존 취소 확정으로
 *       주문을 취소한다(재고·쿠폰·적립금 복원, 환불 없음).
 *     - CANCELED(잔액 0): 반납된 것이다(우리 반납이거나 상점관리자 입금 전 취소). 환불 송금 흔적(refundStatus PENDING·COMPLETED·FAILED·
 *       PARTIAL_FAILED)이 있으면 돈이 들어왔다 나간 것이라 사람이 본다.
 *     - 조회 불가는 상태를 바꾸지 않는다(DB가 기한 + 2시간 뒤 확인 필요로 올린다). 불일치·그 밖의 상태는 확인 필요.
 * 판정 근거는 웹훅 본문이 아니라 원장 결제 키로 한 조회다(상점·키·주문·총액 대조는 게이트웨이 inspectBalance가 한다).
 */

export type GoodsDepositReversalVerdict = 'held' | 'already_recorded' | 'not_applicable';

export type DepositReversalSettlement =
  | 'redeposited'
  | 'waiting'
  | 'closed'
  | 'cancellation_pending'
  /** 결제사 취소에 환불 송금 흔적이 있다 — 돈이 들어왔다 나갔다. 확인 필요로 올렸고, 취소 요청은 보통의 환불 수렴으로 닫는다. */
  | 'refunded'
  | 'review'
  | 'unavailable'
  | 'not_applicable';

/** 열린(닫히지 않은) 되돌림 — DB `service_goods_deposit_reversal`·`service_claim_deposit_reversal_checks`의 모양. */
export interface OpenDepositReversal {
  readonly attemptId: string;
  readonly orderId: string;
  readonly paymentKey: string;
  readonly state: 'awaiting_redeposit' | 'review';
  readonly reviewCode: string | null;
  readonly dueAt: string;
  /** 결제사 조회가 반납·만료를 이미 확인했는지(그 뒤로는 돈이 들어올 수 없다). */
  readonly released: boolean;
}

export type DepositReversalCloseResult =
  | { readonly status: 'closed' | 'review' | 'not_applicable' }
  | {
    readonly status: 'cancellation_pending';
    readonly requestId: string;
    readonly requestStatus: 'processing' | 'needs_review';
    readonly claimType: 'cancel' | 'return';
  };

export type DepositReversalCheckOutcome = 'waiting' | 'unavailable' | 'mismatch' | 'provider_refunded';

export interface GoodsDepositReversalDependencies {
  loadAttempt(attemptId: string): Promise<PaymentAttempt | null>;
  loadPaymentKey(attemptId: string): Promise<string | undefined>;
  loadOpenReversal(attemptId: string): Promise<OpenDepositReversal | null>;
  inspect(attempt: PaymentAttempt, paymentKey: string): Promise<PaymentBalanceInspection>;
  /** 입금 전 취소로 계좌를 반납한다(멱등). 결과는 뒤따르는 조회가 판정한다. */
  release(attempt: PaymentAttempt, paymentKey: string): Promise<void>;
  flag(input: {
    readonly attemptId: string;
    readonly paymentKey: string;
    readonly transactionRef: string;
    readonly caseRef: string;
    readonly dueAt: string | null;
  }): Promise<string>;
  recordCheck(input: { readonly attemptId: string; readonly outcome: DepositReversalCheckOutcome; readonly dueAt: string | null }): Promise<string>;
  resolveRedeposited(input: { readonly attemptId: string; readonly paymentKey: string; readonly caseRef: string }): Promise<string>;
  close(input: {
    readonly attemptId: string;
    readonly paymentKey: string;
    readonly evidence: 'canceled' | 'expired';
    readonly caseRef: string;
  }): Promise<DepositReversalCloseResult>;
  /** 재입금 안내 메일(되돌림마다 한 통 — 발송 이력 dedupe). 절대 throw하지 않는다. */
  notifyReversal(orderId: string): Promise<unknown>;
  /** 자동 취소 안내 메일(주문당 한 통). 절대 throw하지 않는다. */
  notifyCanceled(orderId: string): Promise<unknown>;
  /**
   * 활성 취소 요청을 결제 없이 마저 닫는다(처리 중이면 그대로, 결제확인필요면 처리 중으로 되돌린 뒤 오케스트레이터를 시스템 actor로 부른다).
   * 반품은 부르지 않는다 — DB가 시스템 actor를 취소에만 허용하고, 운영자의 환불 단계가 같은 길로 닫는다.
   */
  continueCancellation(input: { readonly requestId: string; readonly requestStatus: 'processing' | 'needs_review' }): Promise<void>;
  now(): Date;
}

export class GoodsDepositReversalUnavailableError extends Error {
  constructor() {
    super('goods deposit reversal check unavailable');
    this.name = 'GoodsDepositReversalUnavailableError';
  }
}

/** 기한 + 30분 — 늦은 입금 통보 재전송을 기다리는 유예(입금 대기 만료와 같은 값, ADR-0049 결정 3). */
export const DEPOSIT_REVERSAL_GRACE_MS = 30 * 60 * 1000;

/** 결제사가 환불 송금을 시작했거나 끝낸 표지 — 이 값이 있는 CANCELED는 반납이 아니라 '들어왔다 나간 돈'이다. */
const REFUND_MOVEMENT_STATUSES = new Set(['PENDING', 'COMPLETED', 'FAILED', 'PARTIAL_FAILED']);

function closeEvidence(inspection: Extract<PaymentBalanceInspection, { kind: 'ok' }>): 'canceled' | 'expired' | 'refunded' | null {
  if (inspection.virtualAccount !== true) return null;
  if (inspection.status === 'WAITING_FOR_DEPOSIT' && inspection.virtualAccountExpired === true) return 'expired';
  if (inspection.status === 'CANCELED' && inspection.balanceAmount === 0) {
    return inspection.virtualAccountRefundStatus && REFUND_MOVEMENT_STATUSES.has(inspection.virtualAccountRefundStatus)
      ? 'refunded'
      : 'canceled';
  }
  return null;
}

export function createGoodsDepositReversal(dependencies: GoodsDepositReversalDependencies) {
  /** 웹훅이 WAITING_FOR_DEPOSIT을 알렸을 때 — 조회로 확인되면 보류·기록·안내. 조회하지 못하면 throw(호출자가 5xx로 재전송을 받는다). */
  async function checkDepositReversal(input: {
    readonly attemptId: string;
    readonly caseRef: string;
  }): Promise<GoodsDepositReversalVerdict> {
    const attempt = await dependencies.loadAttempt(input.attemptId);
    if (!attempt || attempt.provider !== 'toss' || attempt.purpose !== 'order') return 'not_applicable';
    const paymentKey = await dependencies.loadPaymentKey(input.attemptId);
    if (!paymentKey) return 'not_applicable';
    const inspection = await dependencies.inspect(attempt, paymentKey);
    // 조회하지 못했으면 판정을 미룬다(호출자가 5xx로 재전송을 받는다). 대조 실패·미지원은 되돌림이 아니다.
    if (inspection.kind === 'unavailable') throw new GoodsDepositReversalUnavailableError();
    if (inspection.kind !== 'ok') return 'not_applicable';
    if (inspection.status !== 'WAITING_FOR_DEPOSIT' || inspection.virtualAccount !== true) return 'not_applicable';
    const verdict = await dependencies.flag({
      attemptId: input.attemptId,
      paymentKey,
      // 같은 되돌림 관측은 한 번만 보류한다 — 결제의 마지막 거래 키가 관측 표지다(없으면 상태·잔액으로 대신한다).
      transactionRef: inspection.lastTransactionKey ?? `WAITING_FOR_DEPOSIT:${inspection.balanceAmount}`,
      caseRef: input.caseRef,
      dueAt: inspection.virtualAccountDueAt ?? null,
    });
    if (verdict !== 'held' && verdict !== 'already_recorded') return 'not_applicable';
    // 재입금 안내 메일 — 되돌림마다 한 통(dedupe). 재전송된 웹훅도 다시 불러 앞선 발송 실패를 메운다.
    await dependencies.notifyReversal(attempt.refId);
    return verdict;
  }

  async function finishClose(
    reversal: OpenDepositReversal,
    evidence: 'canceled' | 'expired',
    caseRef: string,
    mode: 'webhook' | 'sweep' | 'cancel',
  ): Promise<DepositReversalSettlement> {
    const result = await dependencies.close({ attemptId: reversal.attemptId, paymentKey: reversal.paymentKey, evidence, caseRef });
    if (result.status === 'closed') {
      await dependencies.notifyCanceled(reversal.orderId);
      return 'closed';
    }
    if (result.status === 'cancellation_pending') {
      // 취소 요청 경로(mode cancel)는 그 요청을 지금 처리하는 중이다 — 다시 부르지 않는다. 반품은 운영자가 닫는다.
      if (mode !== 'cancel' && result.claimType === 'cancel') {
        await dependencies.continueCancellation({ requestId: result.requestId, requestStatus: result.requestStatus });
      }
      return 'cancellation_pending';
    }
    return result.status;
  }

  async function recordCheck(
    reversal: OpenDepositReversal,
    outcome: DepositReversalCheckOutcome,
    dueAt: string | null,
    mode: 'webhook' | 'sweep' | 'cancel',
  ): Promise<DepositReversalSettlement> {
    // 웹훅은 다음 조회를 미루지 않는다 — 서명 없는 웹훅이 반복해서 와도 기한 뒤 반납(자동 재확인)이 밀리지 않게, 대기·조회 불가는 기록하지
    // 않는다(조회 불가는 호출자가 5xx로 재전송을 받는다).
    if (mode === 'webhook' && (outcome === 'waiting' || outcome === 'unavailable')) {
      return outcome === 'waiting' ? 'waiting' : 'unavailable';
    }
    const state = await dependencies.recordCheck({ attemptId: reversal.attemptId, outcome, dueAt });
    if (outcome === 'provider_refunded') return 'refunded';
    if (outcome === 'unavailable') return 'unavailable';
    if (state === 'review') return 'review';
    if (state === 'closed' || state === 'not_found') return 'not_applicable';
    return 'waiting';
  }

  /**
   * 열린 되돌림을 조회로 처리한다. mode: webhook(재입금·반납 웹훅) · sweep(자동 재확인) · cancel(취소 요청이 결제사 환불 전에 —
   * 기다리지 않고 반납한다). 조회·반납 확인이 실패하면 'unavailable'(상태는 DB가 정한 대로 남는다).
   */
  async function settleDepositReversal(input: {
    readonly attemptId: string;
    readonly caseRef: string;
    readonly mode: 'webhook' | 'sweep' | 'cancel';
    readonly reversal?: OpenDepositReversal;
    readonly attempt?: PaymentAttempt;
  }): Promise<DepositReversalSettlement> {
    const reversal = input.reversal ?? await dependencies.loadOpenReversal(input.attemptId);
    if (!reversal || reversal.attemptId !== input.attemptId) return 'not_applicable';
    const attempt = input.attempt ?? await dependencies.loadAttempt(input.attemptId);
    if (!attempt || attempt.id !== reversal.attemptId || attempt.provider !== 'toss' || attempt.purpose !== 'order') {
      return 'not_applicable';
    }

    const inspection = await dependencies.inspect(attempt, reversal.paymentKey);
    if (inspection.kind === 'unavailable') return recordCheck(reversal, 'unavailable', null, input.mode);
    if (inspection.kind !== 'ok' || inspection.virtualAccount !== true) return recordCheck(reversal, 'mismatch', null, input.mode);
    const dueAt = inspection.virtualAccountDueAt ?? null;

    if (inspection.status === 'DONE' && inspection.balanceAmount === attempt.amount) {
      const resolved = await dependencies.resolveRedeposited({
        attemptId: reversal.attemptId,
        paymentKey: reversal.paymentKey,
        caseRef: input.caseRef,
      });
      if (resolved === 'redeposited' || resolved === 'already_resolved') return 'redeposited';
      return resolved === 'conflict' ? 'review' : 'not_applicable';
    }

    const evidence = closeEvidence(inspection);
    if (evidence === 'refunded') return recordCheck(reversal, 'provider_refunded', dueAt, input.mode);
    if (evidence) return finishClose(reversal, evidence, input.caseRef, input.mode);

    if (inspection.status !== 'WAITING_FOR_DEPOSIT') return recordCheck(reversal, 'mismatch', dueAt, input.mode);

    // 입금 전이다. 반납을 이미 확인했는데 다시 입금 전으로 보이면 기록이 엇갈린 것이다.
    if (reversal.released) return recordCheck(reversal, 'mismatch', dueAt, input.mode);
    const due = Date.parse(dueAt ?? reversal.dueAt);
    const overdue = Number.isFinite(due) && due + DEPOSIT_REVERSAL_GRACE_MS <= dependencies.now().getTime();
    // 확인 필요(재입금만 자동으로 잡는 건)는 시스템이 반납하지 않는다 — 조회 불가로 올라간 건만 자동 처리로 돌아온다.
    const releasable = reversal.state === 'awaiting_redeposit' || reversal.reviewCode === 'lookup_failed';
    // 웹훅은 반납하지 않는다(응답 10초 안에 조회 두 번과 반납을 다 하지 못한다) — 기한이 지났으면 다음 조회를 곧바로 잡아 cron이 반납한다.
    const mayRelease = input.mode === 'cancel' || (input.mode === 'sweep' && overdue && releasable);
    if (!mayRelease) return recordCheck(reversal, 'waiting', dueAt, input.mode);

    await dependencies.release(attempt, reversal.paymentKey);
    const after = await dependencies.inspect(attempt, reversal.paymentKey);
    if (after.kind === 'unavailable') return recordCheck(reversal, 'unavailable', null, input.mode);
    if (after.kind !== 'ok' || after.virtualAccount !== true) return recordCheck(reversal, 'mismatch', null, input.mode);
    if (after.status === 'DONE' && after.balanceAmount === attempt.amount) {
      // 반납 직전에 다시 입금됐다 — 입금 뒤 취소는 환불 계좌가 필요해 반납이 거절된다. 재입금으로 닫는다.
      const resolved = await dependencies.resolveRedeposited({
        attemptId: reversal.attemptId,
        paymentKey: reversal.paymentKey,
        caseRef: input.caseRef,
      });
      if (resolved === 'redeposited' || resolved === 'already_resolved') return 'redeposited';
      return resolved === 'conflict' ? 'review' : 'not_applicable';
    }
    const afterEvidence = closeEvidence(after);
    if (afterEvidence === 'refunded') return recordCheck(reversal, 'provider_refunded', after.virtualAccountDueAt ?? null, input.mode);
    if (afterEvidence) return finishClose(reversal, afterEvidence, input.caseRef, input.mode);
    // 반납을 확인하지 못했다(아직 입금 전) — 같은 멱등키로 다음 회차에 다시 반납한다.
    if (after.status === 'WAITING_FOR_DEPOSIT') return recordCheck(reversal, 'unavailable', null, input.mode);
    return recordCheck(reversal, 'mismatch', after.virtualAccountDueAt ?? null, input.mode);
  }

  return { checkDepositReversal, settleDepositReversal };
}

/** service RPC가 돌려준 열린 되돌림을 좁힌다. 모양이 어긋나면 null — 호출자가 처리하지 않는다. */
export function parseOpenDepositReversal(value: unknown): OpenDepositReversal | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    typeof row.attemptId !== 'string'
    || typeof row.orderId !== 'string'
    || typeof row.paymentKey !== 'string'
    || !/^[\x21-\x7e]{1,200}$/.test(row.paymentKey)
    || (row.state !== 'awaiting_redeposit' && row.state !== 'review')
    || (row.reviewCode !== null && row.reviewCode !== undefined && typeof row.reviewCode !== 'string')
    || typeof row.dueAt !== 'string'
    || !Number.isFinite(Date.parse(row.dueAt))
    || typeof row.released !== 'boolean'
  ) {
    return null;
  }
  return {
    attemptId: row.attemptId,
    orderId: row.orderId,
    paymentKey: row.paymentKey,
    state: row.state,
    reviewCode: typeof row.reviewCode === 'string' ? row.reviewCode : null,
    dueAt: row.dueAt,
    released: row.released,
  };
}

/** `service_close_deposit_reversal` 응답을 좁힌다. 모양이 어긋나면 throw — 호출자가 다음 회차에 다시 본다. */
export function parseDepositReversalCloseResult(value: unknown): DepositReversalCloseResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid deposit reversal close result');
  const row = value as Record<string, unknown>;
  if (row.status === 'closed' || row.status === 'review' || row.status === 'not_applicable') return { status: row.status };
  if (
    row.status === 'cancellation_pending'
    && typeof row.requestId === 'string'
    && (row.requestStatus === 'processing' || row.requestStatus === 'needs_review')
    && (row.claimType === 'cancel' || row.claimType === 'return')
  ) {
    return { status: 'cancellation_pending', requestId: row.requestId, requestStatus: row.requestStatus, claimType: row.claimType };
  }
  throw new Error('invalid deposit reversal close result');
}

/**
 * 취소·반품 요청의 결제사 환불 단계에서 열린 되돌림을 먼저 처리한 결과(mode cancel)를 환불 결과로 옮긴다(ADR-0049 결정 4).
 *  - null: 보통의 환불로 간다 — 다시 입금됐거나(입금 뒤 환불), 결제사 취소에 환불 흔적이 있다(이미 돌려준 결제 → 조회가 전액 취소로 수렴).
 *  - approved(환불액 = 결제 금액): DB가 잠금 아래에서 반납·만료 증거를 남겼다(방금 한 결제사 조회가 근거). 결제사를 다시 부르지 않는다 —
 *    만료된 계좌는 반납 호출 없이 입금 전 상태로 남아 환불 조회가 '입금 전'으로 멈추기 때문이다. 취소 확정이 증거를 읽어 환불 행 없이
 *    닫는다. 부분 환불(반품배송비 차감)을 물으면 돈이 움직이지 않는 '부분 취소 불가'로 돌려 오케스트레이터가 전액으로 돌린다.
 *  - needs_review·unknown(provider_deposit_reversed): 반납을 아직 확인하지 못했다 — 자동 재확인이 이어서 닫는다.
 */
export function depositReversalRefundOutcome(
  settlement: DepositReversalSettlement,
  input: { readonly attempt: PaymentAttempt; readonly paymentKey: string; readonly amount: number; readonly partial: boolean },
): RefundOutcome | null {
  if (settlement === 'redeposited' || settlement === 'refunded') return null;
  const evidence = { providerPaymentKey: input.paymentKey, paymentMethod: '가상계좌' };
  if (settlement === 'closed' || settlement === 'cancellation_pending') {
    if (input.partial) {
      return { attemptId: input.attempt.id, provider: 'toss', outcome: 'declined', reasonCode: PARTIAL_CANCEL_UNAVAILABLE_REASON, evidence };
    }
    return {
      attemptId: input.attempt.id,
      provider: 'toss',
      outcome: 'approved',
      reasonCode: 'provider_virtual_account_released',
      evidence: { ...evidence, resultCode: 'CANCELED_virtual_account_released' },
      refundedAmount: input.amount,
    };
  }
  return {
    attemptId: input.attempt.id,
    provider: 'toss',
    outcome: settlement === 'unavailable' ? 'unknown' : 'needs_review',
    reasonCode: 'provider_deposit_reversed',
    evidence,
  };
}

