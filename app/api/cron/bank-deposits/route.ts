import { timingSafeEqual } from 'node:crypto';
import { ingestBankDeposits } from '@/lib/payments/bank-deposit-feed.server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/*
 * 계좌수집 입금 내역 수집 (#257).
 *
 * 어댑터가 등록되기 전까지 이 경로는 `configured: false`만 돌려준다. 스케줄만
 * 먼저 걸어 두면 계약(#255)이 끝난 날 어댑터 하나만 붙여도 수집이 시작된다.
 *
 * 성공/실패를 200/503으로 가르는 이유는 스케줄러가 재시도를 판단할 수 있어야
 * 하기 때문이다. 재수집은 (source, external_id) 유일 제약 덕에 안전하다.
 */

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Content-Type': 'application/json',
};

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get('authorization');
  if (!secret || !authorization?.startsWith('Bearer ')) return false;

  const expected = Buffer.from(secret);
  const actual = Buffer.from(authorization.slice('Bearer '.length));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function response(
  body: { ok: boolean; configured?: boolean; fetched?: number; inserted?: number },
  status: number,
) {
  return Response.json(body, { headers: NO_STORE_HEADERS, status });
}

export async function GET(request: Request) {
  if (!authorized(request)) return response({ ok: false }, 401);

  try {
    const result = await ingestBankDeposits();
    if (!result) return response({ ok: true, configured: false }, 200);
    return response(
      { ok: true, configured: true, fetched: result.fetched, inserted: result.inserted },
      200,
    );
  } catch {
    return response({ ok: false }, 503);
  }
}
