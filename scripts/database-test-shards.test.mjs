import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';
import { describe, expect, it } from 'vitest';

import {
  databaseContainer,
  databaseTestShards,
  formatSummary,
  runShard,
} from './database-test-shards.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const pipeline = yaml.load(
  await readFile(new URL('../.github/workflows/pipeline.yml', import.meta.url), 'utf8'),
);
const shardJob = pipeline.jobs['validate-db'];
const entries = databaseTestShards.flatMap((shard) => shard.entries.map((entry) => ({ shard, entry })));
const legacyCommand = (entry) => entry.command.includes('with-legacy-operator-fixtures.mjs');

function cli(args, env = {}) {
  const childEnv = { ...process.env, ...env };
  for (const name of ['CI', 'GITHUB_ACTIONS', 'GITHUB_STEP_SUMMARY']) {
    if (!(name in env)) delete childEnv[name];
  }
  return spawnSync(process.execPath, ['scripts/database-test-shards.mjs', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: childEnv,
  });
}

describe('CI database shard manifest', () => {
  it('runs exactly the manifest shards as an unbounded, independent matrix', () => {
    expect(shardJob.strategy.matrix.shard).toEqual(databaseTestShards.map((shard) => shard.id));
    expect(new Set(shardJob.strategy.matrix.shard).size).toBe(databaseTestShards.length);
    expect(shardJob.strategy['fail-fast']).toBe(false);
    expect(shardJob.steps.find((step) => step.name === 'Run database test shard')).toMatchObject({
      env: { SHARD: '${{ matrix.shard }}' },
      run: 'node scripts/database-test-shards.mjs --shard "$SHARD"',
    });
  });

  it('prepares every shard on a fresh migrated database before its tests', () => {
    const names = shardJob.steps.map((step) => step.name);
    const order = [
      'Install dependencies',
      'Start local Supabase database',
      'Apply local migrations',
      'Pause automatic order confirmation in the CI database',
      'Install database smoke test tools',
      'Run database test shard',
      'Lint local database',
    ];
    expect(names.filter((name) => order.includes(name))).toEqual(order);
    expect(shardJob.steps.find((step) => step.name === 'Apply local migrations').run).toBe(
      'supabase db reset --local --no-seed',
    );
  });

  it('registers each check once with existing files against the CI container only', () => {
    for (const shard of databaseTestShards) {
      expect(shard.entries.length, shard.id).toBeGreaterThan(0);
      expect(shard.title, shard.id).toBeTruthy();
    }
    // 운영자 경계 재확인(always)만 의도적으로 legacy fixture 뒤에서 한 번 더 돈다.
    const commands = entries.filter(({ entry }) => !entry.always).map(({ entry }) => entry.command);
    expect(new Set(commands).size).toBe(commands.length);
    expect(new Set(entries.map(({ shard, entry }) => `${shard.id}:${entry.label}`)).size).toBe(entries.length);

    for (const { shard, entry } of entries) {
      const files = entry.command.match(/(?:supabase\/tests|scripts)\/[\w./-]+\.(?:sql|sh|py|mjs)/g) ?? [];
      expect(files.length, `${shard.id}:${entry.label}`).toBeGreaterThan(0);
      for (const file of files) expect(existsSync(new URL(`../${file}`, import.meta.url)), file).toBe(true);
      expect(entry.command.match(/supabase_db_[\w-]+/g) ?? [], entry.label).toSatisfy(
        (containers) => containers.every((container) => container === databaseContainer),
      );
    }
  });

  it('keeps legacy fixtures last in their shard and re-verifies operator boundaries afterwards', () => {
    const owners = entries.filter(({ entry }) => legacyCommand(entry));
    expect(owners).toHaveLength(1);
    const [{ shard }] = owners;
    const index = shard.entries.findIndex(legacyCommand);
    const after = shard.entries.slice(index + 1);

    expect(after.map((entry) => entry.label)).toEqual([
      'release_main_admin_contracts.sql',
      'operator_capability_coverage.sql',
      'operator_capability_guards.sql',
    ]);
    expect(after.every((entry) => entry.always)).toBe(true);
    expect(entries.filter(({ entry }) => entry.always)).toHaveLength(after.length);
    expect(shard.entries[index].command).toMatch(/^OPERATOR_LEGACY_FIXTURE_TEST_SCOPE=1 /);
  });

  it('runs the full-admin contracts before any legacy fixture in a fresh shard', () => {
    const [{ shard, entry }] = entries.filter(({ entry }) => entry.label === 'run-full-admin-sql-tests.py');
    expect(entry.command).toContain(`--scope ci --container ${databaseContainer}`);
    expect(shard.entries.slice(0, shard.entries.indexOf(entry)).some(legacyCommand)).toBe(false);
  });
});

describe('CI database shard runner', () => {
  const shard = {
    id: 'sample',
    title: '예시',
    entries: [
      { label: 'first', command: 'exit 0' },
      { label: 'second', command: 'exit 3' },
      { label: 'third', command: 'exit 0' },
      { label: 'verify', command: 'exit 0', always: true },
    ],
  };

  it('stops at the first failure but still runs always entries', async () => {
    const executed = [];
    const log = [];
    const { ok, results } = await runShard(shard, {
      execute: async (command) => {
        executed.push(command);
        return Number(command.slice('exit '.length));
      },
      log: (line) => log.push(line),
    });

    expect(ok).toBe(false);
    expect(executed).toEqual(['exit 0', 'exit 3', 'exit 0']);
    expect(results.map(({ label, status }) => [label, status])).toEqual([
      ['first', 'passed'],
      ['second', 'failed'],
      ['third', 'skipped'],
      ['verify', 'passed'],
    ]);
    expect(log).toContain('::group::[sample 2/4] second');
    expect(log.some((line) => line.startsWith('::error title=Database test failed::second exited with 3'))).toBe(true);
  });

  it('runs real commands with pipefail and summarizes each duration', async () => {
    const piped = { ...shard, entries: [{ label: 'pipe', command: 'false | cat' }] };
    const { ok, results } = await runShard(piped, { log: () => {} });
    expect(ok).toBe(false);

    const summary = formatSummary(shard, [
      { label: 'first', status: 'passed', seconds: 1.25 },
      { label: 'second', status: 'failed', seconds: 2 },
      { label: 'third', status: 'skipped', seconds: 0 },
    ]);
    expect(results[0].status).toBe('failed');
    expect(summary).toContain('### DB 샤드 `sample` — 예시');
    expect(summary).toContain('| 1 | `first` | 통과 | 1.3 |');
    expect(summary).toContain('합계 3.3초 · 통과 1 · 실패 1 · 건너뜀 1');
  });

  it('prints commands locally but refuses to execute outside GitHub Actions', () => {
    const listed = cli(['--list']);
    expect(listed.status).toBe(0);
    expect(listed.stdout.trim().split('\n')).toEqual(databaseTestShards.map((item) => item.id));

    const printed = cli(['--print', 'legacy']);
    expect(printed.status).toBe(0);
    expect(printed.stdout.trim().split('\n')).toEqual(
      databaseTestShards.find((item) => item.id === 'legacy').entries.map((entry) => entry.command),
    );

    const refused = cli(['--shard', 'legacy']);
    expect(refused.status).toBe(2);
    expect(refused.stderr).toContain('outside GitHub Actions');
    expect(cli(['--shard', 'missing'], { CI: 'true', GITHUB_ACTIONS: 'true' }).status).toBe(2);
  });
});
