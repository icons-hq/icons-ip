import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';
import { isUuid } from '@/lib/uuid';
import { emailDispatcherFromEnvironment } from './dispatcher.server';
import type { DispatchOutcome, EmailDispatcher } from './dispatcher';
import { emailSiteUrl } from './site-url';
import { parseOpsAlertDigestContent, renderOpsAlertDigestEmail, type OpsAlertDigestJobContent } from './ops-alert-digest';

/*
 * 운영 알림 요약 메일 작업(OPS-095). 안전재고 요약 메일과 같은 durable dispatcher 흐름이다:
 * 선점(DB가 커서 뒤 새 알림·지연 문의를 요약 한 건으로 먼저 만든다) → intent 결속 → 발송 → 결과 기록.
 * 같은 요약·같은 주소는 (실행, 주소) 한 행이라 cron이 겹치거나 재시도해도 한 번만 나간다. 본문은 DB 요약 행에 고정돼 재시도에도 같다.
 */

export interface OpsAlertDigestJob extends OpsAlertDigestJobContent {
  id: string;
  claimToken: string;
  recipient: string;
}
export interface OpsAlertDigestOutcome {
  status: 'sent' | 'queued' | 'failed' | 'unknown' | 'suppressed';
  errorCode: string | null;
  retryable: boolean;
}
export interface OpsAlertDigestRepository {
  claim(): Promise<OpsAlertDigestJob[]>;
  bindIntent(id: string, claimToken: string, intentId: string): Promise<boolean>;
  finish(id: string, claimToken: string, outcome: OpsAlertDigestOutcome): Promise<boolean>;
}

export const OPS_ALERT_DIGEST_CONTENT_REVISION = 'ops_alert_digest_v1';

function outcome(result: DispatchOutcome): OpsAlertDigestOutcome {
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
export function parseOpsAlertDigestJob(value: unknown): OpsAlertDigestJob | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const content = parseOpsAlertDigestContent(row);
  if (!content || !isUuid(row.id) || !isUuid(row.claimToken) || typeof row.recipient !== 'string' || !row.recipient.includes('@')) return null;
  return { ...content, id: row.id, claimToken: row.claimToken, recipient: row.recipient };
}

type ClaimedRow = { id?: unknown; claimToken?: unknown };

function repositoryFromEnvironment(): OpsAlertDigestRepository & { malformed: ClaimedRow[] } {
  const service = createServiceClient();
  const malformed: ClaimedRow[] = [];
  return {
    malformed,
    async claim() {
      const { data, error } = await service.rpc('claim_ops_alert_digest_jobs', { batch_limit: 25 });
      if (error || !Array.isArray(data) || data.length > 25) throw new Error('ops_alert_digest_claim_failed');
      const jobs: OpsAlertDigestJob[] = [];
      for (const entry of data) {
        const job = parseOpsAlertDigestJob(entry);
        if (job) jobs.push(job);
        else malformed.push((entry && typeof entry === 'object' ? entry : {}) as ClaimedRow);
      }
      return jobs;
    },
    async bindIntent(id, claimToken, intentId) {
      const { data, error } = await service.rpc('bind_ops_alert_digest_intent', { target_id: id, target_claim: claimToken, target_intent: intentId });
      if (error || typeof data !== 'boolean') throw new Error('ops_alert_digest_bind_failed');
      return data;
    },
    async finish(id, claimToken, result) {
      const { data, error } = await service.rpc('finish_ops_alert_digest_job', {
        target_id: id, target_claim: claimToken, target_status: result.status, target_error: result.errorCode, target_retryable: result.retryable,
      });
      if (error || typeof data !== 'boolean') throw new Error('ops_alert_digest_finish_failed');
      return data;
    },
  };
}

/** 한 번의 cron 실행은 최대 25건을 선점하고 동시에 5건까지 공급사에 보낸다. 수신 주소·본문은 결과에 싣지 않는다. */
export async function processOpsAlertDigests(
  dependencies: { repository: OpsAlertDigestRepository & { malformed?: ClaimedRow[] }; dispatcher: EmailDispatcher | null } = {
    repository: repositoryFromEnvironment(),
    dispatcher: emailDispatcherFromEnvironment(),
  },
) {
  // 구성 확인을 선점보다 먼저 한다. 고친 뒤 작업이 그대로 남아 있게 한다.
  const siteUrl = emailSiteUrl();
  const jobs = await dependencies.repository.claim();
  const result = { claimed: jobs.length, sent: 0, queued: 0, failed: 0, unknown: 0, suppressed: 0, stale: 0 };
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
      let delivery: OpsAlertDigestOutcome;
      try {
        if (!dependencies.dispatcher) delivery = { status: 'failed', errorCode: 'provider_not_configured', retryable: true };
        else {
          const intent = await dependencies.dispatcher.enqueue({
            source: 'ops_alert_digest',
            sourceReference: job.id,
            recipient: job.recipient,
            messageKind: 'ops_alert_digest',
            contentRevision: OPS_ALERT_DIGEST_CONTENT_REVISION,
          });
          if (!await dependencies.repository.bindIntent(job.id, job.claimToken, intent.intentId)) { result.stale += 1; return; }
          delivery = outcome(await dependencies.dispatcher.dispatch({
            intentId: intent.intentId,
            recipient: job.recipient,
            message: renderOpsAlertDigestEmail(job, siteUrl),
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
