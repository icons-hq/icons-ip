import 'server-only';
import { NextResponse } from 'next/server';
import { isUuid } from '../uuid';
import { subscriptionSiteOrigin } from './runtime.server';

export const SUBSCRIPTION_RESPONSE_HEADERS = { 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' };
export const subscriptionJson = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: SUBSCRIPTION_RESPONSE_HEADERS });
export function subscriptionRequestOriginMatches(request: Request): boolean {
  const canonical = subscriptionSiteOrigin(); if (!canonical) return false;
  try {
    const expected = new URL(canonical), host = request.headers.get('host');
    return host ? host === expected.host && new URL(request.url).protocol === expected.protocol : new URL(request.url).origin === canonical;
  } catch { return false; }
}
export function subscriptionSameOrigin(request: Request): boolean {
  return subscriptionRequestOriginMatches(request) && request.headers.get('origin') === subscriptionSiteOrigin()
    && request.headers.get('sec-fetch-site') !== 'cross-site';
}
export async function subscriptionJsonBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return null;
  const declared = Number(request.headers.get('content-length') ?? 0); if (!Number.isFinite(declared) || declared > 8192) return null;
  if (!request.body) return null; const reader = request.body.getReader(); let text = '', bytes = 0; const decoder = new TextDecoder('utf-8', { fatal: true });
  try {
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.length; if (bytes > 8192) { await reader.cancel(); return null; } text += decoder.decode(chunk.value, { stream: true }); }
    text += decoder.decode(); return JSON.parse(text);
  } catch { return null; } finally { reader.releaseLock(); }
}
export function billingNonceCookie(id: string) { if (!isUuid(id)) throw new Error('invalid_registration'); return `icons_billing_${id}`; }
export function billingNonceCookieOptions(id: string) {
  if (!isUuid(id)) throw new Error('invalid_registration');
  return { httpOnly: true, secure: subscriptionSiteOrigin()?.startsWith('https:') ?? true, sameSite: 'lax' as const,
    path: `/api/subscriptions/billing/registration/${id}`, maxAge: 24 * 60 * 60 };
}
