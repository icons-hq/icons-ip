import 'server-only';

import { createServiceClient } from '@/lib/supabase/service';

export interface CronRunRecord {
  readonly job: string;
  readonly label: string;
  readonly intervalMinutes: number;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly ok: boolean;
  readonly statusCode: number;
  readonly errorCode: string | null;
  readonly detail: Record<string, unknown>;
}

/** 기록이 늦어져도 cron 응답이 묶이지 않게 짧게 끊는다. */
const RECORD_TIMEOUT_MS = 3000;

/**
 * cron 실행 한 번을 DB에 남긴다(service_role 전용 RPC). 새 사건(같은 작업의 그 시간 첫 실패)이면 `incident: true`.
 * 기록하지 못하면 null — 호출부가 로그만 남기고 응답은 그대로 둔다.
 */
export async function recordCronJobRun(record: CronRunRecord): Promise<{ incident: boolean } | null> {
  try {
    const { data, error } = await createServiceClient()
      .rpc('service_record_system_job_run', {
        p_job: record.job,
        p_label: record.label,
        p_expected_interval_minutes: record.intervalMinutes,
        p_started_at: record.startedAt,
        p_finished_at: record.finishedAt,
        p_ok: record.ok,
        p_status_code: record.statusCode,
        p_error_code: record.errorCode,
        p_detail: record.detail,
      })
      .abortSignal(AbortSignal.timeout(RECORD_TIMEOUT_MS));
    if (error || !data || typeof data !== 'object') return null;
    return { incident: (data as { incident?: unknown }).incident === true };
  } catch {
    return null;
  }
}
