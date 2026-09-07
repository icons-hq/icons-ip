import { timingSafeEqual } from 'node:crypto';
import {
  GoodsPaymentContractError,
  GoodsPaymentReconciliationInProgressError,
} from '@/lib/payments/goods-checkout';
import { goodsPaymentConfirmationAvailable } from '@/lib/payments/goods-checkout-availability';
import { createRuntimeGoodsPaymentCheckout } from '@/lib/payments/goods-checkout.runtime.server';

const OPAQUE_SECRET = /^[A-Za-z0-9_-]{16,128}$/;
const OPAQUE_AUDIT_REF = /^[A-Za-z0-9_-]{16,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function authorized(request: Request) {
  const secret = process.env.PAYMENT_RECONCILIATION_SECRET;
  const authorization = request.headers.get('authorization');
  if (!secret
    || !OPAQUE_SECRET.test(secret)
    || !authorization?.startsWith('Bearer ')
  ) return false;

  const expected = Buffer.from(secret);
  const actual = Buffer.from(authorization.slice('Bearer '.length));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function response(body: Record<string, unknown>, status: number) {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  });
}

/**
 * 굿즈 결제 재정합의 명시적 트리거 — 검토된 한 건만 지정한다. 티켓 내부 라우트
 * (`/api/internal/payments/tickets/reconcile`)와 같은 계약(분리된 Bearer
 * `PAYMENT_RECONCILIATION_SECRET` 상수 시간 비교 · PII 없는 opaque `caseRef` ·
 * outcome별 상태 코드)이되, 굿즈에는 환불 reconcile seam이 없어 `operation`은
 * `payment`만 받는다. 두 라우트는 의도적으로 독립이다(공용 helper 없음).
 *
 * reconcile을 태우는 트리거는 토스 웹훅 재전송(최대 7회)과 이 라우트뿐이고 주기
 * 크론은 없다 — 재전송이 소진되거나 웹훅이 오지 않아 `unknown`으로 남은 건을
 * 운영자가 여기서 건 지정으로 닫는다. 확정은 여전히 조회 API 재검증(reconcile
 * seam)과 DB 멱등 finalizer가 하며, 응답에는 provider 식별자를 싣지 않는다.
 */
export async function POST(request: Request) {
  if (!authorized(request)) return response({ error: 'unauthorized' }, 401);
  if (!goodsPaymentConfirmationAvailable('toss')) {
    return response({ error: 'payment_unavailable' }, 503);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return response({ error: 'invalid_request' }, 400);
  }
  const input = typeof body === 'object' && body !== null && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const attemptId = input.attemptId;
  const caseRef = input.caseRef;
  if (
    input.operation !== 'payment'
    || typeof attemptId !== 'string'
    || !UUID.test(attemptId)
    || typeof caseRef !== 'string'
    || !OPAQUE_AUDIT_REF.test(caseRef)
  ) return response({ error: 'invalid_request' }, 400);

  try {
    const outcome = await createRuntimeGoodsPaymentCheckout('toss')
      .reconcilePayment({ attemptId, caseRef });
    return response(
      { attemptId: outcome.attemptId, outcome: outcome.outcome },
      outcome.outcome === 'unknown' || outcome.outcome === 'needs_review' ? 202 : 200,
    );
  } catch (error) {
    if (error instanceof GoodsPaymentReconciliationInProgressError) {
      return response({ outcome: 'unknown' }, 202);
    }
    if (error instanceof GoodsPaymentContractError) {
      return response({ error: 'invalid_request' }, 400);
    }
    return response({ error: 'reconciliation_failed' }, 502);
  }
}
