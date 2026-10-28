import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';
import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const pipeline = yaml.load(
  await readFile(new URL('../.github/workflows/pipeline.yml', import.meta.url), 'utf8'),
);
const { jobs } = pipeline;
const planSteps = jobs['validate-plan'].steps;
const stepNamed = (job, name) => jobs[job].steps.find((step) => step.name === name);
const reuse = stepNamed('validate-plan', 'Reuse validation of the identical tree');
const fullValidation = "needs.validate-plan.outputs.reuse_hit != 'true'";
const checkJobs = ['validate-app', 'validate-db'];
const evidenceEvents = "github.event_name == 'pull_request' || github.event_name == 'merge_group'";
const repositoryId = '1271792989';

// 실제 step 스크립트를 가짜 GitHub API(curl shim) 위에서 실행한다.
const fakeCurl = `#!/usr/bin/env bash
url="\${@: -1}"
case "$url" in
  */actions/artifacts\\?name=validated-tree-*) file=artifacts ;;
  */actions/runs/*/jobs\\?*) id="\${url##*/runs/}"; file="jobs-\${id%%/jobs*}" ;;
  */actions/runs/*) file="run-\${url##*/runs/}" ;;
  *) exit 22 ;;
esac
[ -f "$FAKE_API_DIR/$file.json" ] || exit 22
cat "$FAKE_API_DIR/$file.json"
`;

const temporaryDirectories = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function workflowRun(id, overrides = {}) {
  return {
    id,
    event: 'pull_request',
    path: '.github/workflows/pipeline.yml',
    html_url: `https://github.com/icons-hq/icons-ip/actions/runs/${id}`,
    repository: { id: Number(repositoryId) },
    head_repository: { id: Number(repositoryId) },
    ...overrides,
  };
}

function temporaryDirectory(prefix) {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function runReuse(api) {
  const directory = temporaryDirectory('validation-reuse-');
  const curl = path.join(directory, 'curl');
  writeFileSync(curl, fakeCurl);
  chmodSync(curl, 0o755);
  for (const [file, body] of Object.entries(api)) {
    writeFileSync(path.join(directory, `${file}.json`), JSON.stringify(body));
  }
  const output = path.join(directory, 'output');
  const summary = path.join(directory, 'summary');
  writeFileSync(output, '');
  writeFileSync(summary, '');

  const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', reuse.run], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      FAKE_API_DIR: directory,
      GH_TOKEN: 'test-token',
      GITHUB_REPOSITORY: 'icons-hq/icons-ip',
      GITHUB_REPOSITORY_ID: repositoryId,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
    },
  });
  const hits = readFileSync(output, 'utf8').match(/^hit=.*$/gm) ?? [];
  return {
    status: result.status,
    stdout: result.stdout,
    hit: hits.at(-1),
    hitLines: hits.length,
    summary: readFileSync(summary, 'utf8'),
  };
}

function requireEveryValidationJob(results) {
  const directory = temporaryDirectory('validation-gate-');
  const summary = path.join(directory, 'summary');
  writeFileSync(summary, '');
  const result = spawnSync(
    'bash',
    ['--noprofile', '--norc', '-eo', 'pipefail', '-c', stepNamed('validate', 'Require every validation job').run],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PLAN_RESULT: 'success',
        REUSE_HIT: '',
        APP_RESULT: 'success',
        DB_RESULT: 'success',
        ...results,
        GITHUB_STEP_SUMMARY: summary,
      },
    },
  );
  return { status: result.status, stdout: result.stdout, summary: readFileSync(summary, 'utf8') };
}

describe('main validation reuse contract', () => {
  it('looks for evidence only on push to main, right after checkout', () => {
    expect(reuse.id).toBe('reuse');
    expect(reuse.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main'");
    expect(reuse.env).toEqual({ GH_TOKEN: '${{ github.token }}' });
    const checkout = stepNamed('validate-plan', 'Check out repository');
    expect(checkout.if).toBe(reuse.if);
    expect(planSteps.indexOf(reuse)).toBe(planSteps.indexOf(checkout) + 1);
    expect(planSteps.at(-1)).toBe(reuse);
    expect(jobs['validate-plan'].permissions).toEqual({ actions: 'read', contents: 'read' });
    expect(jobs['validate-plan'].outputs).toEqual({ reuse_hit: '${{ steps.reuse.outputs.hit }}' });
  });

  it('skips every check job only when evidence was found', () => {
    for (const name of checkJobs) {
      expect(jobs[name].needs, name).toBe('validate-plan');
      expect(jobs[name].if, name).toBe(fullValidation);
    }
    const checks = checkJobs.flatMap((name) => jobs[name].steps.map((step) => step.name));
    expect(checks).toEqual(expect.arrayContaining([
      'Run lint', 'Run TypeScript checks', 'Run tests', 'Build application',
      'Apply local migrations', 'Pause automatic order confirmation in the CI database',
      'Run database test shard', 'Lint local database',
    ]));
    expect(stepNamed('validate-app', 'Check admin guide changelog').if).toBe(
      "github.event_name == 'pull_request'",
    );
  });

  it('records the merge tree only after a PR or merge queue run passes every check job', () => {
    const validate = jobs.validate;
    const gate = stepNamed('validate', 'Require every validation job');
    const checkout = stepNamed('validate', 'Check out repository');
    const record = stepNamed('validate', 'Record validated tree');
    const upload = stepNamed('validate', 'Upload validated tree evidence');

    // main의 reuse step은 이 집계 job의 이름으로 증거 run을 판정한다.
    expect(validate.name).toBe('validate');
    expect(reuse.run).toContain('.name == "validate" and .conclusion == "success"');
    expect(validate.needs).toEqual(['validate-plan', ...checkJobs]);
    expect(validate.if).toBe('${{ !cancelled() }}');
    expect(validate.steps).toEqual([gate, checkout, record, upload]);
    expect(gate.env).toEqual({
      PLAN_RESULT: '${{ needs.validate-plan.result }}',
      REUSE_HIT: '${{ needs.validate-plan.outputs.reuse_hit }}',
      APP_RESULT: '${{ needs.validate-app.result }}',
      DB_RESULT: '${{ needs.validate-db.result }}',
    });
    for (const step of [checkout, record, upload]) {
      expect(step.if, step.name).toBe(evidenceEvents);
    }
    expect(record.run).toContain("git rev-parse 'HEAD^{tree}'");
    expect(record.run).toContain('VALIDATED_TREE=$tree');
    expect(upload.uses).toBe('actions/upload-artifact@v7');
    expect(upload.with).toMatchObject({
      name: 'validated-tree-${{ env.VALIDATED_TREE }}',
      'retention-days': 14,
      'if-no-files-found': 'error',
      overwrite: true,
    });
    expect(reuse.run).toContain('actions/artifacts?name=validated-tree-${tree}');
  });

  it('keeps main deployments running after reuse skips the check jobs', () => {
    const needsOf = (name) => [jobs[name].needs ?? []].flat();
    const isDownstream = (name) => needsOf(name).some((need) => checkJobs.includes(need) || isDownstream(need));
    // job if의 암묵적 success()는 skipped 간접 의존(재사용된 검사 job)까지 실패로 본다.
    const mainJobs = Object.keys(jobs).filter((name) => (
      isDownstream(name) && !String(jobs[name].if ?? '').includes("github.event_name == 'pull_request'")
    ));

    expect(mainJobs).toEqual(expect.arrayContaining([
      'validate', 'deploy-supabase', 'deploy-vercel', 'sync-supabase-preview-main', 'deploy-staging',
    ]));
    for (const name of mainJobs) {
      const condition = String(jobs[name].if ?? '');
      expect(condition, name).toMatch(/!cancelled\(\)|always\(\)/);
      if (name === 'validate') continue;
      for (const need of needsOf(name)) {
        expect(condition, `${name} -> ${need}`).toContain(`needs.${need}.result == 'success'`);
      }
    }
  });

  it('passes the aggregate only when every check job passed or main reuse skipped them', () => {
    expect(requireEveryValidationJob({}).status).toBe(0);
    const reused = requireEveryValidationJob({
      REUSE_HIT: 'true',
      APP_RESULT: 'skipped',
      DB_RESULT: 'skipped',
    });
    expect(reused.status).toBe(0);
    expect(reused.summary).toContain('Validation reused');

    for (const results of [
      { DB_RESULT: 'failure' },
      { APP_RESULT: 'failure' },
      { DB_RESULT: 'cancelled' },
      { APP_RESULT: 'skipped', DB_RESULT: 'skipped' },
      { PLAN_RESULT: 'failure', APP_RESULT: 'skipped', DB_RESULT: 'skipped' },
      { PLAN_RESULT: 'failure', REUSE_HIT: 'true' },
    ]) {
      expect(requireEveryValidationJob(results).status, JSON.stringify(results)).toBe(1);
    }
  });

  it('reuses only a same-repository PR or merge queue run whose latest validate passed', () => {
    const result = runReuse({
      artifacts: {
        artifacts: [
          { expired: false, workflow_run: { id: 11 } },
          { expired: false, workflow_run: { id: 12 } },
          { expired: false, workflow_run: { id: 13 } },
          { expired: true, workflow_run: { id: 14 } },
          { expired: false, workflow_run: { id: 15 } },
        ],
      },
      'run-11': workflowRun(11, { head_repository: { id: 42 } }),
      'run-12': workflowRun(12),
      'jobs-12': { jobs: [{ name: 'validate', conclusion: 'failure' }] },
      'run-13': workflowRun(13, { event: 'push' }),
      'jobs-13': { jobs: [{ name: 'validate', conclusion: 'success' }] },
      'run-14': workflowRun(14),
      'jobs-14': { jobs: [{ name: 'validate', conclusion: 'success' }] },
      'run-15': workflowRun(15, { event: 'merge_group' }),
      'jobs-15': { jobs: [{ name: 'validate', conclusion: 'success' }] },
    });

    expect(result.status).toBe(0);
    expect(result.hit).toBe('hit=true');
    expect(result.hitLines).toBe(1);
    expect(result.summary).toContain('merge_group run 15');
    expect(result.summary).toContain('actions/runs/15');
  });

  it('falls back to full validation without usable evidence', () => {
    const rejected = runReuse({
      artifacts: { artifacts: [{ expired: false, workflow_run: { id: 21 } }] },
      'run-21': workflowRun(21, { head_repository: { id: 42 } }),
      'jobs-21': { jobs: [{ name: 'validate', conclusion: 'success' }] },
    });
    const empty = runReuse({ artifacts: { artifacts: [] } });
    const unreachable = runReuse({});

    for (const result of [rejected, empty, unreachable]) {
      expect(result.status).toBe(0);
      expect(result.hit).toBe('hit=false');
      expect(result.hitLines).toBe(1);
      expect(result.summary).toContain('Full validation for tree');
    }
    expect(unreachable.stdout).toContain('Validation reuse lookup failed');
  });
});
