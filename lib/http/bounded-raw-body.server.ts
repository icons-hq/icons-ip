import 'server-only';

// The Auth Hook parser consumes under 5 KiB of bounded scalar fields and the
// Resend lifecycle projection under 1 KiB. 64 KiB leaves more than 10x
// contract headroom while bounding work before the expensive signature check.
export const SIGNED_WEBHOOK_BODY_LIMIT_BYTES = 64 * 1024;

export class RawBodyTooLargeError extends Error {
  constructor() {
    super('raw_body_too_large');
    this.name = 'RawBodyTooLargeError';
  }
}

function declaredBodyLength(headers: Headers): number | null {
  const value = headers.get('content-length');
  if (!value || !/^\d+$/.test(value)) return null;
  const length = Number(value);
  return Number.isSafeInteger(length) ? length : Number.POSITIVE_INFINITY;
}

export async function readBoundedRawBody(
  request: Request,
  limitBytes = SIGNED_WEBHOOK_BODY_LIMIT_BYTES,
): Promise<string> {
  if (!Number.isSafeInteger(limitBytes) || limitBytes < 1) {
    throw new Error('invalid_raw_body_limit');
  }
  const declaredLength = declaredBodyLength(request.headers);
  if (declaredLength !== null && declaredLength > limitBytes) {
    throw new RawBodyTooLargeError();
  }
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > limitBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RawBodyTooLargeError();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
}
