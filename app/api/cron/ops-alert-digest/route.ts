import { timingSafeEqual } from 'node:crypto';
import { processOpsAlertDigests } from '@/lib/email/ops-alert-digest-jobs.server';
import { startCronRun } from '@/lib/system-health/cron-run.server';

/*
 * 운영 알림 요약 메일(OPS-095). 5분마다 불러도 10분에 한 통까지만 요약을 만들고(DB throttle), 꺼져 있으면 선점하지 않는다.
 * 다른 메일 작업 cron과 같은 인증·응답 규칙이다(수신 주소·본문을 응답에 싣지 않는다).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get('authorization');
  const expected = Buffer.from(secret || '');
  const actual = Buffer.from(authorization?.startsWith('Bearer ') ? authorization.slice(7) : '');
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return Response.json({ ok: false }, { status: 401, headers });
  }
  const run = startCronRun('ops-alert-digest');
  try {
    const result = await processOpsAlertDigests();
    const ok = !result.failed && !result.unknown && !result.stale;
    return run.finish(Response.json({ ok, ...result }, { status: ok ? 200 : 503, headers }));
  } catch (error) {
    return run.fail(error, Response.json({ ok: false }, { status: 503, headers }));
  }
}
