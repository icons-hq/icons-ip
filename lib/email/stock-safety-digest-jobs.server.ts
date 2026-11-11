import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';
import { isUuid } from '@/lib/uuid';
import { emailDispatcherFromEnvironment } from './dispatcher.server';
import type { DispatchOutcome, EmailDispatcher } from './dispatcher';
import { emailSiteUrl } from './site-url';
import { parseStockSafetyDigestItem, renderStockSafetyDigestEmail, type StockSafetyDigestJobContent } from './stock-safety-digest';

/*
 * 안전재고 하루 1회 요약 메일 작업(QNA-014). 주문 지연 안내와 같은 durable dispatcher 흐름이다:
 * 선점(그날 실행이 없으면 DB가 먼저 만든다) → intent 결속 → 발송 → 결과 기록.
 * 발송 내용(옵션 목록)과 수신 주소는 그날 실행에 고정돼 공급사 재시도에도 바뀌지 않는다.
 */

export interface StockSafetyDigestJob extends StockSafetyDigestJobContent {
  id: string;
  claimToken: string;
  recipient: string;
}
export interface StockSafetyDigestOutcome {
  status: 'sent' | 'queued' | 'failed' | 'unknown' | 'suppressed';
  errorCode: string | null;
  retryable: boolean;
}
export interface StockSafetyDigestRepository {
  claim(): Promise<StockSafetyDigestJob[]>;
  bindIntent(id: string, claimToken: string, intentId: string): Promise<boolean>;
  finish(id: string, claimToken: string, outcome: StockSafetyDigestOutcome): Promise<boolean>;
}

export const STOCK_SAFETY_DIGEST_CONTENT_REVISION = 'stock_safety_digest_v1';

function outcome(result: DispatchOutcome): StockSafetyDigestOutcome {
  if (result.state === 'suppressed') return { status: 'suppressed', errorCode: 'provider_suppressed', retryable: false };
  if (['bounced', 'complained', 'failed'].includes(result.state)) return { status: 'failed', errorCode: 'provider_rejected', retryable: false };
  if (['accepted', 'sent', 'delivered', 'delayed'].includes(result.state)) return { status: 'sent', errorCode: null, retryable: false };
  if (result.kind === 'skipped' && result.reason === 'disabled') return { status: 'failed', errorCode: 'delivery_disabled', retryable: true };
  if (result.kind === 'skipped' && result.reason === 'in_progress') return { status: 'queued', errorCode: 'delivery_in_progress', retryable: false };
  if (result.state === 'needs_review') return { status: 'unknown', errorCode: 'delivery_needs_review', retryable: false };
  if (result.state === 'unknown') return { status: 'unknown', errorCode: 'delivery_outcome_unknown', retryable: false };
  return { status: 'failed', errorCode: 'provider_retryable', retryable: true };
}

/** 선점 결과 한 건. 모양이 틀리면 null — 그 작업은 보내지 않고 결과 불명으로 끝낸다. */
export function parseStockSafetyDigestJob(value: unknown): StockSafetyDigestJob | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const originNames = Array.isArray(row.originNames) && row.originNames.every((name) => typeof name === 'string')
    ? row.originNames as string[] : null;
  if (!isUuid(row.id) || !isUuid(row.claimToken) || typeof row.recipient !== 'string' || !row.recipient.includes('@')
    || (row.audience !== 'operator' && row.audience !== 'origin') || originNames === null
    || (row.audience === 'origin') !== (originNames.length > 0)
    || typeof row.digestDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.digestDate)
    || typeof row.itemCount !== 'number' || !Number.isSafeInteger(row.itemCount) || row.itemCount < 1 || !Array.isArray(row.items)) return null;
  const items = row.items.map(parseStockSafetyDigestItem);
  if (!items.length || items.some((item) => !item)) return null;
  return { id: row.id, claimToken: row.claimToken, recipient: row.recipient, audience: row.audience, originNames,
    digestDate: row.digestDate, itemCount: row.itemCount, items: items as StockSafetyDigestJob['items'] };
}

type ClaimedRow = { id?: unknown; claimToken?: unknown };

function repositoryFromEnvironment(): StockSafetyDigestRepository & { malformed: ClaimedRow[] } {
  const service = createServiceClient();
  const malformed: ClaimedRow[] = [];
  return {
    malformed,
    async claim() {
      const { data, error } = await service.rpc('claim_stock_safety_digest_jobs', { batch_limit: 25 });
      if (error || !Array.isArray(data) || data.length > 25) throw new Error('stock_digest_claim_failed');
      const jobs: StockSafetyDigestJob[] = [];
      for (const entry of data) {
        const job = parseStockSafetyDigestJob(entry);
        if (job) jobs.push(job);
        else malformed.push((entry && typeof entry === 'object' ? entry : {}) as ClaimedRow);
      }
      return jobs;
    },
    async bindIntent(id, claimToken, intentId) {
      const { data, error } = await service.rpc('bind_stock_safety_digest_intent', { target_id: id, target_claim: claimToken, target_intent: intentId });
      if (error || typeof data !== 'boolean') throw new Error('stock_digest_bind_failed');
      return data;
    },
    async finish(id, claimToken, result) {
      const { data, error } = await service.rpc('finish_stock_safety_digest_job', {
        target_id: id, target_claim: claimToken, target_status: result.status, target_error: result.errorCode, target_retryable: result.retryable,
      });
      if (error || typeof data !== 'boolean') throw new Error('stock_digest_finish_failed');
      return data;
    },
  };
}

/** 한 번의 cron 실행은 최대 25건을 선점하고 동시에 5건까지 공급사에 보낸다. 수신 주소·본문은 결과에 싣지 않는다. */
export async function processStockSafetyDigests(
  dependencies: { repository: StockSafetyDigestRepository & { malformed?: ClaimedRow[] }; dispatcher: EmailDispatcher | null } = {
    repository: repositoryFromEnvironment(),
    dispatcher: emailDispatcherFromEnvironment(),
  },
) {
  // 구성 확인을 선점보다 먼저 한다. 고친 뒤 작업이 그대로 남아 있게 한다.
  const siteUrl = emailSiteUrl();
  const jobs = await dependencies.repository.claim();
  const result = { claimed: jobs.length, sent: 0, queued: 0, failed: 0, unknown: 0, suppressed: 0, stale: 0 };
  // 모양이 틀린 선점 결과는 보내지 않고 결과 불명으로 닫는다(다음 틱에 같은 내용을 다시 보내지 않는다).
  for (const row of dependencies.repository.malformed ?? []) {
    result.claimed += 1;
    try {
      if (isUuid(row.id) && isUuid(row.claimToken)
        && await dependencies.repository.finish(row.id, row.claimToken, { status: 'unknown', errorCode: 'delivery_needs_review', retryable: false })) result.unknown += 1;
      else result.stale += 1;
    } catch { result.stale += 1; }
  }
  for (let offset = 0; offset < jobs.length; offset += 5) {
    await Promise.all(jobs.slice(offset, offset + 5).map(async (job) => {
      let delivery: StockSafetyDigestOutcome;
      try {
        if (!dependencies.dispatcher) delivery = { status: 'failed', errorCode: 'provider_not_configured', retryable: true };
        else {
          const intent = await dependencies.dispatcher.enqueue({
            source: 'stock_safety_digest',
            sourceReference: job.id,
            recipient: job.recipient,
            messageKind: 'stock_safety_digest',
            contentRevision: STOCK_SAFETY_DIGEST_CONTENT_REVISION,
          });
          if (!await dependencies.repository.bindIntent(job.id, job.claimToken, intent.intentId)) { result.stale += 1; return; }
          delivery = outcome(await dependencies.dispatcher.dispatch({
            intentId: intent.intentId,
            recipient: job.recipient,
            message: renderStockSafetyDigestEmail(job, siteUrl),
          }));
        }
      } catch {
        delivery = { status: 'unknown', errorCode: 'delivery_outcome_unknown', retryable: false };
      }
      try {
        if (await dependencies.repository.finish(job.id, job.claimToken, delivery)) result[delivery.status] += 1;
        else result.stale += 1;
      } catch { result.stale += 1; }
    }));
  }
  return result;
}
