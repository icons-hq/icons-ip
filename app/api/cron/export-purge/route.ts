import { timingSafeEqual } from 'node:crypto';
import { purgeExpiredExports } from '@/lib/admin/export-worker.server';

/* 만료된 내보내기 파일 정리(하루 1회). Vercel 크론은 GET 만 보낸다. */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Type': 'application/json',
};

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get('authorization');
  if (!secret || !authorization?.startsWith('Bearer ')) return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(authorization.slice('Bearer '.length));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false }, { headers: NO_STORE_HEADERS, status: 401 });
  }
  try {
    const result = await purgeExpiredExports();
    return Response.json({ ok: true, ...result }, { headers: NO_STORE_HEADERS, status: 200 });
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : 'unknown_error' },
      { headers: NO_STORE_HEADERS, status: 503 },
    );
  }
}
