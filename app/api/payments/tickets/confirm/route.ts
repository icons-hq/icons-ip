import {
  TicketPaymentConfirmationInProgressError,
  TicketPaymentContractError,
} from '@/lib/payments/ticket-checkout';
import { ticketPaymentProviderAvailable } from '@/lib/payments/ticket-checkout-availability';
import { createRuntimeTicketPaymentCheckout } from '@/lib/payments/ticket-checkout.runtime.server';
import {
  KorpayCallbackTooLargeError,
  korpayRedirect,
  parseKorpayCallback,
} from '@/lib/payments/korpay-callback.server';

function redirectForOutcome(outcome: string) {
  if (outcome === 'approved') return '/tickets?payment=approved';
  if (outcome === 'unknown' || outcome === 'needs_review') return '/tickets?payment=checking';
  return '/tickets?payment=failed';
}

/** Session-independent, bounded Korpay form callback ingress. */
export async function POST(request: Request) {
  if (!ticketPaymentProviderAvailable()) {
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
    const outcome = await createRuntimeTicketPaymentCheckout().confirm(callback);
    return korpayRedirect(redirectForOutcome(outcome.outcome));
  } catch (error) {
    if (error instanceof TicketPaymentConfirmationInProgressError) {
      return korpayRedirect('/tickets?payment=checking');
    }
    if (error instanceof TicketPaymentContractError) {
      return korpayRedirect('/tickets?payment=failed');
    }
    return Response.json({ error: 'payment_confirmation_failed' }, { status: 502 });
  }
}
