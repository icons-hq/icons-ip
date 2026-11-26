import { timingSafeEqual } from 'node:crypto';
import { evidenceHeaders, purgeOverseasEvidence } from '@/lib/identity/overseas-evidence.server';
import { startCronRun } from '@/lib/system-health/cron-run.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const expected = Buffer.from('Bearer ' + (secret ?? ''));
  const actual = Buffer.from(request.headers.get('authorization') ?? '');
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected))
    return new Response(null, { status: 401, headers: evidenceHeaders });
  const run = startCronRun('overseas-adult-review');
  try {
    const result = await purgeOverseasEvidence();
    return run.finish(Response.json(result, { status: result.failed ? 503 : 200, headers: evidenceHeaders }));
  } catch (error) {
    return run.fail(error, new Response(null, { status: 503, headers: evidenceHeaders }));
  }
}
