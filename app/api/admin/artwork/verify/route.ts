import { verifyAdminArtworkUploadRequest, ADMIN_ARTWORK_VERIFY_ERROR } from '@/lib/admin/artwork-verify.server';
import { isSameOriginRequest } from '@/lib/http/same-origin.server';

/*
 * 업로드 확인(스테이징 → 공개 승격). R19(MD-0030): 서버 액션으로 하던 확인(내려받기·sharp·공개 업로드)이 수 초씩
 * 걸려, 한 화면의 서버 액션을 하나씩 보내는 Next 대기열에서 사진 보관함 팝업 조회 같은 다른 액션이 그 뒤에 섰다.
 * 서버 판정은 verifyAdminArtworkUploadAction과 같은 verifyAdminArtworkUploadRequest이고, 서버 액션이 하던 요청 출처
 * 확인(Origin = Host)은 isSameOriginRequest가 맡는다. 운영자별 확인은 DB가 한 번에 한 건만 허용하므로
 * 브라우저(artwork-upload.client)가 확인 요청을 차례로 보낸다.
 */
export const runtime = 'nodejs';

const headers = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' };
const SIGNED_OUT_ERROR = '로그인이 필요합니다. 다시 로그인한 뒤 시도해주세요.';
const ALLOWED_KEYS = new Set(['kind', 'mimeType', 'path', 'size', 'expectedActorId', 'library']);

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) {
    return Response.json({ ok: false, error: '요청 출처를 확인할 수 없습니다.' }, { status: 403, headers });
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return Response.json({ ok: false, error: ADMIN_ARTWORK_VERIFY_ERROR }, { status: 415, headers });
  }
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !ALLOWED_KEYS.has(key))) {
    return Response.json({ ok: false, error: ADMIN_ARTWORK_VERIFY_ERROR }, { status: 400, headers });
  }
  try {
    const outcome = await verifyAdminArtworkUploadRequest(body as Parameters<typeof verifyAdminArtworkUploadRequest>[0]);
    if (outcome.ok) {
      return Response.json(outcome.library
        ? { ok: true, imagePath: outcome.imagePath, library: outcome.library }
        : { ok: true, imagePath: outcome.imagePath }, { headers });
    }
    if ('signedOut' in outcome) return Response.json({ ok: false, error: SIGNED_OUT_ERROR }, { status: 401, headers });
    return Response.json({ ok: false, error: outcome.error }, { status: outcome.status, headers });
  } catch {
    return Response.json({ ok: false, error: ADMIN_ARTWORK_VERIFY_ERROR }, { status: 503, headers });
  }
}
