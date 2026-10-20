import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const separator = args.indexOf('--');
if (separator < 0 || separator === args.length - 1) throw new Error('Usage: --project ID --container NAME [--database CLONE --clone-lease UUID] -- COMMAND [ARGS]');
const options = new Map();
for (let i = 0; i < separator; i += 2) {
  if (!['--project', '--container', '--database', '--clone-lease'].includes(args[i]) || !args[i + 1] || options.has(args[i])) throw new Error('Invalid fixture option');
  options.set(args[i], args[i + 1]);
}
const project = options.get('--project');
const container = options.get('--container');
const database = options.get('--database') ?? 'postgres';
const cloneLease = options.get('--clone-lease');
const isClone = database !== 'postgres';
const allowedClone = isClone && /^icons_(?:goods_transaction_[a-f0-9]{32}|gift_syntax_[a-f0-9]{12}|gift_orders_[a-f0-9]{32})$/.test(database)
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(cloneLease ?? '')
  && /^[a-z0-9][a-z0-9-]{0,100}$/.test(project ?? '');
const allowedCi = project === 'icons-ip' && process.env.CI === 'true' && process.env.GITHUB_ACTIONS === 'true';
const allowedFresh = /^(?:icons-ip-smartstore-fresh-[0-9]{8}|icons-admin-release-[a-f0-9]{8})$/.test(project ?? '');
if (process.env.OPERATOR_LEGACY_FIXTURE_TEST_SCOPE !== '1' || (isClone ? !allowedClone : (!allowedCi && !allowedFresh) || cloneLease !== undefined)
  || container !== `supabase_db_${project}`) {
  throw new Error('Refusing legacy fixture installation outside an explicit local FRESH/GitHub Actions database. Browser QA and production are excluded.');
}
const inspected = spawnSync('docker', ['inspect', '--format', '{{json .}}', container], { encoding: 'utf8' });
if (inspected.status !== 0) throw new Error('Docker Supabase project inspection failed');
const identity = JSON.parse(inspected.stdout);
if (!identity.State?.Running || identity.Name !== `/${container}` || identity.Config?.Labels?.['com.supabase.cli.project'] !== project
  || !/^[a-f0-9]{64}$/.test(identity.Id ?? '')) throw new Error('Docker Supabase project identity mismatch');
// Resolve a full immutable container identity once; never let a name reuse
// redirect installation, the child command or cleanup to another container.
const containerId = identity.Id;
if (isClone) {
  const proof = spawnSync('docker', ['exec', '-i', containerId, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1',
    '-v', `clone_lease=${cloneLease}`, '-v', `clone_container_id=${containerId}`, '-v', `clone_database=${database}`], {
    input: "select current_database()=:'clone_database' and current_database()<>'postgres' and exists(select 1 from private.operator_fixture_clone_identity where singleton and lease=:'clone_lease'::uuid and container_id=:'clone_container_id' and source_database='postgres' and created_at>clock_timestamp()-interval '2 hours');", encoding: 'utf8',
  });
  if (proof.status !== 0 || proof.stdout.trim() !== 't') throw new Error('Disposable clone identity or ownership lease mismatch');
}
const lease = randomUUID();
const sql = (input) => {
  const result = spawnSync('docker', ['exec', '-i', containerId, 'psql', '-X', '-q', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1',
    '-v', `operator_fixture_project=${project}`, '-v', `operator_fixture_lease=${lease}`, '-1'], { input, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || 'Isolated fixture SQL failed');
  return result.stdout;
};
let installed = false;
let child;
let signal;
const forwardTerm = () => { signal = 'SIGTERM'; child?.kill('SIGTERM'); };
const forwardInt = () => { signal = 'SIGINT'; child?.kill('SIGINT'); };
process.on('SIGTERM', forwardTerm);
process.on('SIGINT', forwardInt);
try {
  sql(readFileSync(path.join(root, 'supabase/tests/helpers/operator_access_fixture.sql'), 'utf8'));
  installed = true;
    process.stderr.write(`[TEST ONLY] Legacy operator fixtures active in ${project}/${database}; production and browser QA are excluded.\n`);
  const code = await new Promise((resolve, reject) => {
    child = spawn(args[separator + 1], args.slice(separator + 2), {
      cwd: root, stdio: 'inherit', env: { ...process.env, SUPABASE_DB_CONTAINER: isClone ? containerId : container, SUPABASE_DB_DATABASE: database },
    });
    child.on('error', reject);
    child.on('exit', (status) => resolve(status ?? 1));
  });
  process.exitCode = signal ? 1 : code;
} finally {
  if (installed) {
    sql(`select 1/case when exists(select 1 from private.operator_legacy_fixture_control where project_id=:'operator_fixture_project' and lease=:'operator_fixture_lease'::uuid) then 1 else 0 end;
      drop trigger test_operator_legacy_fixture on public.profiles;
      drop function private.capture_operator_legacy_fixture();
      drop table private.operator_legacy_fixture_control;`);
    process.stderr.write(`[TEST ONLY] Legacy fixture trigger and lease removed from ${project}.\n`);
  }
  process.off('SIGTERM', forwardTerm);
  process.off('SIGINT', forwardInt);
}
