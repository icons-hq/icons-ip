import { timingSafeEqual } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/service';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const expected = Buffer.from(secret || '');
  const authorization = request.headers.get('authorization');
  const actual = Buffer.from(authorization?.startsWith('Bearer ') ? authorization.slice(7) : '');
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) return Response.json({ ok: false }, { status: 401, headers });
  try {
    const { data, error } = await createServiceClient().rpc('process_store_analytics_retention');
    if (error) throw error;
    const member = await createServiceClient().rpc('process_member_activity_retention');
    if (member.error) throw member.error;
    return Response.json({ ok: true, result: data, memberActivity: member.data }, { headers });
  } catch { return Response.json({ ok: false }, { status: 503, headers }); }
}
