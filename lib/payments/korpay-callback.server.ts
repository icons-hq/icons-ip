import 'server-only';

const MAX_CALLBACK_BYTES = 64 * 1024;
const CALLBACK_FIELDS = [
  'resultCode',
  'message',
  'paymentKey',
  'merchantId',
  'orderNumber',
  'amount',
  'reserved',
] as const;

export class KorpayCallbackTooLargeError extends Error {}
export class KorpayCallbackInvalidError extends Error {}

async function readBoundedBody(request: Request) {
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CALLBACK_BYTES) {
    throw new KorpayCallbackTooLargeError();
  }
  if (!request.body) throw new KorpayCallbackInvalidError();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_CALLBACK_BYTES) {
      await reader.cancel();
      throw new KorpayCallbackTooLargeError();
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    throw new KorpayCallbackInvalidError();
  }
}

function validText(value: string | null, maxLength: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Bounded parser that admits only fields published in Korpay guide v1.2.2. */
export async function parseKorpayCallback(request: Request) {
  const contentType = request.headers.get('content-type')?.toLowerCase() ?? '';
  if (contentType.split(';', 1)[0]?.trim() !== 'application/x-www-form-urlencoded') {
    throw new KorpayCallbackInvalidError();
  }
  const values = new URLSearchParams(await readBoundedBody(request));
  for (const field of CALLBACK_FIELDS) {
    if (values.getAll(field).length > 1) throw new KorpayCallbackInvalidError();
  }

  const resultCode = values.get('resultCode');
  const message = values.get('message');
  const paymentKey = values.get('paymentKey');
  const merchantId = values.get('merchantId');
  const orderNumber = values.get('orderNumber');
  const amount = values.get('amount');
  const reserved = values.get('reserved');
  if (
    !validText(resultCode, 8)
    || !/^[A-Za-z0-9]{3,8}$/.test(resultCode)
    || (message !== null && (
      message.length > 500 || /[\u0000-\u001f\u007f]/.test(message)
    ))
    || !validText(merchantId, 10)
    || !/^[A-Za-z0-9]{10}$/.test(merchantId)
    || !validText(orderNumber, 40)
    || !/^[OT][A-Za-z0-9]{1,39}$/.test(orderNumber)
    || !validText(amount, 12)
    || !/^[1-9][0-9]{0,11}$/.test(amount)
    || !validText(reserved, 512)
    || !/^[A-Za-z0-9_-]{16,255}$/.test(reserved)
    || (resultCode === '0000' && !validText(paymentKey, 200))
    || (paymentKey !== null && !validText(paymentKey, 200))
  ) {
    throw new KorpayCallbackInvalidError();
  }

  return {
    providerOrderId: orderNumber,
    callbackNonce: reserved,
    providerPayload: {
      resultCode,
      ...(message === null ? {} : { message }),
      ...(paymentKey === null ? {} : { paymentKey }),
      merchantId,
      orderNumber,
      amount,
      reserved,
    },
  };
}

export function korpayRedirect(location: string) {
  return new Response(null, {
    status: 303,
    headers: {
      location,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
    },
  });
}
