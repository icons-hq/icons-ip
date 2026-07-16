import { timingSafeEqual } from 'node:crypto';
import { cleanupExpiredAdminArtworkUploads } from '@/lib/admin/artwork.server';

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

function response(
  body: { ok: boolean; candidates?: number; completed?: number },
  status: number,
) {
  return Response.json(body, { headers: NO_STORE_HEADERS, status });
}

export async function GET(request: Request) {
  if (!authorized(request)) return response({ ok: false }, 401);

  try {
    const result = await cleanupExpiredAdminArtworkUploads();
    if (!result || result.completed !== result.candidates) {
      return response({ ok: false }, 503);
    }

    return response({ ok: true, ...result }, 200);
  } catch {
    return response({ ok: false }, 503);
  }
}
