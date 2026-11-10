import 'server-only';

import { NextResponse } from 'next/server';
import { isSameOriginRequest } from '@/lib/http/same-origin.server';
import { RawBodyTooLargeError, readBoundedRawBody } from '@/lib/http/bounded-raw-body.server';
import { parseClaimContactContract, claimContactError as claimContactErrorResponse, claimContactErrorStatus } from './contracts';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Vary: 'Cookie',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
export function unsupportedClaimContactMethod(): Response {
  return new NextResponse(null, { status: 405, headers: { ...PRIVATE_HEADERS, Allow: 'POST' } });
}

export function createClaimContactPostHandler(handler: (input: unknown) => Promise<unknown>, options: { bodyLimitBytes?: number } = {}) {
  return async function POST(request: Request): Promise<Response> {
    if (!isSameOriginRequest(request)) return reply(claimContactErrorResponse('auth_changed'), 403);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return reply(claimContactErrorResponse('invalid_claim_contact_request'), 415);
    }
    let input: unknown;
    try { input = JSON.parse(await readBoundedRawBody(request, options.bodyLimitBytes ?? 16_384)); }
    catch (error) { return reply(claimContactErrorResponse('invalid_claim_contact_request'), error instanceof RawBodyTooLargeError ? 413 : 400); }
    try {
      const result = await handler(input);
      if (!result || typeof result !== 'object') return reply(claimContactErrorResponse('claim_contact_outcome_unknown'), 503);
      if ('code' in result) {
        const error = parseClaimContactContract('ErrorResponse', result);
        return error ? reply(error, claimContactErrorStatus(error.code)) : reply(claimContactErrorResponse('claim_contact_outcome_unknown'), 503);
      }
      return reply(result, 200);
    } catch {
      // Never expose redirect exceptions, database diagnostics or plaintext.
      return reply(claimContactErrorResponse('claim_contact_outcome_unknown'), 503);
    }
  };
}
