import 'server-only';

import { scheduleApprovedOrderCancellation } from '@/lib/orders/cancellation-auto.server';
import { GoodsPaymentContractError, GoodsPaymentReconciliationInProgressError } from './goods-checkout';
import { goodsPaymentConfirmationAvailable } from './goods-checkout-availability';
import { createRuntimeGoodsPaymentCheckout } from './goods-checkout.runtime.server';
import { loadGoodsPaymentKeyHint } from './goods-payment-key-hint.server';
import type { PaymentOutcome } from './gateway';
import { TicketPaymentContractError, TicketPaymentReconciliationInProgressError } from './ticket-checkout';
import { ticketPaymentProviderAvailable } from './ticket-checkout-availability';
import { createRuntimeTicketPaymentCheckout } from './ticket-checkout.runtime.server';

/*
 * 미종결 결제 시도 한 건을 결제사 조회 API로 다시 확인한다(원장 PAY-067·PAY-063).
 *
 * 운영 화면의 '결제 상태 다시 확인'(서버 액션)과 10분 주기 자동 재확인 cron이 같은 길을 쓴다. 확정은 기존 재정합 seam
 * (`reconcilePayment` → claim RPC 리스·DB 멱등 finalizer)이 하고 이 모듈은 고르기만 한다 — 내부 HTTP 라우트·비밀값을 거치지 않는다.
 * 조회 API가 있는 시도만 다룬다: 굿즈(purpose order) 토스·나이스페이, 티켓 토스. 코페이(조회 API 없음, 수동 복구 seam)·무통장
 * (입금 확인 화면)·그 밖은 `unsupported`다. 결제사 설정(env)이 없는 배포면 `unavailable`이다.
 * 굿즈 승인으로 닫히면 내부 재정합 라우트·웹훅과 같이, 그 사이 접수돼 자동 승인된 취소의 결제사 전액 취소를 응답 뒤에 발행한다.
 */

export interface PaymentAttemptReference {
  readonly attemptId: string;
  readonly purpose: string;
  readonly provider: string;
  readonly refId: string | null;
}

export type PaymentAttemptReconciliation =
  | { readonly kind: 'reconciled'; readonly outcome: PaymentOutcome }
  | { readonly kind: 'in_progress' }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'failed' };

export type PaymentAttemptRoute = 'goods' | 'ticket' | null;

/** 조회 API로 다시 확인할 수 있는 시도인가(DB 목록의 reconcilable과 같은 규칙). */
export function paymentAttemptRoute(attempt: Pick<PaymentAttemptReference, 'purpose' | 'provider'>): PaymentAttemptRoute {
  if (attempt.purpose === 'order' && (attempt.provider === 'toss' || attempt.provider === 'nicepay')) return 'goods';
  if (attempt.purpose === 'ticket' && attempt.provider === 'toss') return 'ticket';
  return null;
}

/**
 * 이 배포에서 결제사 조회로 다시 확인할 수 있는 결제사(설정된 게이트웨이). 자동 재확인 후보를 이 목록으로만 받아, 설정이 없는
 * 결제사의 시도가 매 회차 뽑혀 큐를 막지 않게 한다. 티켓은 토스뿐이고 토스 설정은 굿즈·티켓이 같다.
 */
export function reconcilablePaymentProviders(): ('toss' | 'nicepay')[] {
  return (['toss', 'nicepay'] as const).filter(provider =>
    goodsPaymentConfirmationAvailable(provider) || (provider === 'toss' && ticketPaymentProviderAvailable('toss')));
}

const CASE_REF = /^[A-Za-z0-9_-]{16,128}$/;

export async function reconcilePaymentAttempt(
  attempt: PaymentAttemptReference,
  caseRef: string,
): Promise<PaymentAttemptReconciliation> {
  const route = paymentAttemptRoute(attempt);
  if (!route) return { kind: 'unsupported' };
  if (!CASE_REF.test(caseRef)) return { kind: 'failed' };
  try {
    if (route === 'goods') {
      const provider = attempt.provider as 'toss' | 'nicepay';
      if (!goodsPaymentConfirmationAvailable(provider)) return { kind: 'unavailable' };
      // 토스는 저장된 결제 키를 조회 힌트로 쓴다(입금 대기 가상계좌의 입금·만료 확인 — 본문에 키가 없는 경로).
      const providerPaymentKeyHint = provider === 'toss' ? await loadGoodsPaymentKeyHint(attempt.attemptId) : undefined;
      const outcome = await createRuntimeGoodsPaymentCheckout(provider).reconcilePayment({
        attemptId: attempt.attemptId,
        caseRef,
        ...(providerPaymentKeyHint ? { providerPaymentKeyHint } : {}),
      });
      if (outcome.outcome === 'approved' && attempt.refId) {
        try {
          scheduleApprovedOrderCancellation(attempt.refId);
        } catch {
          console.error('[payments/attempt-reconciliation] order cancellation scheduling failed', { attemptId: attempt.attemptId });
        }
      }
      return { kind: 'reconciled', outcome: outcome.outcome };
    }
    if (!ticketPaymentProviderAvailable('toss')) return { kind: 'unavailable' };
    const outcome = await createRuntimeTicketPaymentCheckout('toss').reconcilePayment({ attemptId: attempt.attemptId, caseRef });
    return { kind: 'reconciled', outcome: outcome.outcome };
  } catch (error) {
    if (error instanceof GoodsPaymentReconciliationInProgressError || error instanceof TicketPaymentReconciliationInProgressError) {
      return { kind: 'in_progress' };
    }
    if (!(error instanceof GoodsPaymentContractError) && !(error instanceof TicketPaymentContractError)) {
      console.error('[payments/attempt-reconciliation] reconcile failed', {
        attemptId: attempt.attemptId, route, error: error instanceof Error ? error.name : 'unknown',
      });
    }
    return { kind: 'failed' };
  }
}
