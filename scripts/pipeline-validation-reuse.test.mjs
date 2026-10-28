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
const steps = pipeline.jobs.validate.steps;
const stepNamed = (name) => steps.find((step) => step.name === name);
const reuse = stepNamed('Reuse validation of the identical tree');
const fullValidation = "steps.reuse.outputs.hit != 'true'";
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

function runReuse(api) {
  const directory = mkdtempSync(path.join(tmpdir(), 'validation-reuse-'));
  temporaryDirectories.push(directory);
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

describe('main validation reuse contract', () => {
  it('looks for evidence only on push to main, right after checkout', () => {
    expect(reuse.id).toBe('reuse');
    expect(reuse.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main'");
    expect(reuse.env).toEqual({ GH_TOKEN: '${{ github.token }}' });
    expect(steps.indexOf(reuse)).toBe(steps.indexOf(stepNamed('Check out repository')) + 1);
    expect(pipeline.jobs.validate.permissions).toEqual({ actions: 'read', contents: 'read' });
  });

  it('skips every check after the reuse step only when evidence was found', () => {
    const exempt = new Set([
      'Check admin guide changelog',
      'Record validated tree',
      'Upload validated tree evidence',
    ]);
    const checks = steps.slice(steps.indexOf(reuse) + 1).filter((step) => !exempt.has(step.name));

    expect(checks.map((step) => step.name)).toEqual(expect.arrayContaining([
      'Run lint', 'Run TypeScript checks', 'Run tests', 'Build application',
      'Apply local migrations', 'Check manager permission boundaries', 'Run database smoke tests',
      'Lint local database',
    ]));
    for (const step of checks) {
      expect(step.if, step.name).toContain(fullValidation);
    }
    expect(stepNamed('Verify manager boundaries after legacy fixtures').if).toBe(
      `always() && ${fullValidation}`,
    );
    expect(stepNamed('Check admin guide changelog').if).toBe("github.event_name == 'pull_request'");
  });

  it('records the merge tree only after a PR or merge queue run passes every check', () => {
    const record = stepNamed('Record validated tree');
    const upload = stepNamed('Upload validated tree evidence');

    expect(steps.slice(-2)).toEqual([record, upload]);
    expect(record.if).toBe(evidenceEvents);
    expect(upload.if).toBe(evidenceEvents);
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
