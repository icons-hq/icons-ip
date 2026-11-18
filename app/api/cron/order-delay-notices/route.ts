import { timingSafeEqual } from 'node:crypto';
import { processOrderDelayEmails } from '@/lib/email/order-delay-jobs.server';
import { startCronRun } from '@/lib/system-health/cron-run.server';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get('authorization');
  const expected = Buffer.from(secret || '');
  const actual = Buffer.from(
    authorization?.startsWith('Bearer ') ? authorization.slice(7) : '',
  );
  if (
    !secret ||
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  )
    return Response.json({ ok: false }, { status: 401, headers });
  const run = startCronRun('order-delay-notices');
  try {
    const result = await processOrderDelayEmails();
    const ok = !result.failed && !result.unknown && !result.stale;
    return run.finish(Response.json(
      { ok, ...result },
      { status: ok ? 200 : 503, headers },
    ));
  } catch (error) {
    return run.fail(error, Response.json({ ok: false }, { status: 503, headers }));
  }
}
