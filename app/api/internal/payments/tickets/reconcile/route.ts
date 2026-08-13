import { timingSafeEqual } from 'node:crypto';
import {
  TicketPaymentContractError,
  TicketPaymentReconciliationInProgressError,
  TicketRefundInProgressError,
} from '@/lib/payments/ticket-checkout';
import { ticketCheckoutPaymentsEnabled } from '@/lib/payments/ticket-checkout-availability';
import { createRuntimeTicketPaymentCheckout } from '@/lib/payments/ticket-checkout.runtime.server';

function authorized(request: Request) {
  const secret = process.env.PAYMENT_RECONCILIATION_SECRET;
  const authorization = request.headers.get('authorization');
  if (!secret || !authorization?.startsWith('Bearer ')) return false;

  const expected = Buffer.from(secret);
  const actual = Buffer.from(authorization.slice('Bearer '.length));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const OPAQUE_AUDIT_REF = /^[A-Za-z0-9_-]{16,128}$/;

function response(body: Record<string, unknown>, status: number) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

/** Explicit, separately authorized recovery for one reviewed ticket case. */
export async function POST(request: Request) {
  if (!authorized(request)) return response({ error: 'unauthorized' }, 401);
  if (!ticketCheckoutPaymentsEnabled()) return response({ error: 'payment_unavailable' }, 503);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return response({ error: 'invalid_request' }, 400);
  }
  const input = typeof body === 'object' && body !== null && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const operation = input.operation;
  const reference = operation === 'payment' ? input.attemptId : input.requestId;
  const caseRef = input.caseRef;
  if (
    (operation !== 'payment' && operation !== 'refund')
    || typeof reference !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(reference)
    || typeof caseRef !== 'string'
    || !OPAQUE_AUDIT_REF.test(caseRef)
  ) return response({ error: 'invalid_request' }, 400);

  try {
    const checkout = createRuntimeTicketPaymentCheckout();
    const outcome = operation === 'payment'
      ? await checkout.reconcilePayment({ attemptId: reference, caseRef })
      : await checkout.reconcileRefund({ requestId: reference, caseRef });
    return response(
      { attemptId: outcome.attemptId, outcome: outcome.outcome },
      outcome.outcome === 'unknown' || outcome.outcome === 'needs_review' ? 202 : 200,
    );
  } catch (error) {
    if (
      error instanceof TicketPaymentReconciliationInProgressError
      || error instanceof TicketRefundInProgressError
    ) {
      return response({ outcome: 'unknown' }, 202);
    }
    if (error instanceof TicketPaymentContractError) {
      return response({ error: 'invalid_request' }, 400);
    }
    return response({ error: 'reconciliation_failed' }, 502);
  }
}
