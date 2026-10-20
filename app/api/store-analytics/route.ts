import { acceptStoreAnalytics, declineStoreAnalytics, recordStoreAnalytics, storeAnalyticsState } from '@/lib/store-analytics.server';
import { parseAnalyticsEvent } from '@/lib/store-analytics';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });

export async function GET() {
  try { return json(await storeAnalyticsState()); }
  catch { return json({ enabled: false, choice: 'unset', usable: false }, 503); }
}

async function boundedBody(request: Request): Promise<unknown> {
  if (!request.body || Number(request.headers.get('content-length') || 0) > 4096) throw new Error('size');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 4096) { await reader.cancel(); throw new Error('size'); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return json({ ok: false }, 403);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ ok: false }, 415);
  let body: Record<string, unknown>;
  try {
    const value = await boundedBody(request);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return json({ ok: false }, 400);
    body = value as Record<string, unknown>;
  } catch { return json({ ok: false }, 400); }
  try {
    if (Object.keys(body).length === 1 && body.action === 'accept') { const result = await acceptStoreAnalytics(); return json(result, result.status); }
    if (Object.keys(body).length === 1 && body.action === 'decline') { const result = await declineStoreAnalytics(); return json(result, result.status); }
    const event = Object.keys(body).length === 2 && body.action === 'record' ? parseAnalyticsEvent(body.event) : null;
    if (!event) return json({ ok: false }, 400);
    const result = await recordStoreAnalytics(event); return json(result, result.status);
  } catch { return json({ ok: false, code: 'unavailable' }, 503); }
}
