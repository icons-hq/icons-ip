import { handleKakaoAccountStatusWebhook } from '@/lib/kakao/account-unlink.server';
import { RawBodyTooLargeError, readBoundedRawBody } from '@/lib/http/bounded-raw-body.server';

/*
 * 카카오 계정 상태 변경 웹훅(SSF, 연결 해제 user-unlinked). 카카오 개발자 콘솔 [앱] > [웹훅] > [계정 상태 변경 웹훅]에
 * 이 주소를 등록한다(docs/runbooks/kakao-account-unlink.md). 본문은 카카오가 서명한 SET(JWT) 문자열이다.
 * 판정·처리는 lib/kakao/account-unlink.server.ts가 하고, 라우트는 본문 한도와 응답 형식(RFC 8935)만 맡는다.
 * 처리를 응답 전에 끝낸다 — 실패하면 500을 돌려 카카오의 재전송을 받는다(after로 미루면 실패를 알릴 수 없다).
 * Content-Type(application/secevent+jwt)은 보지 않는다. 판정은 서명이 하고, 헤더 변형으로 정상 알림을 버리지 않는다.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/* SET은 1~2 KiB다. 서명 검증 전에 일을 묶어 두려고 16 KiB로 막는다. */
const KAKAO_SET_BODY_LIMIT_BYTES = 16 * 1024;
const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' };

export async function POST(request: Request) {
  let body: string;
  try {
    body = await readBoundedRawBody(request, KAKAO_SET_BODY_LIMIT_BYTES);
  } catch (error) {
    if (error instanceof RawBodyTooLargeError) return new Response(null, { status: 413, headers: NO_STORE });
    return Response.json(
      { err: 'invalid_request', description: 'The request body could not be read.' },
      { status: 400, headers: NO_STORE },
    );
  }

  const result = await handleKakaoAccountStatusWebhook({ body });
  if (result.status === 400) return Response.json(result.body, { status: 400, headers: NO_STORE });
  return new Response(null, { status: result.status, headers: NO_STORE });
}
