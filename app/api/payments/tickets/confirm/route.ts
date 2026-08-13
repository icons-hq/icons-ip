import {
  TicketPaymentConfirmationInProgressError,
  TicketPaymentContractError,
} from '@/lib/payments/ticket-checkout';
import { ticketCheckoutPaymentsEnabled } from '@/lib/payments/ticket-checkout-availability';
import { createRuntimeTicketPaymentCheckout } from '@/lib/payments/ticket-checkout.runtime.server';

const MAX_CALLBACK_BYTES = 64 * 1024;

class CallbackTooLargeError extends Error {}

async function readCallbackJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CALLBACK_BYTES) {
    throw new CallbackTooLargeError();
  }
  if (!request.body) throw new SyntaxError('missing callback body');

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalLength += value.byteLength;
    if (totalLength > MAX_CALLBACK_BYTES) {
      await reader.cancel();
      throw new CallbackTooLargeError();
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
}

function outcomeResponse(outcome: string, attemptId: string, status: number) {
  return Response.json({ attemptId, outcome }, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

/**
 * Session-independent provider-neutral ingress. #207 wraps this contract in
 * the Korpay form callback and explicit 303 result redirect.
 */
export async function POST(request: Request) {
  if (!ticketCheckoutPaymentsEnabled()) {
    return Response.json({ error: 'payment_unavailable' }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await readCallbackJson(request);
  } catch (error) {
    return Response.json(
      { error: 'invalid_callback' },
      { status: error instanceof CallbackTooLargeError ? 413 : 400 },
    );
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return Response.json({ error: 'invalid_callback' }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  try {
    const outcome = await createRuntimeTicketPaymentCheckout().confirm({
      providerOrderId: input.providerOrderId as string,
      callbackNonce: input.callbackNonce as string,
      providerPayload: input.providerPayload,
    });
    return outcomeResponse(
      outcome.outcome,
      outcome.attemptId,
      outcome.outcome === 'unknown' || outcome.outcome === 'needs_review' ? 202 : 200,
    );
  } catch (error) {
    if (error instanceof TicketPaymentConfirmationInProgressError) {
      return Response.json({ outcome: 'unknown' }, {
        status: 202,
        headers: { 'cache-control': 'no-store' },
      });
    }
    if (error instanceof TicketPaymentContractError) {
      return Response.json({ error: 'invalid_callback' }, { status: 400 });
    }
    return Response.json({ error: 'payment_confirmation_failed' }, { status: 502 });
  }
}
