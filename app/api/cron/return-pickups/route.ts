import { timingSafeEqual } from 'node:crypto';
import { returnPickupAdapterFromEnvironment } from '@/lib/fulfillment/pickup/adapter.server';
import { openSealedPickupAddress } from '@/lib/fulfillment/pickup/address.server';
import { returnPickupRepository } from '@/lib/fulfillment/pickup/repository.server';
import { runReturnPickupTick } from '@/lib/fulfillment/pickup/run';

/*
 * 반품 자동 회수 접수(QNA-032·ADR-0034). 5분마다 불리지만 DB 스위치가 꺼져 있으면(기본) 스위치를 한 번 읽고 끝난다 — 택배사를 부르지
 * 않고 아무것도 바꾸지 않는다. 켜는 순서는 docs/runbooks/return-pickup-intake.md.
 * 승인 트랜잭션 밖의 지연 큐다: 승인이 회수 묶음을 만들고, 이 크론이 묶음마다 그 출고지의 회수 계약 택배사에 접수한다. 접수 실패는 승인을
 * 되돌리지 않고 DB가 다시 시도·'자동 수거 실패'로 센다. 다른 cron과 같은 인증·응답 규칙이고, 응답에는 건수와 실패한 단계 이름만 싣는다.
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
    const result = await runReturnPickupTick({
      repository: returnPickupRepository(),
      adapterFor: provider => returnPickupAdapterFromEnvironment(provider),
      openSealedAddress: sender => openSealedPickupAddress(sender),
    });
    // 단계가 실패했거나, 켜져 있는데 이 서버에 어댑터가 없거나(키·이름 불일치), 형식이 틀린 일·결과가 있으면 관측되게 503으로 남긴다.
    // 택배사가 거절한 접수는 실패가 아니라 업무 결과다 — DB가 '자동 수거 실패'로 세어 운영 화면에 보인다.
    const ok = !result.failedStages && (result.enabled !== true || (!result.unavailable && result.invalid === 0));
    return Response.json({ ok, ...result }, { status: ok ? 200 : 503, headers });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers });
  }
}
