import { timingSafeEqual } from 'node:crypto';
import { paymentAttemptRoute, reconcilablePaymentProviders, reconcilePaymentAttempt } from '@/lib/payments/attempt-reconciliation.server';
import { tossBoundPaymentSecretKey, tossEscrowSecretKey } from '@/lib/payments/runtime-gateway';
import { createTossVirtualAccountRefundInspector, type VirtualAccountRefundWatch } from '@/lib/payments/toss-virtual-account-refund-watch.server';
import { createServiceClient } from '@/lib/supabase/service';
import { cronErrorCode, startCronRun } from '@/lib/system-health/cron-run.server';
import { isUuid } from '@/lib/uuid';

/*
 * 미종결 결제 자동 재확인(원장 PAY-067·PAY-063). 10분마다 결과 불명(unknown)·멈춘 확인(confirming 리스 만료) 시도를 최대 3건
 * 골라 결제사 조회 API로 다시 확인한다. 고르는 규칙은 DB(service_claim_payment_reconciliation_candidates)가 정한다 — 조회 API가 있는
 * 시도(굿즈 토스·나이스페이, 티켓 토스) 중 이 배포에 결제사 설정이 있는 것(앱이 넘긴다), 마지막 변경 뒤 10분, 만든 지 7일 안, 30분 안에
 * 누구도 확인하거나 이 cron이 뽑지 않은 것을 마지막 확인이 오래된 순으로. DB가 뽑는 순간 표식을 남겨, 결제사 조회 전에 끝난 후보도
 * 30분 동안 다시 뽑히지 않는다(조회하지 못하는 후보가 큐를 막지 않는다). 그래서 같은 시도는 30분에 한 번만 조회되고 회차당 조회는
 * 3건이다(토스 조회 API 반복 호출 제한). 설정된 결제사가 없으면 DB를 부르지 않는다. needs_review(결제사와 원장이 어긋남)는 고르지 않는다 —
 * 운영자가 시스템 상태 화면에서 본다. 확정은 재정합 seam(claim 리스·DB 멱등 finalizer)이 해서 웹훅·운영자 재확인과 겹쳐도 안전하다.
 * 응답에는 건수만 싣는다(시도·주문 식별자 없음). 조회 실패·결제사 설정 없음은 503으로 남긴다.
 *
 * 둘째 단계: 가상계좌 은행 환불 감시(ADR-0049 결정 5 보강). 환불(취소 API CANCELED) 뒤 은행이 영업일 2일 안에 송금하는데 그 사이 실패를
 * 운영자가 [상태 다시 확인]을 누르기 전엔 몰랐다. 고르는 규칙은 DB(service_claim_virtual_account_refund_watches — 송금 확인 전·실패, 환불
 * 30일 안, 2시간·6시간 간격)가 정하고, 회차당 3건을 원장 결제 키로 조회해 결과를 남긴다(service_record_virtual_account_refund_watch).
 * paymentKey 조회는 코어 API라 결제 위젯 시크릿 키(gsk)로 부른다(에스크로 부가서비스 키가 아니다 — 토스 'API 키' 문서).
 * 이 단계의 실패(조회 불가·기록 실패·예외)는 첫 단계 건수를 버리지 않고 응답만 실패로 남긴다.
 * 실패·7일 지연은 DB가 운영 알림(벨·운영 알림 요약 메일)과 시스템 상태의 '환불 송금 실패'로 올린다. 토스 결제 UI 바인딩이 없는 배포는
 * 가상계좌가 없으므로 이 단계를 건너뛴다. 송금 상태가 NONE인 에스크로 결제는 에스크로 키로 거래를 조회해 구매자 취소 수락 환불인지
 * 함께 넘기고, DB가 그 감시를 7일 뒤 완료로 닫는다(escrowSettled, 2026-11-24 보강 — 토스가 그 환불의 송금 상태를 알리는지 문서에 없다).
 * 거래를 확인하지 못하면(에스크로 키 없음·조회 실패) 확인 없음으로 넘겨 지금 판정을 따르고 escrowLookupFailed로 센다 — 회차를 실패로
 * 만들지 않는다(지연으로 오른 감시도 다시 보므로 뒤 회차에 확인되면 닫힌다).
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 90;
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
const BATCH_LIMIT = 3;
/** 이 시간이 지나면 남은 후보는 다음 회차로 미룬다(시도당 조회 최대 8초 × 2와 승인 뒤 취소 예약의 여유). */
const START_BUDGET_MS = 40_000;
const REFUND_WATCH_LIMIT = 3;
/** 환불 감시는 결제 재확인 뒤에 돈다 — 이 시간(라우트 시작부터)이 지나면 남은 감시는 다음 회차로 미룬다(조회 8초 × 3). */
const REFUND_WATCH_BUDGET_MS = 60_000;

interface Candidate { attemptId: string; purpose: string; provider: string; refId: string | null }

function parseRefundWatches(value: unknown): VirtualAccountRefundWatch[] | null {
  if (!Array.isArray(value) || value.length > REFUND_WATCH_LIMIT) return null;
  const rows: VirtualAccountRefundWatch[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') return null;
    const { attemptId, orderId, paymentKey, providerOrderId, amount } = row as Record<string, unknown>;
    if (!isUuid(attemptId) || !isUuid(orderId) || typeof paymentKey !== 'string' || typeof providerOrderId !== 'string'
      || typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount <= 0) return null;
    rows.push({ attemptId, orderId, paymentKey, providerOrderId, amount });
  }
  return rows;
}

function parseCandidates(value: unknown, providers: readonly string[]): Candidate[] | null {
  if (!Array.isArray(value) || value.length > BATCH_LIMIT) return null;
  const rows: Candidate[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') return null;
    const { attemptId, purpose, provider, refId } = row as Record<string, unknown>;
    if (!isUuid(attemptId) || typeof purpose !== 'string' || typeof provider !== 'string' || (refId !== null && !isUuid(refId))) return null;
    if (!paymentAttemptRoute({ purpose, provider }) || !providers.includes(provider)) return null;
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
    const started = Date.now();
    const providers = reconcilablePaymentProviders();
    // 가상계좌 은행 환불 감시 — 토스 결제 UI 바인딩이 있는 운영 배포만(가상계좌는 그때만 받는다).
    const paymentSecretKey = tossBoundPaymentSecretKey();
    if (!providers.length && !paymentSecretKey) {
      return run.finish(Response.json({ ok: true, providers: 0, candidates: 0 }, { headers }));
    }
    const counts = { providers: providers.length, candidates: 0, approved: 0, closed: 0, awaitingDeposit: 0, unresolved: 0, inProgress: 0, unavailable: 0, failed: 0, deferred: 0 };
    const service = createServiceClient();
    if (providers.length) {
      const { data, error } = await service.rpc('service_claim_payment_reconciliation_candidates', { p_limit: BATCH_LIMIT, p_providers: providers });
      const candidates = error ? null : parseCandidates(data, providers);
      if (!candidates) throw new Error('reconciliation_candidates_unavailable');
      counts.candidates = candidates.length;
      const stamp = new Date(started).toISOString().replace(/\D/g, '').slice(0, 12);
      for (const candidate of candidates) {
        if (Date.now() - started > START_BUDGET_MS) { counts.deferred += 1; continue; }
        const result = await reconcilePaymentAttempt(candidate, `auto-${stamp}-${candidate.attemptId.replace(/-/g, '')}`);
        if (result.kind === 'reconciled') {
          if (result.outcome === 'approved') counts.approved += 1;
          else if (result.outcome === 'declined' || result.outcome === 'canceled') counts.closed += 1;
          // 가상계좌 입금 대기 재확인(입금 전·기한 유예 안) — 정상 대기다(ADR-0049).
          else if (result.outcome === 'awaiting_deposit') counts.awaitingDeposit += 1;
          else counts.unresolved += 1;
        } else if (result.kind === 'in_progress') counts.inProgress += 1;
        else if (result.kind === 'unavailable') counts.unavailable += 1;
        else counts.failed += 1;
      }
    }

    const refunds = { watches: 0, completed: 0, pending: 0, failed: 0, unavailable: 0, escrowSettled: 0, escrowLookupFailed: 0, recordFailed: 0, deferred: 0, errored: false };
    if (paymentSecretKey) {
      try {
        const { data, error } = await service.rpc('service_claim_virtual_account_refund_watches', { p_limit: REFUND_WATCH_LIMIT });
        const watches = error ? null : parseRefundWatches(data);
        if (!watches) throw new Error('refund_watches_unavailable');
        refunds.watches = watches.length;
        const inspector = createTossVirtualAccountRefundInspector({ secretKey: paymentSecretKey, escrowSecretKey: tossEscrowSecretKey() });
        for (const watch of watches) {
          // 미룬 감시는 DB가 건 10분 리스 뒤에 다시 뽑힌다.
          if (Date.now() - started > REFUND_WATCH_BUDGET_MS) { refunds.deferred += 1; continue; }
          const inspection = await inspector.inspect(watch);
          if (inspection.outcome === 'completed') refunds.completed += 1;
          else if (inspection.outcome === 'pending') refunds.pending += 1;
          else if (inspection.outcome === 'unavailable') refunds.unavailable += 1;
          else refunds.failed += 1;
          const { data: recorded, error: recordError } = await service.rpc('service_record_virtual_account_refund_watch', {
            p_attempt_id: watch.attemptId,
            p_outcome: inspection.outcome,
            p_refund_status: inspection.refundStatus,
            p_escrow_buyer_canceled: inspection.escrowBuyerCanceled,
          });
          if (recordError) refunds.recordFailed += 1;
          // 송금 확인 전으로 읽었는데 DB가 닫았다 — 에스크로 구매자 취소 환불을 7일 뒤 완료로 닫았다.
          else if (inspection.outcome === 'pending' && recorded === 'completed') refunds.escrowSettled += 1;
          if (inspection.escrowLookupFailed) {
            refunds.escrowLookupFailed += 1;
            console.error('[cron/payment-reconciliation] escrow transaction lookup for refund watch failed', { orderId: watch.orderId });
          }
          if (inspection.outcome === 'failed' || inspection.outcome === 'mismatch') {
            console.error('[cron/payment-reconciliation] virtual account refund needs operator action', { orderId: watch.orderId, outcome: inspection.outcome });
          }
        }
      } catch (error) {
        // 앞 단계 건수는 그대로 응답하고 이 단계만 실패로 남긴다(응답 ok=false → 실행 기록이 실패로 남는다).
        refunds.errored = true;
        console.error('[cron/payment-reconciliation] refund watch phase failed', { code: cronErrorCode(error) });
      }
    }

    const ok = counts.failed === 0 && counts.unavailable === 0 && refunds.unavailable === 0 && refunds.recordFailed === 0 && !refunds.errored;
    return run.finish(Response.json({ ok, ...counts, refunds }, { status: ok ? 200 : 503, headers }));
  } catch (error) {
    return run.fail(error, Response.json({ ok: false }, { status: 503, headers }));
  }
}
