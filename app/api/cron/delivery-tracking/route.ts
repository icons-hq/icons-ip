import { timingSafeEqual } from 'node:crypto';
import { trackingAdapterFromEnvironment } from '@/lib/fulfillment/tracking/adapter.server';
import { deliveryTrackingRepository } from '@/lib/fulfillment/tracking/repository.server';
import { runDeliveryTrackingTick } from '@/lib/fulfillment/tracking/run';

/*
 * 택배 추적 자동 배송완료(QNA-028). 10분마다 불리지만 DB 스위치가 꺼져 있으면(기본) 스위치를 한 번 읽고 끝난다 —
 * 외부 추적 서비스를 부르지 않고 아무것도 바꾸지 않는다. 켜는 순서는 docs/runbooks/delivery-tracking.md.
 * 다른 cron과 같은 인증·응답 규칙이고, 응답에는 건수만 싣는다(운송장번호·이벤트·오류 본문은 싣지 않는다).
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
    const result = await runDeliveryTrackingTick({ repository: deliveryTrackingRepository(), adapterFor: provider => trackingAdapterFromEnvironment(provider) });
    // 켜져 있는데 어댑터가 없거나(키·이름 불일치) 조회가 실패하면 관측되게 503으로 남긴다. 꺼져 있으면 정상이다.
    const ok = !result.enabled || (!result.unavailable && result.failed === 0);
    return Response.json({ ok, ...result }, { status: ok ? 200 : 503, headers });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers });
  }
}
