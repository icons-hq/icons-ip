import { customerDemographicState, updateCustomerDemographicChoice } from '@/lib/customer-demographics.server';
import { isDemographicGender, parseDemographicIdentity } from '@/lib/customer-demographics';
import { transactionExactKeys, transactionRecord } from '@/lib/goods-transaction-values';
import { isSameOriginRequest } from '@/lib/http/same-origin.server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
export async function GET() {
  try { return json({ state: await customerDemographicState() }); }
  catch { return json({ state: null }, 503); }
}
export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return json({ ok: false }, 403);
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ ok: false }, 415);
  if (!request.body || Number(request.headers.get('content-length') || 0) > 2048) return json({ ok: false }, 413);
  const reader = request.body.getReader(); const chunks: Uint8Array[] = []; let size = 0; let body: unknown;
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      size += item.value.byteLength;
      if (size > 2048) { await reader.cancel(); return json({ ok: false }, 413); }
      chunks.push(item.value);
    }
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch { return json({ ok: false }, 400); } finally { reader.releaseLock(); }
  if (!transactionRecord(body) || !transactionExactKeys(body, ['choice', 'gender', 'identity', 'consent'])
    || !['accepted', 'declined'].includes(String(body.choice))
    || (body.choice === 'accepted' ? body.consent !== true || !isDemographicGender(body.gender) : body.gender !== null || body.consent !== false)) return json({ ok: false }, 400);
  const identity = parseDemographicIdentity(body.identity);
  if (!identity) return json({ ok: false }, 400);
  try {
    const result = await updateCustomerDemographicChoice(body.choice as 'accepted' | 'declined', body.gender as 'female' | 'male' | 'other' | null, identity);
    return json(result, result.status);
  } catch { return json({ ok: false }, 503); }
}
