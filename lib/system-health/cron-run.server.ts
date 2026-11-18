import 'server-only';

import { notifySystemIncident } from './alert-sink.server';
import { CRON_JOBS, type CronJobKey } from './cron-jobs';
import { recordCronJobRun } from './cron-run-recorder.server';

/*
 * Vercel cron 라우트 공통 실행 기록(원장 OPS-039·OPS-040).
 *
 * 라우트는 인증을 통과한 뒤 `startCronRun(작업)`을 열고, 돌려줄 응답을 `run.finish(응답)`에, 잡은 예외는 `run.fail(예외, 응답)`에
 * 넘긴다. 응답은 받은 그대로 돌려준다(상태 코드·본문 계약을 바꾸지 않는다). 5xx 응답·예외는 실패로 남기고 구조화된
 * console.error를 찍는다. 인증 실패(401)는 남기지 않는다 — 바깥 요청이 기록을 채우지 못하게 한다.
 *
 * 남기는 것: 작업 이름, 시작·종료 시각, 성공/실패, 상태 코드, 오류 코드(형식이 정해진 짧은 코드), 상세(응답 본문 맨 위의
 * 숫자·참거짓과 단계 이름 배열). 오류 메시지 원문·문자열 값은 남기지 않는다 — 비밀·개인정보가 섞일 수 있어서다.
 */

const ERROR_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;
const SNAKE_CODE = /^[a-z][a-z0-9_]{2,60}$/;
const STAGE_NAME = /^[a-z][A-Za-z0-9_]{0,40}$/;
const SQLSTATE = /^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/;
const ERROR_NAME = /^[A-Za-z][A-Za-z0-9]{0,40}$/;

/** 예외에서 남겨도 되는 코드만 고른다: DB 코드(SQLSTATE·PGRST), 앱이 던진 snake_case 코드 메시지, 오류 이름. */
export function cronErrorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const { code, message, name } = error as { code?: unknown; message?: unknown; name?: unknown };
    if (typeof code === 'string' && SQLSTATE.test(code)) return `db:${code}`;
    if (typeof message === 'string' && SNAKE_CODE.test(message)) return message;
    if (typeof name === 'string' && ERROR_NAME.test(name)) return `exception:${name}`;
  }
  return 'exception';
}

/** 실패 응답 본문의 맨 위 숫자·참거짓·단계 이름 배열만 상세로, 형식이 맞는 `error` 필드는 오류 코드로 쓴다. */
export function cronResponseDetail(body: unknown): { detail: Record<string, number | boolean | string[]>; errorCode: string | null } {
  const detail: Record<string, number | boolean | string[]> = {};
  let errorCode: string | null = null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { detail, errorCode };
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (Object.keys(detail).length >= 20 || !/^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(key) || key === 'ok') continue;
    if (key === 'error') {
      if (typeof value === 'string' && SNAKE_CODE.test(value)) errorCode = value;
      continue;
    }
    if ((typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean') detail[key] = value;
    else if (Array.isArray(value) && value.length <= 10 && value.every(item => typeof item === 'string' && STAGE_NAME.test(item))) {
      detail[key] = value as string[];
    }
  }
  return { detail, errorCode };
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}

export interface CronRun {
  /** 라우트가 돌려줄 응답을 그대로 돌려준다. 5xx면 실패로 남긴다. */
  finish(response: Response): Promise<Response>;
  /** 잡은 예외를 남기고(오류 코드만) 받은 실패 응답을 그대로 돌려준다. */
  fail(error: unknown, response: Response): Promise<Response>;
}

interface CronRunDependencies {
  readonly now?: () => Date;
  readonly record?: typeof recordCronJobRun;
  readonly notify?: typeof notifySystemIncident;
}

export function startCronRun(job: CronJobKey, dependencies: CronRunDependencies = {}): CronRun {
  const now = dependencies.now ?? (() => new Date());
  const record = dependencies.record ?? recordCronJobRun;
  const notify = dependencies.notify ?? notifySystemIncident;
  const definition = CRON_JOBS[job];
  const startedAt = now();

  async function complete(response: Response, failure: { errorCode: string; detail: Record<string, unknown> } | null) {
    const finishedAt = now();
    const ok = failure === null;
    const errorCode = failure && ERROR_CODE.test(failure.errorCode) ? failure.errorCode : failure ? 'exception' : null;
    if (!ok) {
      console.error('[cron] job failed', {
        job, status: response.status, errorCode, durationMs: finishedAt.getTime() - startedAt.getTime(), ...failure?.detail,
      });
    }
    try {
      const recorded = await record({
        job, label: definition.label, intervalMinutes: definition.intervalMinutes,
        startedAt: startedAt.toISOString(), finishedAt: finishedAt.toISOString(),
        ok, statusCode: response.status, errorCode, detail: failure?.detail ?? {},
      });
      if (!recorded) console.error('[cron] run record failed', { job });
      else if (recorded.incident && errorCode) {
        notify({ kind: 'cron_failure', job, label: definition.label, statusCode: response.status, errorCode, occurredAt: finishedAt.toISOString() });
      }
    } catch {
      console.error('[cron] run record failed', { job });
    }
    return response;
  }

  return {
    async finish(response) {
      if (response.status < 500) return complete(response, null);
      const { detail, errorCode } = cronResponseDetail(await responseBody(response));
      return complete(response, { errorCode: errorCode ?? 'unhealthy_result', detail });
    },
    fail(error, response) {
      return complete(response, { errorCode: cronErrorCode(error), detail: {} });
    },
  };
}
