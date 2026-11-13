import { after } from 'next/server';
import { handleKakaoChannelWebhook } from '@/lib/kakao/channel-reward.server';
import { RawBodyTooLargeError, readBoundedRawBody } from '@/lib/http/bounded-raw-body.server';

/*
 * 카카오톡 채널 웹훅(1014-014). 카카오 개발자 콘솔 [앱] > [웹훅] > [카카오톡 채널 웹훅]에 이 주소를 등록한다.
 * 스위치(ICONS_KAKAO_CHANNEL_ENABLED)가 꺼져 있으면 404다. 판정은 lib/kakao/channel-reward.server.ts가 하고,
 * 채널 관계 재확인·쿠폰 발급은 응답을 보낸 뒤(after) 한다 — 카카오는 3초 안의 2xx를 기대한다.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/* 카카오 웹훅 본문은 필드 몇 개뿐이다. 넉넉하게 8 KiB로 막는다. */
const KAKAO_WEBHOOK_BODY_LIMIT_BYTES = 8 * 1024;
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' };

export async function POST(request: Request) {
  let body: string;
  try {
    body = await readBoundedRawBody(request, KAKAO_WEBHOOK_BODY_LIMIT_BYTES);
  } catch (error) {
    return new Response(null, { status: error instanceof RawBodyTooLargeError ? 413 : 400, headers: NO_STORE });
  }

  const result = handleKakaoChannelWebhook({ authorization: request.headers.get('authorization'), body });
  const work = result.work;
  if (work) {
    after(async () => {
      await work();
    });
  }
  return new Response(null, { status: result.status, headers: NO_STORE });
}
