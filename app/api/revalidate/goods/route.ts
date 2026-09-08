import { timingSafeEqual } from 'node:crypto';
import { revalidatePath, revalidateTag } from 'next/cache';
import { STOREFRONT_GOODS_CACHE_TAG } from '@/lib/storefront';

/*
 * 판매·할인 기간 경계 통과 알림 (규모 후속 · 팝업 경계 알림과 같은 규율).
 *
 * DB 크론(`goods_sale_boundary_tick`)이 상품의 판매 시작/종료·할인 시작/종료를 지날 때 부른다.
 * 하는 일은 **캐시를 버리는 것뿐**이다 — 판매 상태와 할인가는 조회 시 파생하므로 여기서 바꿀
 * 것이 없고, 이 라우트가 죽어도 데이터는 정확하다(화면만 캐시 수명만큼 늦는다).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Type': 'application/json',
};

function authorized(request: Request): boolean {
  const secret = process.env.GOODS_REVALIDATE_SECRET;
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

  let goodId = '';
  try {
    const body = (await request.json()) as { goodId?: unknown };
    if (typeof body.goodId === 'string') goodId = body.goodId.trim();
  } catch {
    return Response.json({ ok: false, error: 'invalid_body' }, { headers: NO_STORE_HEADERS, status: 400 });
  }
  if (!goodId) {
    return Response.json({ ok: false, error: 'good_required' }, { headers: NO_STORE_HEADERS, status: 400 });
  }

  /*
   * 목록 집계와 그 상품 상세를 함께 버린다 — 목록의 「판매 예정」 배지와 상세의 가격이 같은
   * 경계에서 바뀐다. `{ expire: 0 }` 은 즉시 만료다: stale-while-revalidate 를 쓰면 경계를 지난 뒤
   * 한 번은 옛 가격이 나간다 — 정각에 여는 상품에서는 그 한 번이 문의가 된다.
   */
  revalidateTag(STOREFRONT_GOODS_CACHE_TAG, { expire: 0 });
  revalidatePath(`/shop/${goodId}`);
  revalidatePath('/shop');
  return Response.json({ ok: true, goodId }, { headers: NO_STORE_HEADERS, status: 200 });
}
