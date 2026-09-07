import {
  TicketPaymentConfirmationInProgressError,
  TicketPaymentContractError,
  type TicketPaymentCheckout,
} from '@/lib/payments/ticket-checkout';
import { ticketPaymentProviderAvailable } from '@/lib/payments/ticket-checkout-availability';
import { createRuntimeTicketPaymentCheckout } from '@/lib/payments/ticket-checkout.runtime.server';
import {
  TossCallbackInvalidError,
  parseTossSuccessCallback,
  tossCallbackRedirect,
} from '@/lib/payments/toss-callback.server';

/**
 * 라우트 실행 예산(초). 토스 승인 POST 25초 + 409(멱등 처리 중) 같은 키 재요청 25초 +
 * orderId 조회 8초 + DB claim/finalize. Next.js 16은 route 세그먼트의 named export
 * `maxDuration`을 빌드 출력에 싣고 배포 플랫폼이 그 값을 읽는다. Vercel Functions
 * duration 문서(2026-08-24판, fluid compute 기본): Hobby 기본·최대 300초, Pro 기본
 * 300초·최대 800초 — 60초는 모든 플랜에서 유효한 값이고, 명시하는 이유는 플랫폼
 * 기본값 의존을 끊고 예산을 코드에 적어 두기 위해서다. 예산을 넘겨 함수가 죽어도
 * attempt는 confirming(claim 리스)으로 남아 웹훅 재전송·내부 reconcile이 회수한다.
 */
export const maxDuration = 60;

interface TossTicketPaymentConfirmHandlerDependencies {
  readonly confirmationAvailable: () => boolean;
  readonly createCheckout: () => Pick<TicketPaymentCheckout, 'confirm'>;
}

function redirectForOutcome(outcome: string) {
  if (outcome === 'approved') return '/tickets?payment=approved';
  if (outcome === 'unknown' || outcome === 'needs_review') return '/tickets?payment=checking';
  return '/tickets?payment=failed';
}

/**
 * 토스 주문서형 v2 successUrl 수신부(티켓). 사용자 브라우저의 GET 리다이렉트라
 * 실패도 JSON이 아니라 예매 목록으로 돌려보낸다 — 확정의 진실원은 이 요청이
 * 아니라 서버 confirm(금액 대조 후 승인 API)과 DB 멱등 finalizer다.
 */
export function createTossTicketPaymentConfirmHandler({
  confirmationAvailable,
  createCheckout,
}: TossTicketPaymentConfirmHandlerDependencies) {
  return async function handleTossTicketPaymentConfirm(
    request: Request,
    context: { params: Promise<{ nonce: string }> },
  ) {
    if (!confirmationAvailable()) {
      return tossCallbackRedirect('/tickets?payment=checking');
    }

    const { nonce } = await context.params;
    let callback;
    try {
      callback = parseTossSuccessCallback(new URL(request.url), nonce);
    } catch (error) {
      if (error instanceof TossCallbackInvalidError) {
        return tossCallbackRedirect('/tickets?payment=failed');
      }
      throw error;
    }

    try {
      const outcome = await createCheckout().confirm(callback);
      return tossCallbackRedirect(redirectForOutcome(outcome.outcome));
    } catch (error) {
      if (error instanceof TicketPaymentConfirmationInProgressError) {
        return tossCallbackRedirect('/tickets?payment=checking');
      }
      if (error instanceof TicketPaymentContractError) {
        return tossCallbackRedirect('/tickets?payment=failed');
      }
      return tossCallbackRedirect('/tickets?payment=checking');
    }
  };
}

export const GET = createTossTicketPaymentConfirmHandler({
  confirmationAvailable: () => ticketPaymentProviderAvailable('toss'),
  createCheckout: () => createRuntimeTicketPaymentCheckout('toss'),
});
