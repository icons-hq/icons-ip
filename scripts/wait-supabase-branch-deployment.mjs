/*
 * 새 Supabase Preview Branch에서 플랫폼 배포 run이 끝날 때까지 기다린다.
 *
 * git 연결 없이 CLI·API로 만든 branch는 parent 프로젝트의 migration 이력을 읽어 각 항목을
 * migration으로 다시 적용한다(Supabase Branching via the dashboard, "Where a dashboard
 * branch gets its schema"). 이 run이 도는 중에 workflow가 `supabase db push`를 실행하면 두
 * 쪽이 같은 migration을 동시에 적용해 한쪽이 실패한다 — 2026-10-28 PR #596 run 40663501000은
 * CLI가 이력 18개를 읽은 직후 플랫폼이 19번째를 먼저 커밋해 42883으로 멈췄다. 그래서 run의
 * migrate가 끝난 뒤에만 push한다. Branch의 `status` 필드는 Management API에서 deprecated이고
 * action run 목록이 대체 경로라, 완료 판정은 run 단계 상태로 하고 `status`는 로그에만 남긴다.
 *
 * 사용법 (환경변수로 받는다):
 *   SUPABASE_ACCESS_TOKEN        필수. Management API PAT.
 *   SUPABASE_PREVIEW_PROJECT_ID  필수. parent preview 프로젝트 ref.
 *   BRANCH_NAME                  필수. 기다릴 branch 이름.
 *   BRANCH_ID                    필수. 다른 branch의 run을 섞지 않도록 run을 거르는 branch id.
 *   PROJECT_REF                  필수. branch 프로젝트 ref.
 *   WAIT_TIMEOUT_SECONDS         선택. 기본 900.
 *   POLL_INTERVAL_SECONDS        선택. 기본 5.
 *   GITHUB_STEP_SUMMARY          있으면 결과를 job summary에 덧붙인다.
 */

import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const API_ROOT = 'https://api.supabase.com/v1';
const PROJECT_REF_PATTERN = /^[a-z]{20}$/;
const STEP_ORDER = ['clone', 'pull', 'health', 'configure', 'migrate', 'seed', 'deploy'];
// 문서의 단계 상태: EXITED 성공, PAUSED 경고·의도적 skip(뒤 단계는 계속), DEAD 실패.
const FINISHED_STATUSES = new Set(['EXITED', 'PAUSED', 'DEAD']);
const UPSTREAM_OF_MIGRATE = new Set(['clone', 'pull']);

export function latestBranchRun(runs, branchId) {
  if (!Array.isArray(runs)) throw new Error('Supabase action run list did not return an array');
  return runs
    .filter((run) => run?.branch_id === branchId && Array.isArray(run.run_steps))
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))[0] ?? null;
}

function stepRank(step) {
  const index = STEP_ORDER.indexOf(step.name);
  return index === -1 ? STEP_ORDER.length : index;
}

export function describeRun(run) {
  if (!run) return 'run=pending';
  const steps = [...run.run_steps]
    .sort((left, right) => stepRank(left) - stepRank(right))
    .map((step) => `${step.name}=${step.status}`);
  return `run=${run.id} ${steps.join(' ')}`;
}

/*
 * DB를 쓰는 단계는 migrate(그리고 있다면 뒤따르는 seed)라서 migrate가 끝나고 진행 중인 단계가
 * 없을 때 run이 끝났다고 본다. DEAD 단계에 의존하는 단계는 실행되지 않고 CREATED로 남으므로
 * migrate가 DEAD면 CREATED를 기다리지 않는다. migrate가 시작도 못 한 채 선행 단계가 죽으면
 * `NOT_RUN`으로 끝낸다. 모르는 상태 값은 끝나지 않은 것으로 보고 timeout으로 드러낸다.
 */
export function evaluateRun(run) {
  const steps = run?.run_steps ?? [];
  const migrate = steps.find((step) => step.name === 'migrate');
  if (!migrate) return { finished: false };
  const deadSteps = steps.filter((step) => step.status === 'DEAD').map((step) => step.name);
  const unfinished = steps.filter((step) => !FINISHED_STATUSES.has(step.status));
  const result = (migrateStatus) => ({ finished: true, migrate: migrateStatus, deadSteps });

  if (migrate.status === 'CREATED') {
    const upstreamDead = deadSteps.some((name) => UPSTREAM_OF_MIGRATE.has(name));
    const othersSettled = unfinished.every((step) => step.status === 'CREATED');
    return upstreamDead && othersSettled ? result('NOT_RUN') : { finished: false };
  }
  if (!FINISHED_STATUSES.has(migrate.status)) return { finished: false };
  if (migrate.status === 'DEAD') {
    return unfinished.every((step) => step.status === 'CREATED')
      ? result('DEAD')
      : { finished: false };
  }
  return unfinished.length === 0 ? result(migrate.status) : { finished: false };
}

class PermanentApiError extends Error {}

async function readJson({ fetchImpl, token, path }) {
  const response = await fetchImpl(`${API_ROOT}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await response.json().catch(() => null);
  if (response.ok) return body;
  const message = body?.message ?? body?.error ?? 'unknown error';
  const detail = `GET ${path}: HTTP ${response.status} ${message}`;
  // 권한 오류는 기다려도 풀리지 않는다. 그 밖의 4xx·5xx·429는 생성 직후 일시 응답으로 보고 재시도한다.
  if (response.status === 401 || response.status === 403) throw new PermanentApiError(detail);
  throw new Error(detail);
}

function requireEnv(env, name) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveSeconds(env, name, fallback) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
}

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitForBranchDeployment({
  env = process.env,
  fetchImpl = fetch,
  sleep = defaultSleep,
  now = Date.now,
  log = console.log,
} = {}) {
  const token = requireEnv(env, 'SUPABASE_ACCESS_TOKEN');
  const parentRef = requireEnv(env, 'SUPABASE_PREVIEW_PROJECT_ID');
  const branchName = requireEnv(env, 'BRANCH_NAME');
  const branchId = requireEnv(env, 'BRANCH_ID');
  const projectRef = requireEnv(env, 'PROJECT_REF');
  if (!PROJECT_REF_PATTERN.test(projectRef)) {
    throw new Error('PROJECT_REF must be a 20-character lowercase Supabase project ref');
  }
  const timeoutSeconds = positiveSeconds(env, 'WAIT_TIMEOUT_SECONDS', 900);
  const pollMs = positiveSeconds(env, 'POLL_INTERVAL_SECONDS', 5) * 1000;

  const startedAt = now();
  const deadline = startedAt + timeoutSeconds * 1000;
  let previousState = '';
  let previousError = '';
  for (;;) {
    let state;
    let run = null;
    try {
      // 단건 조회 응답에는 preview_project_status가 없어 목록에서 id로 고른다.
      const [branches, runs] = await Promise.all([
        readJson({ fetchImpl, token, path: `/projects/${parentRef}/branches` }),
        readJson({ fetchImpl, token, path: `/projects/${projectRef}/actions` }),
      ]);
      const branch = Array.isArray(branches)
        ? branches.find((entry) => entry?.id === branchId)
        : undefined;
      run = latestBranchRun(runs, branchId);
      state = `status=${branch?.status ?? '?'} project=${branch?.preview_project_status ?? '?'} `
        + describeRun(run);
      previousError = '';
    } catch (error) {
      if (error instanceof PermanentApiError) throw error;
      state = previousState;
      if (error.message !== previousError) log(`Retrying after Supabase API error: ${error.message}`);
      previousError = error.message;
    }

    const elapsedSeconds = Math.round((now() - startedAt) / 1000);
    if (state && state !== previousState) {
      log(`[+${elapsedSeconds}s] ${branchName} ${state}`);
      previousState = state;
    }
    const outcome = evaluateRun(run);
    if (outcome.finished) {
      return { ...outcome, run, elapsedSeconds, state };
    }
    if (now() >= deadline) {
      throw new Error(
        `${branchName} platform deployment did not finish within ${timeoutSeconds}s `
        + `(last state: ${previousState || 'unavailable'})`,
      );
    }
    await sleep(pollMs);
  }
}

const MIGRATE_OUTCOME = {
  EXITED: 'parent의 migration 이력을 플랫폼이 적용했다.',
  PAUSED: '플랫폼 migrate가 경고와 함께 끝났거나 건너뛰었다.',
  DEAD: '플랫폼 migrate가 실패했다. migration마다 이력 행과 한 트랜잭션으로 커밋되므로 남은 이력은 '
    + '실패 직전까지의 온전한 앞부분이다.',
  NOT_RUN: '선행 단계가 실패해 플랫폼 migrate가 실행되지 않았다.',
};

export function summarizeOutcome({ branchName, outcome }) {
  const lines = [
    '### Supabase 플랫폼 branch 배포',
    '',
    `- \`${branchName}\` ${describeRun(outcome.run)} (대기 ${outcome.elapsedSeconds}초)`,
    `- 플랫폼 migrate ${outcome.migrate}: ${MIGRATE_OUTCOME[outcome.migrate]} `
      + '이어지는 `db push`가 기록된 이력 다음부터 나머지를 적용한다.',
  ];
  if (outcome.migrate === 'DEAD' || outcome.migrate === 'NOT_RUN') {
    // 저장소가 public이라 형식이 계약되지 않은 플랫폼 로그는 Actions에 옮기지 않는다.
    lines.push('- 플랫폼 쪽 원인은 Supabase 대시보드 Branches의 View logs에서 본다.');
  }
  return `${lines.join('\n')}\n`;
}

async function main({ env = process.env, fetchImpl = fetch, log = console.log } = {}) {
  const outcome = await waitForBranchDeployment({ env, fetchImpl, log });
  const branchName = env.BRANCH_NAME;
  log(
    `Supabase platform deployment for ${branchName} finished after ${outcome.elapsedSeconds}s: `
    + `migrate=${outcome.migrate}`,
  );
  if (outcome.migrate === 'DEAD' || outcome.migrate === 'NOT_RUN') {
    log(
      `::warning title=Supabase platform migrate did not complete::${branchName} migrate=${outcome.migrate}; `
      + 'db push continues from the recorded migration history',
    );
  }
  if (env.GITHUB_STEP_SUMMARY) {
    await appendFile(env.GITHUB_STEP_SUMMARY, summarizeOutcome({ branchName, outcome }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`::error title=Supabase platform deployment wait failed::${error.message}`);
    process.exit(1);
  });
}
