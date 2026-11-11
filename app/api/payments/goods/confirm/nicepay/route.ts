import {
  GoodsPaymentConfirmationInProgressError,
  GoodsPaymentContractError,
  type GoodsPaymentCheckout,
} from '@/lib/payments/goods-checkout';
import { goodsPaymentConfirmationAvailable } from '@/lib/payments/goods-checkout-availability';
import { createRuntimeGoodsPaymentCheckout } from '@/lib/payments/goods-checkout.runtime.server';
import {
  NicepayCallbackInvalidError,
  NicepayCallbackTooLargeError,
  nicepayCallbackRedirect,
  parseNicepayCallback,
} from '@/lib/payments/nicepay-callback.server';
import { orderCompleteHref } from '@/lib/routes';

/**
 * 라우트 실행 예산(초). 최악 경로는 TID 기록 + 승인 POST 25초 시한 + 망취소 10초 + DB
 * claim/finalize다(lib/payments/nicepay-gateway.server.ts). 60초는 모든 Vercel 플랜에서
 * 유효한 값이고, 예산을 넘겨 함수가 죽어도 attempt는 confirming(claim 리스 10분)으로 남아
 * 재정합이 TID 기록으로 닫는다.
 */
export const maxDuration = 60;

interface NicepayGoodsPaymentConfirmHandlerDependencies {
  readonly confirmationAvailable: () => boolean;
  readonly createCheckout: () => GoodsPaymentCheckout;
}

/* 승인되면 그 주문의 완료 화면으로 보낸다(D12). 주문은 쿼리가 아니라 결제 시도 원장에서 나온다. */
function redirectForOutcome(outcome: string, orderId?: string) {
  if (outcome === 'approved') return orderId ? orderCompleteHref(orderId) : '/orders?payment=approved';
  if (outcome === 'unknown' || outcome === 'needs_review') return '/orders?payment=checking';
  return '/orders?payment=failed';
}

/**
 * 나이스페이 웹표준 인증 응답 수신부(모바일 ReturnURL·PC 결제 폼 submit). 세션과 무관하게
 * 받는다 — 확정의 진실원은 이 요청이 아니라 서버 승인 API 응답(서명 대조)과 DB 멱등
 * finalizer다. 사용자 브라우저 POST라 실패도 JSON이 아니라 결과 화면으로 돌려보낸다.
 */
export function createNicepayGoodsPaymentConfirmHandler({
  confirmationAvailable,
  createCheckout,
}: NicepayGoodsPaymentConfirmHandlerDependencies) {
  return async function handleNicepayGoodsPaymentConfirm(request: Request) {
    if (!confirmationAvailable()) {
      // 자격 증명이 닫힌 상태로 도착한 콜백 — 승인 API를 부르지 않았으므로 돈은 움직이지
      // 않았다. 추측 종결하지 않고 확인 화면으로 보내며 attempt는 만료 경로가 닫는다.
      return nicepayCallbackRedirect('/orders?payment=checking');
    }

    let callback;
    try {
      callback = await parseNicepayCallback(request);
    } catch (error) {
      if (error instanceof NicepayCallbackTooLargeError || error instanceof NicepayCallbackInvalidError) {
        return nicepayCallbackRedirect('/orders?payment=failed');
      }
      throw error;
    }

    try {
      const outcome = await createCheckout().confirm(callback);
      return nicepayCallbackRedirect(redirectForOutcome(outcome.outcome, outcome.orderId));
    } catch (error) {
      if (error instanceof GoodsPaymentConfirmationInProgressError) {
        return nicepayCallbackRedirect('/orders?payment=checking');
      }
      if (error instanceof GoodsPaymentContractError) {
        return nicepayCallbackRedirect('/orders?payment=failed');
      }
      return nicepayCallbackRedirect('/orders?payment=checking');
    }
  };
}

export const POST = createNicepayGoodsPaymentConfirmHandler({
  // 콜백 drain은 자격 증명 기준이다 — rollout gate가 닫혀도 진행 중 결제는 끝까지 처리한다.
  confirmationAvailable: () => goodsPaymentConfirmationAvailable('nicepay'),
  createCheckout: () => createRuntimeGoodsPaymentCheckout('nicepay'),
});
