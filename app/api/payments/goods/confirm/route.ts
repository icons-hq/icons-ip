import {
  GoodsPaymentConfirmationInProgressError,
  GoodsPaymentContractError,
  type GoodsPaymentCheckout,
} from '@/lib/payments/goods-checkout';
import { goodsPaymentConfirmationAvailable } from '@/lib/payments/goods-checkout-availability';
import { createRuntimeGoodsPaymentCheckout } from '@/lib/payments/goods-checkout.runtime.server';
import {
  KorpayCallbackTooLargeError,
  korpayRedirect,
  parseKorpayCallback,
} from '@/lib/payments/korpay-callback.server';

interface GoodsPaymentConfirmHandlerDependencies {
  readonly confirmationAvailable: () => boolean;
  readonly createCheckout: () => GoodsPaymentCheckout;
}

function redirectForOutcome(outcome: string) {
  if (outcome === 'approved') return '/orders?payment=approved';
  if (outcome === 'unknown' || outcome === 'needs_review') return '/orders?payment=checking';
  return '/orders?payment=failed';
}

/** Session-independent, bounded Korpay form callback ingress. */
export function createGoodsPaymentConfirmHandler({
  confirmationAvailable,
  createCheckout,
}: GoodsPaymentConfirmHandlerDependencies) {
  return async function handleGoodsPaymentConfirm(request: Request) {
    if (!confirmationAvailable()) {
      return Response.json({ error: 'payment_unavailable' }, { status: 503 });
    }

    let callback;
    try {
      callback = await parseKorpayCallback(request);
    } catch (error) {
      return Response.json(
        { error: 'invalid_callback' },
        { status: error instanceof KorpayCallbackTooLargeError ? 413 : 400 },
      );
    }

    try {
      const outcome = await createCheckout().confirm(callback);
      return korpayRedirect(redirectForOutcome(outcome.outcome));
    } catch (error) {
      if (error instanceof GoodsPaymentConfirmationInProgressError) {
        return korpayRedirect('/orders?payment=checking');
      }
      if (error instanceof GoodsPaymentContractError) {
        return korpayRedirect('/orders?payment=failed');
      }
      return korpayRedirect('/orders?payment=checking');
    }
  };
}

export const POST = createGoodsPaymentConfirmHandler({
  // korpay 콜백 drain은 korpay 자격 증명 기준이다 — 기본 provider가 toss로
  // 재전환(#384)돼도 진행 중이던 korpay 결제의 종결 경로는 닫히지 않는다.
  confirmationAvailable: () => goodsPaymentConfirmationAvailable('korpay'),
  createCheckout: () => createRuntimeGoodsPaymentCheckout('korpay'),
});
