import { memberActivityState, recordMemberActivity, updateMemberActivityChoice } from '@/lib/member-activity.server';
import { parseMemberActivityEvent, parseMemberActivityIdentity } from '@/lib/member-activity';
import { transactionExactKeys, transactionRecord } from '@/lib/goods-transaction-values';
import { isSameOriginRequest } from '@/lib/http/same-origin.server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
export async function GET() {
  try { return json({ state: await memberActivityState() }); }
  catch { return json({ state: null }, 503); }
}
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return json({ ok: false }, 403);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ ok: false }, 415);
  if (!request.body || Number(request.headers.get('content-length') || 0) > 4096) return json({ ok: false }, 413);
  let body: unknown; const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength; if (size > 4096) { await reader.cancel(); return json({ ok: false }, 413); } chunks.push(item.value); }
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return json({ ok: false }, 400); } finally { reader.releaseLock(); }
  if (!transactionRecord(body)) return json({ ok: false }, 400);
  const identity = parseMemberActivityIdentity(body.identity);
  if (!identity) return json({ ok: false }, 400);
  try {
    if (transactionExactKeys(body, ['action', 'identity']) && ['accept', 'decline'].includes(String(body.action))) {
      const result = await updateMemberActivityChoice(body.action === 'accept' ? 'accepted' : 'declined', identity); return json(result, result.status);
    }
    const event = body.action === 'record' && transactionExactKeys(body, ['action', 'identity', 'event']) ? parseMemberActivityEvent(body.event) : null;
    if (!event) return json({ ok: false }, 400);
    const result = await recordMemberActivity(event, identity); return json(result, result.status);
  } catch { return json({ ok: false }, 503); }
}
