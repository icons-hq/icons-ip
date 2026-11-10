import { NextResponse } from 'next/server';
import { isSameOriginRequest } from '@/lib/http/same-origin.server';
import { readBoundedRawBody, RawBodyTooLargeError } from '@/lib/http/bounded-raw-body.server';
import { viewBankRefundAccount } from '@/lib/admin/bank-transfer-refund-account.server';
import { bankRefundError } from '@/lib/admin/bank-transfer-refund';

const PRIVATE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  Vary: 'Cookie',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};
const reply = (body: unknown, status: number) => NextResponse.json(body, { status, headers: PRIVATE_HEADERS });

// Read-only methods must never return account data or create an access receipt.
export function GET() { return new NextResponse(null, { status: 405, headers: { ...PRIVATE_HEADERS, Allow: 'POST' } }); }
export const HEAD = GET;

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return reply(bankRefundError('42501'), 403);
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return reply(bankRefundError('22023', 'invalid_bank_refund_operation'), 415);
  let input: unknown;
  try { input = JSON.parse(await readBoundedRawBody(request, 2048)); } catch (error) { return reply(bankRefundError('22023', 'invalid_bank_refund_operation'), error instanceof RawBodyTooLargeError ? 413 : 400); }
  try {
    const result = await viewBankRefundAccount(input);
    return reply(result, 'account' in result ? 200 : result.authChanged ? 403 : result.conflict ? 409 : result.uncertain ? 503 : 400);
  } catch {
    // Login redirects and unexpected failures never redirect this data endpoint
    // into an HTML response, log raw values, or omit the no-store header.
    return reply(bankRefundError('42501'), 403);
  }
}
