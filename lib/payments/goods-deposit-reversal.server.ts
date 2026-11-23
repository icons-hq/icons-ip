import 'server-only';

import type { PaymentAttempt, PaymentBalanceInspection } from './gateway';

/*
 * 가상계좌 입금 오류 되돌림 감지(ADR-0049).
 *
 * 일부 은행은 입금 통보(DONE) 뒤 취소 통보를 보내 결제가 WAITING_FOR_DEPOSIT으로 되돌아간다(가상계좌 총정리 "입금 통보(웹훅)").
 * 우리 원장은 그 사이 승인(approved)으로 닫혔을 수 있다. 원장은 웹훅으로 되돌리지 않는다 — 대신 결제사 조회로 되돌림을 확인하면
 * 주문을 출고 보류(사유 deposit_reversed)해 발주확인·출고에서 빼고 운영 할 일에 띄운다. 결제사 직접 취소 감지(잔액 대조)는
 * 되돌림을 잔액 그대로라 '이상 없음'으로 읽으므로 그보다 먼저 이 판정을 한다.
 *
 * 판정 근거는 본문이 아니라 원장 결제 키로 한 조회다(상점·키·주문·총액 대조는 게이트웨이 inspectBalance가 한다).
 */

export type GoodsDepositReversalVerdict = 'held' | 'already_recorded' | 'not_applicable';

export interface GoodsDepositReversalDependencies {
  loadAttempt(attemptId: string): Promise<PaymentAttempt | null>;
  loadPaymentKey(attemptId: string): Promise<string | undefined>;
  inspect(attempt: PaymentAttempt, paymentKey: string): Promise<PaymentBalanceInspection>;
  flag(input: {
    readonly attemptId: string;
    readonly paymentKey: string;
    readonly transactionRef: string;
    readonly caseRef: string;
  }): Promise<string>;
}

export class GoodsDepositReversalUnavailableError extends Error {
  constructor() {
    super('goods deposit reversal check unavailable');
    this.name = 'GoodsDepositReversalUnavailableError';
  }
}

export function createGoodsDepositReversalCheck(dependencies: GoodsDepositReversalDependencies) {
  return async function checkDepositReversal(input: {
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
    });
    return verdict === 'held' || verdict === 'already_recorded' ? verdict : 'not_applicable';
  };
}
