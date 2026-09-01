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
