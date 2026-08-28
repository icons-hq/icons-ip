import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { createClient } from '@supabase/supabase-js';

export const LOCAL_TEST_ACCOUNT = Object.freeze({
  email: 'test@test.com',
  password: 'testtest',
  nickname: 'local_test_user',
  birthDate: '2000-01-01',
});

const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost']);
const SUPPORTED_MODES = new Set(['build', 'dev', 'start']);

export function parseSupabaseStatus(output) {
  return Object.fromEntries(String(output).split(/\r?\n/).flatMap((line) => {
    const separator = line.indexOf('=');
    if (separator <= 0) return [];
    const name = line.slice(0, separator);
    const value = line.slice(separator + 1).replace(/^"|"$/g, '');
    return [[name, value]];
  }));
}

export function requireLoopbackSupabaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Local Supabase status returned an invalid API URL');
  }
  if (!LOCAL_HOSTNAMES.has(url.hostname)) {
    throw new Error(`Refusing to bootstrap a test account outside local Supabase: ${url.hostname}`);
  }
  return url.toString().replace(/\/$/, '');
}

export function readLocalSupabaseEnvironment(execFile = execFileSync) {
  let output;
  try {
    output = execFile('supabase', ['status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    throw new Error('Start the local Supabase stack before using the local server commands');
  }

  const values = parseSupabaseStatus(output);
  const url = requireLoopbackSupabaseUrl(values.API_URL);
  const publishableKey = values.PUBLISHABLE_KEY || values.ANON_KEY;
  const serviceRoleKey = values.SERVICE_ROLE_KEY;
  if (!publishableKey || !serviceRoleKey) {
    throw new Error('Local Supabase status did not provide the required API keys');
  }
  return { url, publishableKey, serviceRoleKey };
}

async function findUserByEmail(admin, email) {
  const normalizedEmail = email.toLowerCase();
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(`Could not list local Auth users: ${error.message}`);
    const users = data?.users ?? [];
    const user = users.find((candidate) => candidate.email?.toLowerCase() === normalizedEmail);
    if (user) return user;
    if (users.length < 1000) return null;
  }
  throw new Error('Could not locate the local test account within 100 Auth pages');
}

export async function ensureLocalTestAccount(
  environment,
  clientFactory = createClient,
  now = () => new Date(),
) {
  const url = requireLoopbackSupabaseUrl(environment.url);
  const clientOptions = {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  };
  const admin = clientFactory(url, environment.serviceRoleKey, clientOptions);
  let user = await findUserByEmail(admin, LOCAL_TEST_ACCOUNT.email);
  let created = false;

  if (user) {
    const { data, error } = await admin.auth.admin.updateUserById(user.id, {
      password: LOCAL_TEST_ACCOUNT.password,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`Could not restore the local test account: ${error?.message ?? 'missing user'}`);
    }
    user = data.user;
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email: LOCAL_TEST_ACCOUNT.email,
      password: LOCAL_TEST_ACCOUNT.password,
      email_confirm: true,
    });
    if (error || !data.user) {
      throw new Error(`Could not create the local test account: ${error?.message ?? 'missing user'}`);
    }
    user = data.user;
    created = true;
  }

  const { error: profileError } = await admin.from('profiles').upsert({
    id: user.id,
    email: LOCAL_TEST_ACCOUNT.email,
    nickname: LOCAL_TEST_ACCOUNT.nickname,
    birth_date: LOCAL_TEST_ACCOUNT.birthDate,
    role: 'user',
    consents: { terms: true, privacy: true, marketing: false },
    onboarded_at: now().toISOString(),
  }, { onConflict: 'id' });
  if (profileError) throw new Error(`Could not onboard the local test account: ${profileError.message}`);

  const publicClient = clientFactory(url, environment.publishableKey, clientOptions);
  const { data: signInData, error: signInError } = await publicClient.auth.signInWithPassword({
    email: LOCAL_TEST_ACCOUNT.email,
    password: LOCAL_TEST_ACCOUNT.password,
  });
  if (signInError || !signInData.session) {
    throw new Error(`Could not verify the local test account login: ${signInError?.message ?? 'missing session'}`);
  }
  const { error: signOutError } = await publicClient.auth.signOut();
  if (signOutError) throw new Error(`Could not close the local login verification session: ${signOutError.message}`);

  return { created, userId: user.id };
}

export function localApplicationEnvironment(ambientEnvironment, environment) {
  return {
    ...ambientEnvironment,
    NEXT_PUBLIC_SUPABASE_URL: environment.url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: environment.publishableKey,
    SUPABASE_SERVICE_ROLE_KEY: environment.serviceRoleKey,
    ICONS_CATALOG_SOURCE: 'supabase',
  };
}

export function localCommand(mode, args = []) {
  if (!SUPPORTED_MODES.has(mode)) {
    throw new Error(`Unsupported local server mode: ${mode || '(missing)'}`);
  }
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return { command: npmCommand, args: ['run', mode, '--', ...args] };
}

export async function runLocalSupabaseCommand({
  mode,
  args = [],
  ambientEnvironment = process.env,
  readEnvironment = readLocalSupabaseEnvironment,
  ensureAccount = ensureLocalTestAccount,
  run = spawnSync,
} = {}) {
  const environment = readEnvironment();
  const account = await ensureAccount(environment);
  const command = localCommand(mode, args);
  console.log(`Local test account ${account.created ? 'created' : 'restored'}: ${LOCAL_TEST_ACCOUNT.email}`);
  const result = run(command.command, command.args, {
    env: localApplicationEnvironment(ambientEnvironment, environment),
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`Local ${mode} process exited from ${result.signal}`);
  if (result.status !== 0) throw new Error(`Local ${mode} process exited with ${result.status}`);
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  await runLocalSupabaseCommand({ mode, args });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
