import { describe, expect, it } from 'vitest';

import {
  describeRun,
  evaluateRun,
  latestBranchRun,
  summarizeOutcome,
  waitForBranchDeployment,
} from './wait-supabase-branch-deployment.mjs';

const BRANCH_ID = '303a4316-08f8-40a4-a2c7-b1ba2efdc010';
const PROJECT_REF = 'lamdudqlahshagomswjs';
const PARENT_REF = 'glwypjldklwpgdtymktm';

function run(steps, { id = PROJECT_REF, branchId = BRANCH_ID, createdAt = '2026-10-28T09:04:11.881386+00:00' } = {}) {
  return {
    id,
    branch_id: branchId,
    created_at: createdAt,
    run_steps: Object.entries(steps).map(([name, status]) => ({ name, status })),
  };
}

const env = {
  SUPABASE_ACCESS_TOKEN: 'token',
  SUPABASE_PREVIEW_PROJECT_ID: PARENT_REF,
  BRANCH_NAME: 'pr-595',
  BRANCH_ID,
  PROJECT_REF,
  WAIT_TIMEOUT_SECONDS: '60',
  POLL_INTERVAL_SECONDS: '5',
};

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/* parent의 branch 목록. 다른 branch 행이 섞여 있어도 id로 고른다. */
function branchList(fields) {
  return jsonResponse(200, [
    { id: 'other-branch', name: 'pr-1', status: 'MIGRATIONS_FAILED', preview_project_status: 'INACTIVE' },
    { id: BRANCH_ID, name: 'pr-595', ...fields },
  ]);
}

/* 응답을 path별 큐로 돌려주고 sleep은 가짜 시계만 전진시킨다. */
function harness(responses) {
  let clock = 0;
  const calls = [];
  const logs = [];
  return {
    calls,
    logs,
    options: {
      env,
      now: () => clock,
      sleep: async (ms) => { clock += ms; },
      log: (line) => logs.push(line),
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        const key = url.includes('/actions') ? 'actions' : 'branch';
        const queue = responses[key];
        const next = queue.length > 1 ? queue.shift() : queue[0];
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
}

describe('Supabase platform branch deployment wait', () => {
  it('selects the newest run of the requested branch only', () => {
    const older = run({ migrate: 'DEAD' }, { createdAt: '2026-10-28T09:04:11.881386+00:00' });
    const newer = run({ migrate: 'RUNNING' }, { createdAt: '2026-10-28T09:05:00.000000+00:00' });
    const other = run({ migrate: 'EXITED' }, {
      branchId: 'other-branch',
      createdAt: '2026-10-28T10:00:00.000000+00:00',
    });

    expect(latestBranchRun([older, other, newer], BRANCH_ID)).toBe(newer);
    expect(latestBranchRun([other], BRANCH_ID)).toBeNull();
    expect(() => latestBranchRun({}, BRANCH_ID)).toThrow('did not return an array');
  });

  it('keeps waiting until migrate and every running step have settled', () => {
    expect(evaluateRun(null)).toEqual({ finished: false });
    // 2026-10-28 pr-595 run 생성 직후: pull은 아직 목록에 없다.
    expect(evaluateRun(run({ configure: 'RUNNING', deploy: 'EXITED', migrate: 'CREATED' })))
      .toEqual({ finished: false });
    expect(evaluateRun(run({ pull: 'EXITED', migrate: 'RUNNING', deploy: 'EXITED' })))
      .toEqual({ finished: false });
    expect(evaluateRun(run({ pull: 'EXITED', migrate: 'EXITED', seed: 'CREATED' })))
      .toEqual({ finished: false });
    expect(evaluateRun(run({ pull: 'EXITED', migrate: 'DEAD', configure: 'RUNNING' })))
      .toEqual({ finished: false });
    expect(evaluateRun(run({ pull: 'EXITED', migrate: 'RESTARTING' })))
      .toEqual({ finished: false });
    expect(evaluateRun(run({ pull: 'EXITED', migrate: 'SOMETHING_NEW' })))
      .toEqual({ finished: false });
    // 함수 배포가 죽어도 migrate가 아직 남아 있으면 끝난 것이 아니다.
    expect(evaluateRun(run({ deploy: 'DEAD', migrate: 'CREATED' }))).toEqual({ finished: false });
    expect(evaluateRun(run({ deploy: 'EXITED' }))).toEqual({ finished: false });
  });

  it('finishes on success, warning, failure, and an upstream failure', () => {
    expect(evaluateRun(run({ pull: 'EXITED', migrate: 'EXITED', configure: 'EXITED', deploy: 'EXITED' })))
      .toEqual({ finished: true, migrate: 'EXITED', deadSteps: [] });
    expect(evaluateRun(run({ pull: 'EXITED', health: 'PAUSED', migrate: 'PAUSED' })))
      .toEqual({ finished: true, migrate: 'PAUSED', deadSteps: [] });
    // pr-435·pr-553·pr-595·pr-596·staging에서 관측된 최종 모양.
    expect(evaluateRun(run({ configure: 'EXITED', deploy: 'EXITED', migrate: 'DEAD', pull: 'EXITED' })))
      .toEqual({ finished: true, migrate: 'DEAD', deadSteps: ['migrate'] });
    expect(evaluateRun(run({ pull: 'EXITED', migrate: 'DEAD', seed: 'CREATED' })))
      .toEqual({ finished: true, migrate: 'DEAD', deadSteps: ['migrate'] });
    expect(evaluateRun(run({ pull: 'DEAD', migrate: 'CREATED', seed: 'CREATED', deploy: 'EXITED' })))
      .toEqual({ finished: true, migrate: 'NOT_RUN', deadSteps: ['pull'] });
  });

  it('describes steps in workflow order', () => {
    expect(describeRun(null)).toBe('run=pending');
    expect(describeRun(run({ deploy: 'EXITED', migrate: 'DEAD', configure: 'EXITED', pull: 'EXITED' })))
      .toBe(`run=${PROJECT_REF} pull=EXITED configure=EXITED migrate=DEAD deploy=EXITED`);
  });

  it('polls both endpoints and logs each state transition once', async () => {
    const branch = branchList({ status: 'RUNNING_MIGRATIONS', preview_project_status: 'ACTIVE_HEALTHY' });
    const { calls, logs, options } = harness({
      branch: [branch],
      actions: [
        jsonResponse(200, []),
        jsonResponse(200, [run({ configure: 'EXITED', deploy: 'EXITED', migrate: 'CREATED' })]),
        jsonResponse(200, [run({ configure: 'EXITED', deploy: 'EXITED', migrate: 'CREATED' })]),
        jsonResponse(200, [run({ configure: 'EXITED', deploy: 'EXITED', migrate: 'DEAD', pull: 'EXITED' })]),
      ],
    });

    const outcome = await waitForBranchDeployment(options);

    expect(outcome).toMatchObject({ finished: true, migrate: 'DEAD', deadSteps: ['migrate'], elapsedSeconds: 15 });
    expect(logs).toEqual([
      '[+0s] pr-595 status=RUNNING_MIGRATIONS project=ACTIVE_HEALTHY run=pending',
      `[+5s] pr-595 status=RUNNING_MIGRATIONS project=ACTIVE_HEALTHY run=${PROJECT_REF} configure=EXITED migrate=CREATED deploy=EXITED`,
      `[+15s] pr-595 status=RUNNING_MIGRATIONS project=ACTIVE_HEALTHY run=${PROJECT_REF} pull=EXITED configure=EXITED migrate=DEAD deploy=EXITED`,
    ]);
    expect(calls.map((call) => call.url)).toContain(
      `https://api.supabase.com/v1/projects/${PARENT_REF}/branches`,
    );
    expect(calls.map((call) => call.url)).toContain(
      `https://api.supabase.com/v1/projects/${PROJECT_REF}/actions`,
    );
    expect(calls.every((call) => call.init.headers.Authorization === 'Bearer token')).toBe(true);
  });

  it('retries transient API failures but stops on permission errors', async () => {
    const branch = branchList({ status: 'FUNCTIONS_DEPLOYED', preview_project_status: 'ACTIVE_HEALTHY' });
    const transient = harness({
      branch: [branch],
      actions: [
        jsonResponse(500, { message: 'FGA Authentication Error' }),
        jsonResponse(500, { message: 'FGA Authentication Error' }),
        new Error('socket hang up'),
        jsonResponse(200, [run({ pull: 'EXITED', migrate: 'EXITED', configure: 'EXITED', deploy: 'EXITED' })]),
      ],
    });
    await expect(waitForBranchDeployment(transient.options)).resolves.toMatchObject({ migrate: 'EXITED' });
    expect(transient.logs.filter((line) => line.startsWith('Retrying'))).toEqual([
      `Retrying after Supabase API error: GET /projects/${PROJECT_REF}/actions: HTTP 500 FGA Authentication Error`,
      'Retrying after Supabase API error: socket hang up',
    ]);

    const forbidden = harness({ branch: [branch], actions: [jsonResponse(403, { message: 'Forbidden' })] });
    await expect(waitForBranchDeployment(forbidden.options)).rejects.toThrow(
      `GET /projects/${PROJECT_REF}/actions: HTTP 403 Forbidden`,
    );
  });

  it('fails closed with the last observed state when the run never settles', async () => {
    const { options } = harness({
      branch: [branchList({ status: 'RUNNING_MIGRATIONS', preview_project_status: 'ACTIVE_HEALTHY' })],
      actions: [jsonResponse(200, [run({ pull: 'EXITED', migrate: 'RUNNING' })])],
    });

    await expect(waitForBranchDeployment(options)).rejects.toThrow(
      `pr-595 platform deployment did not finish within 60s (last state: status=RUNNING_MIGRATIONS `
      + `project=ACTIVE_HEALTHY run=${PROJECT_REF} pull=EXITED migrate=RUNNING)`,
    );
  });

  it('rejects missing or unsafe inputs before calling the API', async () => {
    const { calls, options } = harness({ branch: [jsonResponse(200, {})], actions: [jsonResponse(200, [])] });

    await expect(waitForBranchDeployment({ ...options, env: { ...env, BRANCH_ID: '' } }))
      .rejects.toThrow('BRANCH_ID is required');
    await expect(waitForBranchDeployment({ ...options, env: { ...env, PROJECT_REF: 'Not-A-Ref' } }))
      .rejects.toThrow('PROJECT_REF must be');
    await expect(waitForBranchDeployment({ ...options, env: { ...env, WAIT_TIMEOUT_SECONDS: '0' } }))
      .rejects.toThrow('WAIT_TIMEOUT_SECONDS must be a positive number');
    expect(calls).toEqual([]);
  });

  it('summarizes how db push continues from the platform result', () => {
    const outcome = {
      migrate: 'DEAD',
      elapsedSeconds: 14,
      run: run({ configure: 'EXITED', deploy: 'EXITED', migrate: 'DEAD', pull: 'EXITED' }),
    };

    const dead = summarizeOutcome({ branchName: 'pr-595', outcome });
    expect(dead).toContain(
      `- \`pr-595\` run=${PROJECT_REF} pull=EXITED configure=EXITED migrate=DEAD deploy=EXITED (대기 14초)`,
    );
    expect(dead).toContain('실패 직전까지의 온전한 앞부분이다. 이어지는 `db push`가 기록된 이력 다음부터 나머지를 적용한다.');
    expect(dead).toContain('View logs');

    const exited = summarizeOutcome({ branchName: 'pr-595', outcome: { ...outcome, migrate: 'EXITED' } });
    expect(exited).toContain('parent의 migration 이력을 플랫폼이 적용했다.');
    expect(exited).not.toContain('View logs');
    expect(summarizeOutcome({ branchName: 'pr-595', outcome: { ...outcome, migrate: 'PAUSED' } }))
      .toContain('경고와 함께 끝났거나 건너뛰었다.');
  });
});
