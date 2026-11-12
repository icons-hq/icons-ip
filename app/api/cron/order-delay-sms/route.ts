import { timingSafeEqual } from 'node:crypto';
import { processOrderDelaySms } from '@/lib/orders/order-delay-sms.server';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
/**
 * 예약 일정 변경 안내의 SMS 대기열(QNA-040). 앱 SMS 알림 스위치가 꺼져 있으면 DB를 건드리지 않고 끝난다.
 * 응답은 집계만 싣고 받는 사람·문구는 싣지 않는다. 실패·대상 변경은 503으로 관측한다.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get('authorization');
  const expected = Buffer.from(secret || '');
  const actual = Buffer.from(authorization?.startsWith('Bearer ') ? authorization.slice(7) : '');
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return Response.json({ ok: false }, { status: 401, headers });
  }
  try {
    const result = await processOrderDelaySms();
    const ok = !result.failed && !result.stale;
    return Response.json({ ok, ...result }, { status: ok ? 200 : 503, headers });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers });
  }
}
