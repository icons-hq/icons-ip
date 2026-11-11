import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

const INSTALLER = './.github/actions/setup-supabase-cli';
const STEP_LIMIT_SECONDS = 5 * 60;

const workflows = await Promise.all(
  ['pipeline.yml', 'supabase-preview-cleanup.yml'].map(async (file) => ({
    file,
    workflow: yaml.load(
      await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8'),
    ),
  })),
);
const action = yaml.load(
  await readFile(new URL('../.github/actions/setup-supabase-cli/action.yml', import.meta.url), 'utf8'),
);
const installScript = action.runs.steps[0].run;

function installSteps() {
  return workflows.flatMap(({ file, workflow }) => Object.entries(workflow.jobs).flatMap(([id, job]) => (
    (job.steps ?? []).map((step, index) => ({ file, id, job, step, index }))
  )));
}

// 설치 script를 가짜 curl로 실행한다. 가짜 curl은 받은 인자를 기록하고 준비한 tarball을 --output에 쓴다.
function runInstaller({ reportedVersion = '2.109.1', sha256, curlExit = 0, env = {} } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'supabase-cli-install-'));
  const bin = path.join(root, 'bin');
  const payload = path.join(root, 'payload');
  const runnerTemp = path.join(root, 'runner-temp');
  for (const dir of [bin, payload, runnerTemp]) mkdirSync(dir);

  writeFileSync(path.join(payload, 'supabase'), `#!/bin/sh\necho ${reportedVersion}\n`);
  writeFileSync(path.join(payload, 'supabase-go'), '#!/bin/sh\nexit 0\n');
  chmodSync(path.join(payload, 'supabase'), 0o755);
  chmodSync(path.join(payload, 'supabase-go'), 0o755);
  const tarball = path.join(root, 'release.tar.gz');
  expect(spawnSync('tar', ['-czf', tarball, '-C', payload, 'supabase', 'supabase-go']).status).toBe(0);
  const tarballSha = createHash('sha256').update(readFileSync(tarball)).digest('hex');

  const argsLog = path.join(root, 'curl-args');
  writeFileSync(path.join(bin, 'curl'), [
    '#!/bin/bash',
    `printf '%s\\n' "$@" > '${argsLog}'`,
    `if [ '${curlExit}' != 0 ]; then echo 'curl: (28) Operation too slow' >&2; exit ${curlExit}; fi`,
    'while [ "$#" -gt 0 ]; do',
    `  if [ "$1" = --output ]; then cp '${tarball}' "$2"; fi`,
    '  shift',
    'done',
  ].join('\n'));
  chmodSync(path.join(bin, 'curl'), 0o755);

  const githubPath = path.join(root, 'github-path');
  const githubOutput = path.join(root, 'github-output');
  writeFileSync(githubPath, '');
  writeFileSync(githubOutput, '');
  const result = spawnSync('bash', ['-c', installScript], {
    encoding: 'utf8',
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      RUNNER_OS: 'Linux',
      RUNNER_ARCH: 'X64',
      RUNNER_TEMP: runnerTemp,
      GITHUB_PATH: githubPath,
      GITHUB_OUTPUT: githubOutput,
      CLI_VERSION: '2.109.1',
      CLI_SHA256: sha256 ?? tarballSha,
      ...env,
    },
  });
  let curlArgs = [];
  try {
    curlArgs = readFileSync(argsLog, 'utf8').trim().split('\n');
  } catch {
    // curl까지 가지 못한 경우
  }
  return {
    ...result,
    curlArgs,
    githubPath: readFileSync(githubPath, 'utf8'),
    githubOutput: readFileSync(githubOutput, 'utf8'),
    tarballSha,
  };
}

function flagValue(args, flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

describe('Supabase CLI installer', () => {
  it('installs the CLI only through the pinned local installer after a checkout', () => {
    const all = installSteps();
    expect(all.filter(({ step }) => step.uses?.startsWith('supabase/setup-cli'))).toEqual([]);

    const installs = all.filter(({ step }) => step.uses === INSTALLER);
    // pipeline 6곳(validate-db·deploy-supabase·deploy-supabase-preview·deploy-vercel-preview·
    // sync-supabase-preview-main·deploy-staging)과 cleanup 1곳.
    expect(installs.map(({ file, id }) => `${file}:${id}`)).toEqual([
      'pipeline.yml:validate-db',
      'pipeline.yml:deploy-supabase',
      'pipeline.yml:deploy-supabase-preview',
      'pipeline.yml:deploy-vercel-preview',
      'pipeline.yml:sync-supabase-preview-main',
      'pipeline.yml:deploy-staging',
      'supabase-preview-cleanup.yml:delete-preview-branch',
    ]);
    for (const { file, id, job, step, index } of installs) {
      expect(step.with, `${file} ${id}`).toEqual({
        version: '${{ env.SUPABASE_CLI_VERSION }}',
        sha256: '${{ env.SUPABASE_CLI_SHA256 }}',
      });
      // 로컬 action은 작업 디렉터리에 checkout된 파일에서 읽는다.
      const checkout = job.steps.findIndex((candidate) => candidate.uses?.startsWith('actions/checkout@'));
      expect(checkout, `${file} ${id} checkout`).toBeGreaterThanOrEqual(0);
      expect(checkout, `${file} ${id} checkout before install`).toBeLessThan(index);
    }
  });

  it('pins the same release and tarball digest in both workflows', () => {
    const pins = workflows.map(({ workflow }) => ({
      version: workflow.env.SUPABASE_CLI_VERSION,
      sha256: workflow.env.SUPABASE_CLI_SHA256,
    }));
    expect(pins[0].version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pins[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(pins[1]).toEqual(pins[0]);
  });

  it('reads the cleanup installer from the default branch without credentials', () => {
    const job = workflows[1].workflow.jobs['delete-preview-branch'];
    const checkout = job.steps.find((step) => step.uses?.startsWith('actions/checkout@'));
    // 닫힌 PR에는 refs/pull/<n>/merge가 남지 않아 기본 ref로는 이벤트 SHA를 받지 못할 수 있다.
    expect(checkout.with).toEqual({
      ref: '${{ github.event.repository.default_branch }}',
      'sparse-checkout': '.github/actions/setup-supabase-cli',
      'persist-credentials': false,
    });
  });

  it('keeps inputs out of the script text', () => {
    expect(action.runs.using).toBe('composite');
    expect(action.runs.steps).toHaveLength(1);
    expect(installScript).not.toContain('${{');
    expect(action.runs.steps[0].env).toEqual({
      CLI_VERSION: '${{ inputs.version }}',
      CLI_SHA256: '${{ inputs.sha256 }}',
    });
  });

  it('bounds every download attempt and retries stalls within the step limit', () => {
    const { status, stderr, curlArgs, githubPath, githubOutput } = runInstaller();
    expect(status, stderr).toBe(0);

    expect(curlArgs.at(-1)).toBe(
      'https://github.com/supabase/cli/releases/download/v2.109.1/supabase_2.109.1_linux_amd64.tar.gz',
    );
    for (const flag of ['--fail', '--location', '--retry-all-errors']) {
      expect(curlArgs, flag).toContain(flag);
    }
    expect(flagValue(curlArgs, '--proto')).toBe('=https');
    expect(flagValue(curlArgs, '--proto-redir')).toBe('=https');
    const connect = Number(flagValue(curlArgs, '--connect-timeout'));
    const perAttempt = Number(flagValue(curlArgs, '--max-time'));
    const retryWindow = Number(flagValue(curlArgs, '--retry-max-time'));
    const stallSeconds = Number(flagValue(curlArgs, '--speed-time'));
    expect(Number(flagValue(curlArgs, '--speed-limit'))).toBeGreaterThan(0);
    expect(Number(flagValue(curlArgs, '--retry'))).toBeGreaterThanOrEqual(2);
    expect(connect).toBeGreaterThan(0);
    expect(stallSeconds).toBeGreaterThan(0);
    expect(stallSeconds).toBeLessThan(perAttempt);
    // 마지막 재시도는 retry 창 안에서 시작해 요청 상한만큼 더 걸릴 수 있다. 그래도 step 상한
    // 5분보다 1분 이상 먼저 끝나야 정체가 timeout이 아니라 curl 실패·재시도로 처리된다.
    expect(retryWindow + perAttempt).toBeLessThanOrEqual(STEP_LIMIT_SECONDS - 60);

    expect(githubPath.trim()).toMatch(/supabase-cli-2\.109\.1$/);
    expect(githubOutput).toBe('version=2.109.1\n');
  });

  it('refuses a tarball whose digest differs from the pin without adding it to PATH', () => {
    const { status, stdout, githubPath, tarballSha } = runInstaller({ sha256: 'a'.repeat(64) });
    expect(status).toBe(1);
    expect(stdout).toContain('Supabase CLI checksum mismatch');
    expect(stdout).toContain(tarballSha);
    expect(githubPath).toBe('');
  });

  it('fails without touching PATH when the download keeps failing', () => {
    const { status, githubPath } = runInstaller({ curlExit: 28 });
    expect(status).toBe(28);
    expect(githubPath).toBe('');
  });

  it('refuses a binary that reports another version', () => {
    const { status, stdout, githubPath } = runInstaller({ reportedVersion: '2.108.0' });
    expect(status).toBe(1);
    expect(stdout).toContain('Installed 2.108.0, expected 2.109.1');
    expect(githubPath).toBe('');
  });

  it('rejects unsupported runners and malformed pins before downloading', () => {
    for (const env of [
      { RUNNER_OS: 'macOS' },
      { RUNNER_ARCH: 'ARM64' },
      { CLI_VERSION: 'latest' },
      { CLI_SHA256: 'not-a-digest' },
    ]) {
      const { status, curlArgs, githubPath } = runInstaller({ env });
      expect(status, JSON.stringify(env)).toBe(1);
      expect(curlArgs, JSON.stringify(env)).toEqual([]);
      expect(githubPath).toBe('');
    }
  });
});
