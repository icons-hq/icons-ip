import { timingSafeEqual } from 'node:crypto';
import { purgeExpiredExports, runExportJob } from '@/lib/admin/export-worker.server';

/*
 * D-4 내보내기 워커 라우트.
 *
 * GET·POST = 큐에서 하나 처리(크론은 GET 만 보낸다) · DELETE = 만료 파일 정리.
 * 일 자체는 `lib/admin/export-worker.server.ts` 가 하고 여기서는 인증과 응답만 맡는다.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

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

function response(body: Record<string, unknown>, status: number) {
  return Response.json(body, { headers: NO_STORE_HEADERS, status });
}

async function work(request: Request) {
  if (!authorized(request)) return response({ ok: false }, 401);
  try {
    const result = await runExportJob(`worker-${process.pid}`);
    return response({ ok: true, ...result }, 200);
  } catch (error) {
    return response({ ok: false, error: error instanceof Error ? error.message : 'unknown_error' }, 503);
  }
}

export async function GET(request: Request) {
  return work(request);
}

export async function POST(request: Request) {
  return work(request);
}

export async function DELETE(request: Request) {
  if (!authorized(request)) return response({ ok: false }, 401);
  try {
    const result = await purgeExpiredExports();
    return response({ ok: true, ...result }, 200);
  } catch (error) {
    return response({ ok: false, error: error instanceof Error ? error.message : 'unknown_error' }, 503);
  }
}
