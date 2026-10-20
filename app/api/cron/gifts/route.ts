import { timingSafeEqual } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { isUuid } from '@/lib/uuid';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET, authorization = request.headers.get('authorization');
  if (!secret || !authorization?.startsWith('Bearer ')) return Response.json({ ok: false }, { status: 401, headers });
  const actual = Buffer.from(authorization.slice(7)), expected = Buffer.from(secret);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return Response.json({ ok: false }, { status: 401, headers });
  try {
    const client = createServiceClient(), expired = await client.rpc('service_expire_gifts', { p_limit: 100 });
    if (expired.error || !Number.isSafeInteger(expired.data?.expired) || expired.data.expired < 0 || expired.data.expired > 100) throw new Error('gift_expiry_failed');
    const exports = await client.rpc('service_purge_gift_exports', { p_limit: 1000 });
    if (exports.error || !Number.isSafeInteger(exports.data) || exports.data < 0 || exports.data > 1000) throw new Error('gift_export_purge_failed');
    const candidates = await client.rpc('service_list_fenced_gift_cleanup_candidates', { p_limit: 100 });
    if (candidates.error || !Array.isArray(candidates.data) || candidates.data.length > 100 || !candidates.data.every(isUuid) || new Set(candidates.data).size !== candidates.data.length) throw new Error('gift_cleanup_list_failed');
    let cleaned = 0, failed = 0;
    // Separate RPC transactions retain global actor ordering and partial success.
    for (const id of candidates.data) {
      const result = await client.rpc('service_cleanup_fenced_gift', { p_id: id });
      if (result.error || result.data?.giftId !== id || !['cleaned', 'ordered', 'not_fenced', 'missing'].includes(result.data?.state)) { failed++; continue; }
      if (result.data.state === 'cleaned') cleaned++;
    }
    return Response.json({ ok: failed === 0, expired: expired.data.expired, exportReceiptsPurged: exports.data, cleaned, failed }, { status: failed ? 503 : 200, headers });
  } catch { return Response.json({ ok: false }, { status: 503, headers }); }
}
