import {
  GoodsPaymentConfirmationInProgressError,
  GoodsPaymentContractError,
  type GoodsPaymentCheckout,
} from '@/lib/payments/goods-checkout';
import { goodsPaymentConfirmationAvailable } from '@/lib/payments/goods-checkout-availability';
import { createRuntimeGoodsPaymentCheckout } from '@/lib/payments/goods-checkout.runtime.server';

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

function response(outcome: string, attemptId: string, status: number) {
  return Response.json({ attemptId, outcome }, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

/**
 * Provider-neutral callback ingress. It intentionally has no auth/session
 * dependency; the opaque provider order id and nonce are atomically claimed in
 * Postgres. #207 may wrap this contract in Korpay's form/303 adapter.
 */
interface GoodsPaymentConfirmHandlerDependencies {
  readonly confirmationAvailable: () => boolean;
  readonly createCheckout: () => GoodsPaymentCheckout;
}

export function createGoodsPaymentConfirmHandler({
  confirmationAvailable,
  createCheckout,
}: GoodsPaymentConfirmHandlerDependencies) {
  return async function handleGoodsPaymentConfirm(request: Request) {
    if (!confirmationAvailable()) {
      return Response.json({ error: 'payment_unavailable' }, { status: 503 });
    }

    let body: unknown;
    try {
      body = await readCallbackJson(request);
    } catch (error) {
      if (error instanceof CallbackTooLargeError) {
        return Response.json({ error: 'invalid_callback' }, { status: 413 });
      }
      return Response.json({ error: 'invalid_callback' }, { status: 400 });
    }

    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return Response.json({ error: 'invalid_callback' }, { status: 400 });
    }

    const input = body as Record<string, unknown>;
    try {
      const outcome = await createCheckout().confirm({
        providerOrderId: input.providerOrderId as string,
        callbackNonce: input.callbackNonce as string,
        providerPayload: input.providerPayload,
      });
      return response(
        outcome.outcome,
        outcome.attemptId,
        outcome.outcome === 'unknown' || outcome.outcome === 'needs_review' ? 202 : 200,
      );
    } catch (error) {
      if (error instanceof GoodsPaymentConfirmationInProgressError) {
        return Response.json({ outcome: 'unknown' }, {
          status: 202,
          headers: { 'cache-control': 'no-store' },
        });
      }
      if (error instanceof GoodsPaymentContractError) {
        return Response.json({ error: 'invalid_callback' }, { status: 400 });
      }
      return Response.json({ error: 'payment_confirmation_failed' }, { status: 502 });
    }
  };
}

export const POST = createGoodsPaymentConfirmHandler({
  confirmationAvailable: goodsPaymentConfirmationAvailable,
  createCheckout: createRuntimeGoodsPaymentCheckout,
});
