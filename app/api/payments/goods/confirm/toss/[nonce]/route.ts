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

/**
 * 라우트 실행 예산(초). 최악 경로는 두 갈래다 — 토스 승인 POST가 25초 시한까지 가면
 * 409는 오지 않고 곧장 orderId 조회 8초로 가므로 ≤33초 + DB claim/finalize이고, 409(멱등
 * 처리 중)는 처리 중인 중복 요청에 대한 즉시 응답이라 그 경로는 (즉시 409) + 대기 1초 +
 * 같은 키 재요청 ≤25초 + 조회 8초 ≈ 34초 + DB다. Next.js 16은 route 세그먼트의 named export
 * `maxDuration`을 빌드 출력에 싣고 배포 플랫폼이 그 값을 읽는다. Vercel Functions
 * duration 문서(2026-08-24판, fluid compute 기본): Hobby 기본·최대 300초, Pro 기본
 * 300초·최대 800초 — 60초는 모든 플랜에서 유효한 값이고 두 경로 모두에 DB·리다이렉트
 * 여유를 남기며, 명시하는 이유는 플랫폼 기본값 의존을 끊고 예산을 코드에 적어 두기
 * 위해서다. 예산을 넘겨 함수가 죽어도 attempt는 confirming(claim 리스 10분)으로 남아
 * 웹훅 재전송·내부 reconcile이 회수한다.
 */
export const maxDuration = 60;

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
