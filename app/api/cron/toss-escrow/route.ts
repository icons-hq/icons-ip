import { timingSafeEqual } from 'node:crypto';
import { tossEscrowSecretKey } from '@/lib/payments/runtime-gateway';
import { createTossEscrowWorker, type TossEscrowJob } from '@/lib/payments/toss-escrow.server';
import { createServiceClient } from '@/lib/supabase/service';
import { startCronRun } from '@/lib/system-health/cron-run.server';
import { isUuid } from '@/lib/uuid';

/*
 * 토스 에스크로(구매안전서비스) 배송 등록·거래 상태 확인(ADR-0049 결정 6). 15분마다 최대 10건.
 *
 * 대상과 시점은 DB가 정한다(service_claim_toss_escrow_jobs — 입금 승인된 가상계좌 결제 중 에스크로를 골랐거나 선택을 모르는
 * 주문, 실물 배송 건이 전부 발송됐을 때 등록·정정, 그 밖은 1시간마다 거래 상태 확인). 이 라우트는 토스를 부르고 결과를
 * service_finish_toss_escrow_job으로 남긴다. 구매자 취소 신청(CANCEL_REQUESTED)은 DB가 주문 출고 보류로 띄운다. 자동 등록이
 * 안 되는 건(택배사 코드 없음·송장 형식 거절·키 권한)은 운영자 확인(manual_required)으로 남는다 — 토스 상점관리자에서 등록한다.
 * 응답에는 건수만 싣는다. 토스 설정(운영 배포 + 결제 UI 바인딩)이 없는 배포는 아무것도 하지 않는다.
 */
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 90;
const headers = { 'Cache-Control': 'private, no-store, max-age=0' };
const BATCH_LIMIT = 10;
const START_BUDGET_MS = 60_000;

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}

function parseJobs(value: unknown): TossEscrowJob[] | null {
  if (!Array.isArray(value) || value.length > BATCH_LIMIT) return null;
  const jobs: TossEscrowJob[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object') return null;
    const record = row as Record<string, unknown>;
    if (!isUuid(record.orderId) || !isUuid(record.attemptId)) return null;
    if (record.state !== 'ready' && record.state !== 'registered' && record.state !== 'waiting') return null;
    const method = record.deliveryMethod;
    if (method !== null && method !== 'SHIPMENT' && method !== 'DIRECT') return null;
    if (typeof record.revision !== 'number' || !Number.isSafeInteger(record.revision) || record.revision < 1) return null;
    jobs.push({
      orderId: record.orderId,
      attemptId: record.attemptId,
      state: record.state,
      deliveryMethod: method,
      carrier: text(record.carrier, 32),
      trackingNumber: text(record.trackingNumber, 80),
      shippedAt: text(record.shippedAt, 64),
      receivedAt: text(record.receivedAt, 64),
      escrowKey: text(record.escrowKey, 64),
      tossDeliveryId: text(record.tossDeliveryId, 64),
      revision: record.revision,
      paymentKey: text(record.paymentKey, 200),
      recipientName: text(record.recipientName, 100),
    });
  }
  return jobs;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get('authorization');
  const expected = Buffer.from(secret || '');
  const actual = Buffer.from(authorization?.startsWith('Bearer ') ? authorization.slice(7) : '');
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return Response.json({ ok: false }, { status: 401, headers });
  }
  const run = startCronRun('toss-escrow');
  try {
    const secretKey = tossEscrowSecretKey();
    if (!secretKey) return run.finish(Response.json({ ok: true, configured: false, jobs: 0 }, { headers }));
    const service = createServiceClient();
    const { data, error } = await service.rpc('service_claim_toss_escrow_jobs', { p_limit: BATCH_LIMIT });
    const jobs = error ? null : parseJobs(data);
    if (!jobs) throw new Error('escrow_jobs_unavailable');
    const worker = createTossEscrowWorker({ secretKey });
    const counts = { jobs: jobs.length, registered: 0, statusChecked: 0, skipped: 0, manualRequired: 0, retry: 0, recordFailed: 0, deferred: 0 };
    const started = Date.now();
    for (const job of jobs) {
      if (Date.now() - started > START_BUDGET_MS) { counts.deferred += 1; continue; }
      const result = await worker.process(job);
      if (result.outcome === 'registered') counts.registered += 1;
      else if (result.outcome === 'status_only') counts.statusChecked += 1;
      else if (result.outcome === 'skipped') counts.skipped += 1;
      else if (result.outcome === 'manual_required') counts.manualRequired += 1;
      else counts.retry += 1;
      const { error: finishError } = await service.rpc('service_finish_toss_escrow_job', {
        p_order_id: job.orderId,
        p_revision: job.revision,
        p_outcome: result.outcome,
        p_escrow_key: result.escrowKey ?? null,
        p_toss_delivery_id: result.tossDeliveryId ?? null,
        p_escrow_status: result.escrowStatus ?? null,
        p_error_code: result.errorCode ?? null,
      });
      if (finishError) counts.recordFailed += 1;
      if (result.outcome === 'manual_required') {
        console.error('[cron/toss-escrow] escrow delivery needs operator action', { orderId: job.orderId, code: result.errorCode ?? 'unknown' });
      }
    }
    const ok = counts.recordFailed === 0;
    return run.finish(Response.json({ ok, configured: true, ...counts }, { status: ok ? 200 : 503, headers }));
  } catch (error) {
    return run.fail(error, Response.json({ ok: false }, { status: 503, headers }));
  }
}
