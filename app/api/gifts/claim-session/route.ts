import { NextResponse } from 'next/server';
import { beginGiftClaimSession } from '@/lib/gifts.server';
import { GIFT_CLAIM_COOKIE } from '@/lib/gifts';
import { readBoundedRawBody, RawBodyTooLargeError } from '@/lib/http/bounded-raw-body.server';

const headers = { 'cache-control': 'no-store, max-age=0', 'referrer-policy': 'no-referrer' };
function sameOrigin(request: Request): boolean {
  try {
    const url = new URL(request.url), host = request.headers.get('host');
    // Next dev normalizes Request.url to localhost. Host is the browser's
    // destination; a cross-origin browser script cannot replace that header.
    if (host && /[\\/@?#,\s]/.test(host)) return false;
    const expected = host ? new URL(`${url.protocol}//${host}`).origin : url.origin;
    return request.headers.get('origin') === expected && request.headers.get('sec-fetch-site') !== 'cross-site';
  } catch { return false; }
}
export async function POST(request: Request) {
  if (!sameOrigin(request) || request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403, headers });
  }
  let value: unknown;
  try { value = JSON.parse(await readBoundedRawBody(request, 1024)); }
  catch (error) { return NextResponse.json({ error: 'invalid_request' }, { status: error instanceof RawBodyTooLargeError ? 413 : 400, headers }); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 1 || !('token' in value) || typeof value.token !== 'string') {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400, headers });
  }
  try {
    const session = await beginGiftClaimSession(value.token);
    if (!session) return NextResponse.json({ error: 'invitation_unavailable' }, { status: 404, headers });
    const response = NextResponse.json({ ok: true }, { headers });
    response.cookies.set(GIFT_CLAIM_COOKIE, session.secret, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', expires: new Date(session.expiresAt) });
    return response;
  } catch { return NextResponse.json({ error: 'temporarily_unavailable' }, { status: 503, headers }); }
}
