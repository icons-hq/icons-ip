import { timingSafeEqual } from 'node:crypto';
import { paymentAttemptRoute, reconcilePaymentAttempt } from '@/lib/payments/attempt-reconciliation.server';
import { createServiceClient } from '@/lib/supabase/service';
import { startCronRun } from '@/lib/system-health/cron-run.server';
import { isUuid } from '@/lib/uuid';

/*
 * 미종결 결제 자동 재확인(원장 PAY-067·PAY-063). 10분마다 결과 불명(unknown)·멈춘 확인(confirming 리스 만료) 시도를 최대 3건
 * 골라 결제사 조회 API로 다시 확인한다. 고르는 규칙은 DB(service_list_payment_reconciliation_candidates)가 정한다 — 조회 API가 있는
 * 시도(굿즈 토스·나이스페이, 티켓 토스), 마지막 변경 뒤 10분, 만든 지 7일 안, 30분 안에 누구도 확인하지 않은 것. 그래서 같은 시도는
 * 30분에 한 번만 조회되고 회차당 조회는 3건이다(토스 조회 API 반복 호출 제한). needs_review(결제사와 원장이 어긋남)는 고르지 않는다 —
 * 운영자가 시스템 상태 화면에서 본다. 확정은 재정합 seam(claim 리스·DB 멱등 finalizer)이 해서 웹훅·운영자 재확인과 겹쳐도 안전하다.
 * 응답에는 건수만 싣는다(시도·주문 식별자 없음). 조회 실패·결제사 설정 없음은 503으로 남긴다.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 90;
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
const BATCH_LIMIT = 3;
/** 이 시간이 지나면 남은 후보는 다음 회차로 미룬다(시도당 조회 최대 8초 × 2와 승인 뒤 취소 예약의 여유). */
const START_BUDGET_MS = 40_000;

interface Candidate { attemptId: string; purpose: string; provider: string; refId: string | null }

function parseCandidates(value: unknown): Candidate[] | null {
  if (!Array.isArray(value) || value.length > BATCH_LIMIT) return null;
  const rows: Candidate[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') return null;
    const { attemptId, purpose, provider, refId } = row as Record<string, unknown>;
    if (!isUuid(attemptId) || typeof purpose !== 'string' || typeof provider !== 'string' || (refId !== null && !isUuid(refId))) return null;
    if (!paymentAttemptRoute({ purpose, provider })) return null;
    rows.push({ attemptId, purpose, provider, refId: refId as string | null });
  }
  return rows;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get('authorization');
  const expected = Buffer.from(secret || '');
  const actual = Buffer.from(authorization?.startsWith('Bearer ') ? authorization.slice(7) : '');
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return Response.json({ ok: false }, { status: 401, headers });
  }
  const run = startCronRun('payment-reconciliation');
  try {
    const { data, error } = await createServiceClient().rpc('service_list_payment_reconciliation_candidates', { p_limit: BATCH_LIMIT });
    const candidates = error ? null : parseCandidates(data);
    if (!candidates) throw new Error('reconciliation_candidates_unavailable');
    const started = Date.now();
    const stamp = new Date(started).toISOString().replace(/\D/g, '').slice(0, 12);
    const counts = { candidates: candidates.length, approved: 0, closed: 0, unresolved: 0, inProgress: 0, unavailable: 0, failed: 0, deferred: 0 };
    for (const candidate of candidates) {
      if (Date.now() - started > START_BUDGET_MS) { counts.deferred += 1; continue; }
      const result = await reconcilePaymentAttempt(candidate, `auto-${stamp}-${candidate.attemptId.replace(/-/g, '')}`);
      if (result.kind === 'reconciled') {
        if (result.outcome === 'approved') counts.approved += 1;
        else if (result.outcome === 'declined' || result.outcome === 'canceled') counts.closed += 1;
        else counts.unresolved += 1;
      } else if (result.kind === 'in_progress') counts.inProgress += 1;
      else if (result.kind === 'unavailable') counts.unavailable += 1;
      else counts.failed += 1;
    }
    const ok = counts.failed === 0 && counts.unavailable === 0;
    return run.finish(Response.json({ ok, ...counts }, { status: ok ? 200 : 503, headers }));
  } catch (error) {
    return run.fail(error, Response.json({ ok: false }, { status: 503, headers }));
  }
}
