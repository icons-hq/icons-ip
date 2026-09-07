import { timingSafeEqual } from 'node:crypto';
import {
  GoodsPaymentContractError,
  GoodsPaymentReconciliationInProgressError,
} from '@/lib/payments/goods-checkout';
import { goodsPaymentConfirmationAvailable } from '@/lib/payments/goods-checkout-availability';
import { createRuntimeGoodsPaymentCheckout } from '@/lib/payments/goods-checkout.runtime.server';
import { createServiceClient } from '@/lib/supabase/service';

const OPAQUE_SECRET = /^[A-Za-z0-9_-]{16,128}$/;
const OPAQUE_AUDIT_REF = /^[A-Za-z0-9_-]{16,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type AttemptLookup =
  | { readonly kind: 'ok'; readonly provider: unknown; readonly purpose: unknown }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'failed' };

/**
 * reconcile(claim RPC) 전에 attempt의 provider·purpose만 읽는다. claim RPC
 * (`claim_goods_payment_reconciliation`)는 `provider in ('toss','korpay')`를 잡아
 * `unknown | needs_review` 행을 `confirming`(claim 리스 10분)으로 바꾼 **뒤에야** seam의
 * assertAttempt가 provider 불일치를 던진다 — 이 라우트가 코페이 attempt를 그대로
 * 넘기면 #208 수동 큐의 `needs_review` 행이 조용히 `confirming`으로 옮겨진 채 400이
 * 되고, 10분간 다른 처리자에게 in_progress로 잠긴다. 그래서 라우트가 claim 전에
 * 걸러 상태를 바꾸지 않고 거절한다. 웹훅 라우트의 loadTossAttempt와 같은 관용이되
 * provider 필터를 두지 않는다 — 코페이 행을 "부재"가 아니라 "지원하지 않음"으로
 * 구분해 돌려주기 위해서다. provider·purpose는 prepare 시점에 고정되는 값이라 이
 * 조회와 claim 사이에 바뀌지 않는다.
 *
 * 조회 오류와 행 부재를 합치지 않는다 — 합치면 일시 DB 장애가 "없는 attempt"로
 * 읽혀 운영자가 잘못된 결론을 내린다.
 */
async function loadAttempt(attemptId: string): Promise<AttemptLookup> {
  try {
    const { data, error } = await createServiceClient()
      .from('payment_attempts')
      .select('provider,purpose')
      .eq('id', attemptId)
      .maybeSingle();
    if (error) return { kind: 'failed' };
    if (!data) return { kind: 'not_found' };
    const row = data as Record<string, unknown>;
    return { kind: 'ok', provider: row.provider, purpose: row.purpose };
  } catch {
    // service role 미구성·전송 실패 — 내부 메시지는 응답에 싣지 않는다.
    return { kind: 'failed' };
  }
}

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
 * **토스 attempt 전용**이다. 토스 굿즈 attempt가 아니면(코페이·무통장·티켓) claim
 * 전에 422 `unsupported_attempt`로 거절하고 상태를 바꾸지 않는다 — 코페이 건(#208
 * 수동 큐의 `needs_review`)은 조회·취소 API가 없어 이 seam이 판정할 수 없고, 수동
 * 복구 seam(`claim_goods_manual_payment_recovery` · `finalize_goods_manual_payment_recovery`)
 * 이 정상 경로다. attempt 부재는 404 `attempt_not_found`, 조회 실패는 502
 * `attempt_lookup_failed`다.
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

  const attempt = await loadAttempt(attemptId);
  if (attempt.kind === 'failed') return response({ error: 'attempt_lookup_failed' }, 502);
  if (attempt.kind === 'not_found') return response({ error: 'attempt_not_found' }, 404);
  if (attempt.provider !== 'toss' || attempt.purpose !== 'order') {
    // claim RPC를 부르지 않았으므로 attempt 상태는 그대로다. 응답에 provider를
    // 되돌려주지 않는다 — 식별자 비노출 계약은 거절 응답에도 적용된다.
    return response({ error: 'unsupported_attempt' }, 422);
  }

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
