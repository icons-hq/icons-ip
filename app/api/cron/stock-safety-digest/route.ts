import { timingSafeEqual } from 'node:crypto';
import { processStockSafetyDigests } from '@/lib/email/stock-safety-digest-jobs.server';

/*
 * 안전재고 하루 1회 요약 메일(QNA-014). 매분 불러도 그날 실행은 DB가 설정 시각(KST) 뒤 한 번만 만들고,
 * 꺼져 있으면 선점하지 않는다. 다른 메일 작업 cron과 같은 인증·응답 규칙이다(수신 주소·본문을 응답에 싣지 않는다).
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
  try {
    const result = await processStockSafetyDigests();
    const ok = !result.failed && !result.unknown && !result.stale;
    return Response.json({ ok, ...result }, { status: ok ? 200 : 503, headers });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers });
  }
}
