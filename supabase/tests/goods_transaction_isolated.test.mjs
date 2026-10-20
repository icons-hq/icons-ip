import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const temporary = [];
afterEach(() => { for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function run({ name = 'supabase_db_icons-ip-chain-20261014-fixturetest', identity = {}, scope = 'isolated-local', args = [] } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'goods-clone-guard-'));temporary.push(dir);
  const log = path.join(dir, 'calls.jsonl');
  const valid = { Id: 'a'.repeat(64), Name: `/${name}`, State: { Running: true }, Config: { Labels: { 'com.supabase.cli.project': name.replace('supabase_db_', '') } } };
  writeFileSync(path.join(dir, 'docker'), `#!${process.execPath}\nimport {appendFileSync} from 'node:fs';const args=process.argv.slice(2);appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');if(args[0]==='inspect'){process.stdout.write(${JSON.stringify(JSON.stringify({ ...valid, ...identity }))});}else{process.stderr.write('GUARD_TEST_STOP_BEFORE_DUMP');process.exitCode=91;}\n`, { mode: 0o700 });
  const result = spawnSync('bash', ['supabase/tests/goods_transaction_isolated.sh', ...args], { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, SUPABASE_DB_CONTAINER: name, GOODS_TRANSACTION_TEST_SCOPE: scope } });
  let calls = [];try { calls = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)); } catch {}
  return { ...result, calls };
}
it('wrong project, ambiguous names, unsupported scopes and invalid drafts stop before Docker', () => {
  for (const input of [{ name: 'supabase_db_make-body' }, { name: 'supabase_db_icons-ip;echo' }, { name: 'supabase_db_icons-ip../bad' }, { name: 'supabase_db_' }, { scope: 'production' }, { scope: 'ci' }, { args: ['supabase/migrations/../config.toml'] }]) {
    const result = run(input);expect(result.status).not.toBe(0);expect(result.calls).toEqual([]);
  }
});
it('stopped, renamed, short-ID and mislabeled containers cannot dump or create a database', () => {
  for (const identity of [{ State: { Running: false } }, { Name: '/supabase_db_other' }, { Id: 'short' }, { Config: { Labels: { 'com.supabase.cli.project': 'make-body' } } }]) {
    const result = run({ identity });expect(result.status).not.toBe(0);expect(result.calls).toHaveLength(1);expect(result.calls[0][0]).toBe('inspect');
  }
});
it('the first complete-ledger read and failure cleanup use the same fixed full container ID', () => {
  const result = run();expect(result.status).not.toBe(0);expect(result.stderr).toContain('GUARD_TEST_STOP_BEFORE_DUMP');
  const commands = result.calls.slice(1);expect(commands.length).toBeGreaterThan(0);
  for (const call of commands) { expect(call[0]).toBe('exec');expect(call[1]).toBe('a'.repeat(64));expect(call).not.toContain('pg_dump');expect(call).not.toContain('createdb');expect(call).not.toContain('dropdb'); }
  expect(commands[0].join(' ')).toContain('jsonb_agg(to_jsonb(ledger) order by version)');
});

it('contact HTTP fixture rejects optimized Python before reading or mutating any container', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'contact-http-guard-')); temporary.push(dir);
  const log = path.join(dir, 'docker-calls');
  writeFileSync(path.join(dir, 'docker'), `#!${process.execPath}\nimport {appendFileSync} from 'node:fs';appendFileSync(${JSON.stringify(log)},'called');process.exitCode=91;\n`, { mode: 0o700 });
  for (const script of ['order_claim_contact_http.py', 'order_claim_contact_concurrency.py']) for (const optimized of [false, true]) {
    const args = [...(optimized ? ['-O'] : []), `supabase/tests/${script}`, 'a'.repeat(64), `icons_goods_transaction_${'b'.repeat(32)}`, dir];
    const result = spawnSync('python3', args, { encoding: 'utf8', env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, PYTHONOPTIMIZE: '1' } });
    expect(result.status).not.toBe(0); expect(result.stderr).toContain('Optimized Python is not allowed');
  }
  expect(() => readFileSync(log)).toThrow();
});
