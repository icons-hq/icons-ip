import { timingSafeEqual } from 'node:crypto';
import { revalidateTag } from 'next/cache';
import { popupCacheTag, POPUPS_CACHE_TAG } from '@/lib/popups';

/*
 * 팝업 경계 통과 알림 (설계서 v2 §1-8).
 *
 * DB 크론이 페이즈·팝업 경계를 지날 때 부른다. 하는 일은 **캐시를 버리는 것뿐**이다 —
 * 상태는 조회 시 파생하므로 여기서 바꿀 것이 없고, 이 라우트가 죽어도 데이터는 정확하다
 * (화면만 캐시 수명만큼 늦는다).
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Type': 'application/json',
};

function authorized(request: Request): boolean {
  const secret = process.env.POPUP_REVALIDATE_SECRET;
  const given = request.headers.get('x-revalidate-secret');
  if (!secret || !given) return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false }, { headers: NO_STORE_HEADERS, status: 401 });
  }

  let popupId = '';
  try {
    const body: unknown = await request.json();
    if (body && typeof body === 'object' && 'popupId' in body) {
      popupId = String((body as { popupId: unknown }).popupId ?? '').trim();
    }
  } catch {
    return Response.json({ ok: false, error: 'invalid_body' }, { headers: NO_STORE_HEADERS, status: 400 });
  }
  if (!popupId) {
    return Response.json({ ok: false, error: 'popup_required' }, { headers: NO_STORE_HEADERS, status: 400 });
  }

  /*
   * 목록과 그 팝업 하나를 함께 버린다 — 목록의 「진행중」 배지도 같은 경계에서 바뀐다.
   * `{ expire: 0 }` 은 즉시 만료다. 프로필 이름('max')을 주면 stale-while-revalidate 라
   * 경계를 지난 뒤에도 한 번은 옛 편성이 나간다 — 정각에 여는 팝업에서는 그 한 번이 문제다.
   */
  revalidateTag(POPUPS_CACHE_TAG, { expire: 0 });
  revalidateTag(popupCacheTag(popupId), { expire: 0 });
  return Response.json({ ok: true, popupId }, { headers: NO_STORE_HEADERS, status: 200 });
}
