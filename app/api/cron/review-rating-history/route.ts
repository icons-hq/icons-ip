import { timingSafeEqual } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { parseReviewRatingCollectionResult } from '@/lib/admin/review-rating-history';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' };
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const expected = Buffer.from(secret || '');
  const authorization = request.headers.get('authorization');
  const actual = Buffer.from(authorization?.startsWith('Bearer ') ? authorization.slice(7) : '');
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return Response.json({ ok: false }, { status: 401, headers });
  try {
    const { data, error } = await createServiceClient().rpc('service_observe_review_rating_daily');
    const result = error ? null : parseReviewRatingCollectionResult(data);
    if (!result) return Response.json({ ok: false }, { status: 503, headers });
    return Response.json({ ok: true, result }, { headers });
  } catch { return Response.json({ ok: false }, { status: 503, headers }); }
}
// Next otherwise derives HEAD from GET; a HEAD probe must never run the collector.
export function HEAD() { return new Response(null, { status: 405, headers: { ...headers, Allow: 'GET' } }); }
