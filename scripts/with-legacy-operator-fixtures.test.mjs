import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const project = 'icons-ip-chain-20261014-fixturetest';
const container = `supabase_db_${project}`;
const database = 'icons_goods_transaction_0123456789abcdef0123456789abcdef';
const lease = '01234567-89ab-4def-8123-456789abcdef';
const base = ['--project', project, '--container', container];
function run(extra, { identity = {}, proof = 'f', scope = '1' } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'operator-fixture-guard-'));
  const log = path.join(dir, 'calls.jsonl');
  const valid = { Id: 'a'.repeat(64), Name: `/${container}`, State: { Running: true }, Config: { Labels: { 'com.supabase.cli.project': project } } };
  const docker = path.join(dir, 'docker');
  writeFileSync(docker, `#!${process.execPath}\nimport { appendFileSync } from 'node:fs';\nconst args=process.argv.slice(2);appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');\nif(args[0]==='inspect')process.stdout.write(${JSON.stringify(JSON.stringify({ ...valid, ...identity }))});else process.stdout.write(${JSON.stringify(proof + '\n')});\n`, { mode: 0o700 });
  try {
    const result = spawnSync(process.execPath, ['scripts/with-legacy-operator-fixtures.mjs', ...base, ...extra, '--', process.execPath, '-e', 'throw new Error("child must never execute")'], {
      encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, OPERATOR_LEGACY_FIXTURE_TEST_SCOPE: scope },
    });
    let calls = [];try { calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch {}
    return { ...result, calls };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const clone = ['--database', database, '--clone-lease', lease];
test('named databases, missing scope/lease and ambiguous options fail before Docker', () => {
  for (const extra of [[], ['--database', 'postgres', '--clone-lease', lease], ['--database', 'icons_goods_transaction_123'], ['--database', database], [...clone, '--database', database]]) {
    const result = run(extra);assert.notEqual(result.status, 0);assert.equal(result.calls.length, 0);
  }
  const result = run(clone, { scope: '' });assert.notEqual(result.status, 0);assert.equal(result.calls.length, 0);
});
test('stopped, renamed and incorrectly labeled containers cannot reach SQL', () => {
  for (const identity of [{ State: { Running: false } }, { Name: '/another' }, { Id: 'short' }, { Config: { Labels: { 'com.supabase.cli.project': 'another' } } }]) {
    const result = run(clone, { identity });assert.notEqual(result.status, 0);assert.equal(result.calls.length, 1);assert.equal(result.calls[0][0], 'inspect');
  }
});
test('clone ownership proof is read only and uses full immutable container identity', () => {
  const result = run(clone);assert.notEqual(result.status, 0);assert.match(result.stderr, /ownership lease mismatch/);
  assert.equal(result.calls.length, 2);assert.equal(result.calls[1][2], 'a'.repeat(64));
  assert.equal(result.calls[1][result.calls[1].indexOf('-d') + 1], database);
});
