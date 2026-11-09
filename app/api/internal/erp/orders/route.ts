import { timingSafeEqual } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/service';

const OPAQUE_SECRET = /^[A-Za-z0-9_-]{16,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function authorized(request: Request) {
  const secret = process.env.ERP_SYNC_SECRET;
  const authorization = request.headers.get('authorization');
  if (!secret || !OPAQUE_SECRET.test(secret) || !authorization?.startsWith('Bearer ')) return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(authorization.slice('Bearer '.length));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function response(body: Record<string, unknown>, status: number) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

type Cursor = { afterAt: string | null; afterId: string | null; limit: number };

function readCursor(url: URL): Cursor | null {
  const afterAt = url.searchParams.get('afterAt');
  const afterId = url.searchParams.get('afterId');
  const limitText = url.searchParams.get('limit');
  const limit = limitText === null ? 100 : Number(limitText);
  if (afterAt !== null && Number.isNaN(Date.parse(afterAt))) return null;
  if (afterId !== null && (afterAt === null || !UUID.test(afterId))) return null;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) return null;
  return { afterAt, afterId, limit };
}

/**
 * ERP(ERPNext) 주문 피드 — AX 서버가 결제된 주문·출고 묶음을 커서로 당긴다(읽기 전용).
 * 문은 분리된 Bearer `ERP_SYNC_SECRET` 상수 시간 비교 하나이고, 값이 없으면 라우트가 닫힌다.
 * 본문은 `service_erp_order_feed` 가 만든다 — 받는 사람·연락처·주소·결제 식별자는 싣지 않는다.
 * 응답의 `next`(at·id)를 다음 요청의 afterAt·afterId 로 넘긴다.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return response({ error: 'unauthorized' }, 401);
  const cursor = readCursor(new URL(request.url));
  if (!cursor) return response({ error: 'invalid_request' }, 400);
  try {
    const { data, error } = await createServiceClient().rpc('service_erp_order_feed', {
      p_after_at: cursor.afterAt,
      p_after_id: cursor.afterId,
      p_limit: cursor.limit,
    });
    if (error || typeof data !== 'object' || data === null) return response({ error: 'feed_failed' }, 502);
    return response(data as Record<string, unknown>, 200);
  } catch {
    return response({ error: 'feed_failed' }, 502);
  }
}
