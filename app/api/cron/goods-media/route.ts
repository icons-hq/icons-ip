import { timingSafeEqual } from 'node:crypto';
import { cleanupDigitalAssets } from '@/lib/admin/digital-assets.server';
import { cleanupGoodsMediaUploads } from '@/lib/admin/goods-media.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET, authorization = request.headers.get('authorization');
  const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
  if (!secret || !authorization?.startsWith('Bearer ')) return Response.json({ ok: false }, { status: 401, headers });
  const actual = Buffer.from(authorization.slice(7)), expected = Buffer.from(secret);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return Response.json({ ok: false }, { status: 401, headers });
  try {
    const result = await cleanupGoodsMediaUploads(50);
    const digital = await cleanupDigitalAssets(20);
    if (!digital || digital.completed !== digital.candidates) return Response.json({ ok: false }, { status: 503, headers });
    if (!result || result.completed !== result.candidates) return Response.json({ ok: false }, { status: 503, headers });
    return Response.json({ ok: true, ...result, digital }, { headers });
  } catch { return Response.json({ ok: false }, { status: 503, headers }); }
}
