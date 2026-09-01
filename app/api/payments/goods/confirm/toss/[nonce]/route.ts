import {
  GoodsPaymentConfirmationInProgressError,
  GoodsPaymentContractError,
  type GoodsPaymentCheckout,
} from '@/lib/payments/goods-checkout';
import { goodsPaymentConfirmationAvailable } from '@/lib/payments/goods-checkout-availability';
import { createRuntimeGoodsPaymentCheckout } from '@/lib/payments/goods-checkout.runtime.server';
import {
  TossCallbackInvalidError,
  parseTossSuccessCallback,
  tossCallbackRedirect,
} from '@/lib/payments/toss-callback.server';

interface TossGoodsPaymentConfirmHandlerDependencies {
  readonly confirmationAvailable: () => boolean;
  readonly createCheckout: () => GoodsPaymentCheckout;
}

function redirectForOutcome(outcome: string) {
  if (outcome === 'approved') return '/orders?payment=approved';
  if (outcome === 'unknown' || outcome === 'needs_review') return '/orders?payment=checking';
  return '/orders?payment=failed';
}

/**
 * 토스 주문서형 v2 successUrl 수신부. 사용자 브라우저의 GET 리다이렉트라
 * 실패도 JSON이 아니라 결과 화면으로 돌려보낸다 — 확정의 진실원은 이 요청이
 * 아니라 서버 confirm(금액 대조 후 승인 API)과 DB 멱등 finalizer다.
 */
export function createTossGoodsPaymentConfirmHandler({
  confirmationAvailable,
  createCheckout,
}: TossGoodsPaymentConfirmHandlerDependencies) {
  return async function handleTossGoodsPaymentConfirm(
    request: Request,
    context: { params: Promise<{ nonce: string }> },
  ) {
    if (!confirmationAvailable()) {
      // 자격 증명이 닫힌 상태로 도착한 콜백 — 추측 종결하지 않고 확인 화면으로.
      // attempt는 TTL·reconcile 경로(#390)가 정합화한다.
      return tossCallbackRedirect('/orders?payment=checking');
    }

    const { nonce } = await context.params;
    let callback;
    try {
      callback = parseTossSuccessCallback(new URL(request.url), nonce);
    } catch (error) {
      if (error instanceof TossCallbackInvalidError) {
        return tossCallbackRedirect('/orders?payment=failed');
      }
      throw error;
    }

    try {
      const outcome = await createCheckout().confirm(callback);
      return tossCallbackRedirect(redirectForOutcome(outcome.outcome));
    } catch (error) {
      if (error instanceof GoodsPaymentConfirmationInProgressError) {
        return tossCallbackRedirect('/orders?payment=checking');
      }
      if (error instanceof GoodsPaymentContractError) {
        return tossCallbackRedirect('/orders?payment=failed');
      }
      return tossCallbackRedirect('/orders?payment=checking');
    }
  };
}

export const GET = createTossGoodsPaymentConfirmHandler({
  confirmationAvailable: () => goodsPaymentConfirmationAvailable('toss'),
  createCheckout: () => createRuntimeGoodsPaymentCheckout('toss'),
});
